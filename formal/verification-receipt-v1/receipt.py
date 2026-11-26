"""Validate the shape and internal consistency of a verification evidence claim.
Not an attestation verifier: the reviewer must authenticate each cited artifact.
"""
import json
import re
import sys
from pathlib import Path

AXES = {
    'host-witness', 'compiler-guest', 'differential-guest', 'model-proof',
    'emitted-ir', 'translation-validation', 'implementation-refinement',
}
STATUS = {'PASS', 'FAIL', 'NOT_EXECUTED', 'UNSUPPORTED'}
COMPILER_AXES = {'compiler-guest', 'differential-guest', 'emitted-ir', 'translation-validation', 'implementation-refinement'}
PROOF_AXES = {'model-proof', 'emitted-ir', 'translation-validation', 'implementation-refinement'}
HASH = re.compile(r'[0-9a-f]{64}\Z')
GIT = re.compile(r'[0-9a-f]{40}\Z')
REPO = re.compile(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\Z')


def require(ok, message):
    if not ok:
        raise ValueError(message)


def keys(value, expected, where):
    require(type(value) is dict and set(value) == set(expected.split()), f'{where}: unexpected/missing fields')


def string(value, where):
    require(type(value) is str and 0 < len(value) <= 4096 and value.strip() == value and not any(ord(x) < 32 or ord(x) == 127 for x in value), f'{where}: invalid text')


def digest(value, pattern, where):
    require(type(value) is str and pattern.fullmatch(value) is not None and set(value) != {'0'}, f'{where}: invalid digest')


def counter(value, where):
    require(type(value) is int and 0 <= value <= 10**9, f'{where}: invalid count')


def identity(value, where):
    keys(value, 'repository commit tree', where)
    digest(value['repository'], REPO, where + '.repository')
    digest(value['commit'], GIT, where + '.commit')
    digest(value['tree'], GIT, where + '.tree')


def validate(r):
    keys(r, 'schema axis status scope source compiler contract_sha256 fixture_sha256 artifact_sha256 transcript_sha256 toolchain assumptions run counts', 'receipt')
    require(r['schema'] == 'atto.verification-receipt.v1', 'schema')
    require(type(r['axis']) is str and r['axis'] in AXES, 'axis')
    require(type(r['status']) is str and r['status'] in STATUS, 'status')
    string(r['scope'], 'scope')
    identity(r['source'], 'source')
    digest(r['contract_sha256'], HASH, 'contract')
    digest(r['fixture_sha256'], HASH, 'fixture')
    for k in ('toolchain', 'assumptions'):
        require(type(r[k]) is list and len(r[k]) <= 32, k)
        for v in r[k]: string(v, k)
        require(len(set(r[k])) == len(r[k]), k + ': duplicates')
    keys(r['counts'], 'passed failed skipped', 'counts')
    for v in r['counts'].values(): counter(v, 'counts')
    require(r['counts']['passed'] + r['counts']['failed'] + r['counts']['skipped'] <= 10**9, 'count sum')
    executed = r['status'] in {'PASS', 'FAIL'}
    if r['compiler'] is not None: identity(r['compiler'], 'compiler')
    if r['axis'] not in COMPILER_AXES:
        require(r['compiler'] is None, 'host/model evidence cannot claim a compiler')
    if executed:
        if r['axis'] in COMPILER_AXES: require(r['compiler'] is not None, 'compiler identity missing')
        digest(r['artifact_sha256'], HASH, 'artifact')
        digest(r['transcript_sha256'], HASH, 'transcript')
        require(bool(r['toolchain']), 'executed toolchain missing')
        if r['axis'] in PROOF_AXES: require(bool(r['assumptions']), 'proof assumptions missing')
        keys(r['run'], 'location executed_steps', 'run')
        string(r['run']['location'], 'run.location')
        counter(r['run']['executed_steps'], 'run.executed_steps')
        require(r['run']['executed_steps'] > 0, 'no executed steps')
        if r['status'] == 'PASS':
            require(r['counts']['passed'] > 0 and r['counts']['failed'] == r['counts']['skipped'] == 0, 'incomplete pass')
        else: require(r['counts']['failed'] > 0, 'failure without executed failure')
    else:
        require(r['artifact_sha256'] is None and r['transcript_sha256'] is None and r['run'] is None and all(v == 0 for v in r['counts'].values()), 'unexecuted evidence cannot count outcomes')
    return {'axis': r['axis'], 'status': r['status'], 'scope': r['scope'], 'authenticated': False}


def load(raw):
    require(len(raw) <= 262144, 'oversized receipt')
    def pairs(items):
        obj = {}
        for k, v in items:
            require(k not in obj, 'duplicate JSON key')
            obj[k] = v
        return obj
    return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite JSON number')))


if __name__ == '__main__':
    if len(sys.argv) != 2: raise SystemExit('usage: receipt.py receipt.json')
    with Path(sys.argv[1]).open('rb') as f: raw = f.read(262145)
    print(json.dumps(validate(load(raw)), sort_keys=True))
