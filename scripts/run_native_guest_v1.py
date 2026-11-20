#!/usr/bin/env python3
"""Capture actual compiler/guest-process observations; NEVER certify CI provenance.

Requires built production compiler and (for LLVM) Clang plus native C runtime.
Emits an intentionally INCOMPLETE evidence fragment: no invented CI IDs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile

from native_guest_parity_gate import ContractError, load_manifest, require

MAX_OUTPUT = 131072


def digest_file(path: Path) -> str:
    require(path.is_file() and not path.is_symlink(), f"not a regular artifact: {path}")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def bounded(argv: list[str], *, cwd: Path, timeout: int = 90):
    """No shell; capture both streams and kill POSIX process group on timeout."""
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        process = subprocess.Popen(argv, cwd=cwd, stdout=stdout, stderr=stderr,
                                   stdin=subprocess.DEVNULL,
                                   start_new_session=(os.name == "posix"))
        try:
            rc = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired as error:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
            process.wait(timeout=10)
            raise ContractError(f"compiler/guest timeout: {Path(argv[0]).name}") from error
        require(stdout.tell() <= MAX_OUTPUT and stderr.tell() <= MAX_OUTPUT,
                "compiler/guest process exceeded output cap")
        stdout.seek(0)
        stderr.seek(0)
        return rc, stdout.read(), stderr.read()


def actual_checkout(repo: Path):
    require((repo / '.git').exists(), "compiler source must be a real Git checkout")
    def git(*args):
        done = subprocess.run(['git', '-C', str(repo), *args], capture_output=True,
                              timeout=15, check=False)
        require(done.returncode == 0, f"git query failed: {' '.join(args)}")
        return done.stdout.decode('utf-8', 'strict').strip()
    head = git('rev-parse', '--verify', 'HEAD')
    tree = git('rev-parse', '--verify', 'HEAD^{tree}')
    require(len(head) == len(tree) == 40 and
            not git('status', '--porcelain=v1', '--untracked-files=no'),
            "compiler source checkout dirty or not SHA-1")
    return head, tree


def gather(profile: str, root: Path, compiler_root: Path, compiler: Path,
           *, clang: Path | None = None, java_probe: Path | None = None,
           java_class_artifact: Path | None = None):
    require(profile in ('llvm-native-aot', 'graal-jvm-guest'),
            'this runner does NOT implement Graal compiled-guest AOT')
    manifest_hash, cases = load_manifest(root)
    compiler_head, source_tree = actual_checkout(compiler_root)
    if profile == 'llvm-native-aot':
        require(clang is not None and java_probe is None and java_class_artifact is None,
                'LLVM requires Clang but no JVM options')
        runtime = compiler_root / 'src/main/cpp/oreslang/runtime/NativeIntArrayRegion.c'
        include = compiler_root / 'src/main/cpp'
        for file in (compiler, clang, runtime):
            digest_file(file)
        executable = compiler
        kind, lowering = 'llvm-native-compiler', 'llvm-ir'
    else:
        require(java_probe is not None and java_class_artifact is not None and clang is None,
                'JVM requires real probe and compiled launcher class but no Clang')
        require(java_probe.is_file() and not java_probe.is_symlink(), 'invalid JVM probe')
        executable = java_class_artifact
        kind, lowering = 'jvm-guest-launcher', 'truffle-guest'
    artifact_digest = digest_file(executable)
    observed = {}
    with tempfile.TemporaryDirectory(prefix='ores-native-guest-v1-') as tmp:
        temporary = Path(tmp)
        for case_id, case in cases.items():
            if case['readiness'][profile] != 'required':
                continue
            path = root / case['path']
            if profile == 'llvm-native-aot':
                compile_rc, ir, diagnostics = bounded([str(compiler), str(path)], cwd=compiler_root)
                if case['expectation']['kind'] == 'reject':
                    require(compile_rc == 1 and not ir and
                            case['expectation']['diagnostic'].encode() in diagnostics,
                            f"unexpected negative compile result for {case_id}")
                    observed[case_id] = {'fixture_sha256': case['sha256'],
                                          'stage': 'compiler-reject',
                                          'diagnostic': case['expectation']['diagnostic'],
                                          'compiler_rc': compile_rc, 'emitted_ir_bytes': len(ir)}
                    continue
                require(compile_rc == 0 and not diagnostics and b'define ' in ir,
                        f"failed to emit native LLVM IR for {case_id}")
                if case_id == 'owned-array-main':
                    require(b'@oreslang_int_array_try_new' in ir and
                            b'@oreslang_int_array_drop' in ir and
                            b'@oreslang_int_array_region_close' in ir,
                            'class-owned Array lacks native allocation/drop lowering')
                ir_path = temporary / (case_id + '.ll')
                ir_path.write_bytes(ir)
                binary = temporary / case_id
                link_rc, link_out, link_err = bounded([
                    str(clang), '-O1', '-Wno-override-module', '-std=c11',
                    '-x', 'ir', str(ir_path), '-x', 'c', str(runtime),
                    '-I', str(include), '-o', str(binary)], cwd=compiler_root)
                require(link_rc == 0 and not link_out and not link_err,
                        f"failed to link genuine native guest for {case_id}")
                before = digest_file(binary)
                rc, stdout, stderr = bounded([str(binary)], cwd=compiler_root, timeout=15)
                after = digest_file(binary)
                require(rc == 42 and not stdout and not stderr and before == after,
                        f"wrong compiled native guest result for {case_id}")
                observed[case_id] = {'fixture_sha256': case['sha256'],
                                      'stage': 'native-execute', 'exit_code': rc,
                                      'linked_guest': True,
                                      'guest_ir_sha256': hashlib.sha256(ir).hexdigest(),
                                      'native_binary_sha256_before': before,
                                      'native_binary_sha256_after': after}
            else:
                check_rc, check_out, check_err = bounded(
                    [sys.executable, str(java_probe), str(path)], cwd=compiler_root)
                require(check_rc == 0, f"JVM guest check failed for {case_id}")
                rc, stdout, stderr = bounded(
                    [sys.executable, str(java_probe), str(path), '--execute'], cwd=compiler_root)
                require(rc == 42, f"JVM guest result failed for {case_id}")
                observed[case_id] = {'fixture_sha256': case['sha256'],
                                      'stage': 'guest-execute', 'exit_code': rc,
                                      'linked_guest': True}
    require(observed, 'no source programs executed')
    # This is deliberately not the full report expected by the offline attestation gate.
    # No fake run_id/job_id/runner_id or workflow success is fabricated here.
    return {'schema_version': 1, 'evidence_status': 'raw-process-only-not-attested',
            'profile': profile, 'manifest_sha256': manifest_hash,
            'source_tree': source_tree, 'compiler_sha': compiler_head,
            'compiler_artifact_sha256': artifact_digest, 'artifact_kind': kind,
            'guest_lowering': lowering, 'fallback': 'none', 'observed': observed}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', required=True, choices=('llvm-native-aot','graal-jvm-guest'))
    parser.add_argument('--common-root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--compiler-source-root', type=Path, required=True)
    parser.add_argument('--compiler', type=Path)
    parser.add_argument('--clang', type=Path)
    parser.add_argument('--java-probe', type=Path)
    parser.add_argument('--java-class-artifact', type=Path)
    parser.add_argument('--report', required=True, type=Path)
    args = parser.parse_args()
    try:
        root = args.common_root.resolve(strict=True)
        compiler_root = args.compiler_source_root.resolve(strict=True)
        executable = args.compiler.resolve(strict=True) if args.compiler else None
        require(args.profile != 'llvm-native-aot' or executable is not None,
                'LLVM compiler executable required')
        report = gather(args.profile, root, compiler_root, executable,
                        clang=args.clang.resolve(strict=True) if args.clang else None,
                        java_probe=args.java_probe.resolve(strict=True) if args.java_probe else None,
                        java_class_artifact=args.java_class_artifact.resolve(strict=True)
                        if args.java_class_artifact else None)
        args.report.write_text(json.dumps(report, sort_keys=True, indent=2) + '\n', encoding='utf-8')
        print('RAW_GUEST_PROCESSES_OBSERVED; CI provenance NOT attested')
        return 0
    except (ContractError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(f'GUEST_EXECUTION_DENIED: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
