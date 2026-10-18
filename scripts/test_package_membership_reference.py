#!/usr/bin/env python3
"""Source-free filesystem *reference model*, NOT the Oreslang compiler.

Tests package membership with real symlinks, hardlinks and nested manifests.
The production resolver must additionally prevent symlink-swap TOCTOU using
trusted descriptor-relative traversal. No runtime/compiler claims are made.
"""
from __future__ import annotations
import os
import tempfile
import unicodedata
import unittest
from pathlib import Path

MARKERS = ('.ores.pkg.toml', '.oreslangc.cfg.toml')

class Rejected(ValueError):
    pass

def member(root: Path, name: str) -> Path:
    if (not isinstance(name, str) or not name or name != unicodedata.normalize('NFC', name)
            or any(ord(ch) < 32 or ord(ch) == 127 for ch in name)
            or any(ch in name for ch in '\\:*?[]') or name.startswith(('/', '~'))):
        raise Rejected('invalid source path')
    parts = name.split('/')
    if any(p in ('', '.', '..') for p in parts) or not name.endswith('.ores'):
        raise Rejected('invalid source path segments/extension')
    node = root
    for i, part in enumerate(parts):
        node = node / part
        if node.is_symlink():
            raise Rejected('symlink component')
        if i < len(parts)-1 and any((node / marker).exists() or
                                    (node / marker).is_symlink() for marker in MARKERS):
            raise Rejected('independently nested manifest')
    try:
        node.resolve(strict=True).relative_to(root)
    except (OSError, ValueError, RuntimeError) as exc:
        raise Rejected('missing/out-of-root source') from exc
    if not node.is_file():
        raise Rejected('not a regular file')
    return node

def membership(root: Path, manifest: dict, dep_id: str) -> dict:
    if root.is_symlink() or root != root.resolve() or not root.is_dir():
        raise Rejected('noncanonical project root')
    if manifest.get('schema_version') != '2' or not dep_id:
        raise Rejected('invalid schema/dependency instance')
    groups = manifest.get('packages')
    if not isinstance(groups, dict):
        raise Rejected('invalid package table')
    owners, inodes = {}, set()
    for key, group in groups.items():
        if not isinstance(key, str) or not key or key != unicodedata.normalize('NFC', key):
            raise Rejected('invalid package name')
        if not isinstance(group, dict) or set(group) != {'files'} or not isinstance(group['files'], list) or not group['files']:
            raise Rejected('invalid membership declaration')
        for path in group['files']:
            source = member(root, path)
            st = source.stat()
            inode = (st.st_dev, st.st_ino)
            if source in owners or inode in inodes:
                raise Rejected('duplicate/hardlink source ownership')
            owners[source] = ('package', dep_id, str(root), key)
            inodes.add(inode)
    return owners

def identity(file: Path, owners: dict, dep_id: str) -> tuple:
    return owners.get(file, ('singleton', dep_id, str(file)))

class ReferenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        for p in ('src/auth/auth.ores', 'src/auth/tokens.ores', 'src/billing/billing.ores', 'src/main.ores'):
            file = self.root/p
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text('// synthetic fixture\n')
        self.m = {'schema_version': '2', 'packages': {
            'auth': {'files': ['src/auth/auth.ores', 'src/auth/tokens.ores']},
            'billing': {'files': ['src/billing/billing.ores']}}}

    def test_positive_and_dependency_boundaries(self):
        owners = membership(self.root, self.m, 'dep-A')
        a, b = self.root/'src/auth/auth.ores', self.root/'src/auth/tokens.ores'
        self.assertEqual(identity(a, owners, 'dep-A'), identity(b, owners, 'dep-A'))
        self.assertNotEqual(identity(a, owners, 'dep-A'), identity(self.root/'src/main.ores', owners, 'dep-A'))
        self.assertNotEqual(owners[a], membership(self.root, self.m, 'dep-B')[a])

    def test_malformed_paths(self):
        bad = ('', 'src/auth/../billing/billing.ores', 'src//auth/auth.ores',
               '/src/auth/auth.ores', r'C:\src\auth\auth.ores', 'src/auth/*.ores',
               'src/auth/cafe\u0301.ores', 'src/auth/x\n.ores', 'src/auth/./auth.ores',
               'src/auth/', 'src/auth/nope.ores')
        for p in bad:
            with self.subTest(path=repr(p)):
                self.m['packages']['auth']['files'][0] = p
                with self.assertRaises(Rejected): membership(self.root, self.m, 'dep-A')

    def test_invalid_manifest_forms(self):
        def run(): membership(self.root, self.m, 'dep-A')
        self.m['schema_version'] = '1'
        with self.assertRaises(Rejected): run()
        self.m['schema_version'] = '2'
        self.m['packages']['auth']['files'] = 'src/auth/auth.ores'
        with self.assertRaises(Rejected): run()
        self.m['packages']['auth']['files'] = ['src/auth/auth.ores']
        self.m['packages']['auth']['visibility'] = 'pub'
        with self.assertRaises(Rejected): run()
        del self.m['packages']['auth']['visibility']
        self.m['packages']['billing']['files'].append('src/auth/auth.ores')
        with self.assertRaises(Rejected): run()
        self.m['packages']['billing']['files'].pop()
        self.m['packages']['auth']['files'].append('src/auth/auth.ores')
        with self.assertRaises(Rejected): run()

    def test_symlink_and_hardlink_aliases(self):
        src = self.root/'src/auth/auth.ores'
        for kind in ('symlink', 'hardlink'):
            alias = self.root/'src/auth/alias.ores'
            if kind == 'symlink': alias.symlink_to(src)
            else: os.link(src, alias)
            self.m['packages']['auth']['files'].append('src/auth/alias.ores')
            with self.subTest(kind=kind), self.assertRaises(Rejected):
                membership(self.root, self.m, 'dep-A')
            self.m['packages']['auth']['files'].pop()
            alias.unlink()
        (self.root/'alias').symlink_to(self.root/'src/auth', target_is_directory=True)
        self.m['packages']['auth']['files'].append('alias/auth.ores')
        with self.assertRaises(Rejected): membership(self.root, self.m, 'dep-A')

    def test_nested_markers_and_nonfiles(self):
        for marker in MARKERS:
            path = self.root/'src/auth'/marker
            path.write_text('schema_version = "1"\n')
            with self.subTest(marker=marker), self.assertRaises(Rejected):
                membership(self.root, self.m, 'dep-A')
            path.unlink()
        path = self.root/'src/auth/.ores.pkg.toml'
        path.symlink_to('absent')
        with self.assertRaises(Rejected): membership(self.root, self.m, 'dep-A')
        path.unlink()
        (self.root/'src/auth/dir.ores').mkdir()
        self.m['packages']['auth']['files'].append('src/auth/dir.ores')
        with self.assertRaises(Rejected): membership(self.root, self.m, 'dep-A')

    def test_symlinked_root(self):
        alias = self.root.parent/(self.root.name + '-alias')
        alias.symlink_to(self.root, target_is_directory=True)
        try:
            with self.assertRaises(Rejected): membership(alias, self.m, 'dep-A')
        finally: alias.unlink()

if __name__ == '__main__':
    unittest.main(verbosity=2)
