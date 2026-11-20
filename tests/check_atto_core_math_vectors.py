#!/usr/bin/env python3
"""Independent signed-i64 reference vectors. No AttoLang compiler is invoked."""
from pathlib import Path
import hashlib
import json
import sys

REL = 'contracts/atto-core-math-v1/vectors.json'
MANIFEST_SHA256 = 'e9fb919db1cfa4f48d9a9ef844c38256a60a5cf2a7521c426cbdfc325d3f6b76'
MAX_BYTES = 131072
MIN_CASES = 300
MAX_CASES = 512
I64_MIN = -(1 << 63)
I64_MAX = (1 << 63) - 1

class Rejected(ValueError):
    pass

def no_duplicate_keys(pairs):
    data={}
    for key,value in pairs:
        if key in data:
            raise Rejected('duplicate JSON key')
        data[key]=value
    return data

def deny_constant(_):
    raise Rejected('nonfinite JSON number')

def i64(value):
    return type(value) is int and I64_MIN <= value <= I64_MAX

def oracle(op, args):
    if op=='min' and len(args)==2:
        return min(args[0],args[1])
    if op=='max' and len(args)==2:
        return max(args[0],args[1])
    if op=='clamp' and len(args)==3:
        value,lo,hi=args
        return lo if lo>hi or value<lo else hi if value>hi else value
    raise Rejected('unsupported scalar operation/arity')

def check(path: Path, *, require_pinned_hash=True):
    path=Path(path)
    if path.is_symlink() or path.parent.is_symlink() or not path.is_file():
        raise Rejected('invalid vector file kind')
    with path.open('rb') as h:
        raw=h.read(MAX_BYTES+1)
    if not raw or len(raw)>MAX_BYTES or b'\x00' in raw or raw.startswith(b'\xef\xbb\xbf'):
        raise Rejected('oversized or unsafe vector JSON')
    if require_pinned_hash and hashlib.sha256(raw).hexdigest()!=MANIFEST_SHA256:
        raise Rejected('reference fixture byte identity drift')
    try:
        doc=json.loads(raw.decode('utf-8','strict'),object_pairs_hook=no_duplicate_keys,parse_constant=deny_constant)
    except Rejected:
        raise
    except (UnicodeError,ValueError,OverflowError,RecursionError) as e:
        raise Rejected('invalid reference fixture JSON') from e
    if type(doc) is not dict or set(doc)!={'schema','claim_tier','cases'}:
        raise Rejected('invalid fixture schema')
    if doc['schema']!='atto-core-math-v1' or doc['claim_tier']!='REFERENCE_ONLY_NOT_COMPILER_EXECUTED':
        raise Rejected('unauthorized guest execution claim')
    cases=doc['cases']
    if type(cases) is not list or not (MIN_CASES<=len(cases)<=MAX_CASES):
        raise Rejected('case coverage budget violation')
    seen=set()
    op_count={'min':0,'max':0,'clamp':0}
    for row in cases:
        if type(row) is not dict or set(row)!={'id','op','args','expected'}:
            raise Rejected('unsupported vector entry shape')
        cid,op,args,expected=row['id'],row['op'],row['args'],row['expected']
        if type(cid) is not str or not cid.isascii() or len(cid)>64 or not cid or cid in seen:
            raise Rejected('malformed/duplicate vector ID')
        seen.add(cid)
        if type(op) is not str or op not in op_count or type(args) is not list:
            raise Rejected('invalid operation/arguments')
        if not all(i64(v) for v in args) or not i64(expected):
            raise Rejected('out-of-range/noninteger i64 scalar')
        if oracle(op,args)!=expected:
            raise Rejected('incorrect signed-i64 reference result')
        op_count[op]+=1
    if any(n<60 for n in op_count.values()):
        raise Rejected('insufficient per-operation corpus coverage')
    return len(cases)

def main():
    try:
        count=check(Path(__file__).resolve().parents[1]/REL)
    except Rejected as exc:
        print('ATTO_CORE_REFERENCE_REJECTED='+str(exc),file=sys.stderr)
        return 1
    print(f'ATTO_CORE_REFERENCE_ONLY|cases={count}|compiler=NOT_EXECUTED')
    return 0

if __name__=='__main__':
    sys.exit(main())
