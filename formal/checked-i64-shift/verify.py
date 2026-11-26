"""Shared checked-i64 shift model and representative native/Wasm execution.
This does not invoke an Atto compiler or verify production lowering.
"""
import argparse
import ctypes as C
import hashlib
import itertools
import json
from pathlib import Path
import random
import subprocess
import tempfile

DIGEST = '71dd756ba461c7491487c737c0e39baf8243b3440838506821cd39e989e4ada1'
LABELS = '''P01 unsigned guard iff signed range
P02 safe count always in range
P03 admitted count preserved
P04 masked hardware count agrees only on admitted inputs
P05 left shift is low 64 bits of widened shift
P06 logical right shift agrees with zero-extended shift
P07 arithmetic right shift agrees with sign-extended shift
M01 signed upper-only guard admits negative counts
M02 narrowing before admission hides invalid counts
M03 logical and arithmetic right shift differ
R01 zero count admitted
R02 sixty-three admitted
R03 sixty-four denied
R04 negative count denied'''.splitlines()
EXPECTED = ''.join(s+'\n'+('unsat' if s.startswith('P') else 'sat')+'\n' for s in LABELS).encode()


def validate(model, transcript):
    if hashlib.sha256(model).hexdigest() != DIGEST or transcript != EXPECTED:
        raise ValueError('unreviewed model or unexpected solver transcript')


def checked_run(argv, data=None):
    p = subprocess.run(argv, input=data, capture_output=True, timeout=90)
    if p.returncode or p.stderr or len(p.stdout) > 65536:
        raise RuntimeError(f'failed command {argv[0]}: {p.stderr[:1000]!r}')
    return p.stdout


def native_wasm(clang, node):
    ir = '\n'.join('''define i32 @checked_OP(i64 %a, i64 %n, ptr %out) {
entry:
  %valid = icmp ult i64 %n, 64
  br i1 %valid, label %ok, label %err
err:
  ret i32 1
ok:
  %safe = select i1 %valid, i64 %n, i64 0
  %value = OP i64 %a, %safe
  store i64 %value, ptr %out, align 8
  ret i32 0
}
'''.replace('OP', op) for op in ('shl', 'lshr', 'ashr'))
    lo, hi, mask = -(1<<63), (1<<63)-1, (1<<64)-1
    edge = [lo, lo+1, -9007199254740993, -2, -1, 0, 1, 2, 9007199254740993, hi-1, hi]
    counts = [lo, -4294967296, -65, -64, -1, *range(64), 64, 65, 127, 128, 4294967296, hi]
    rng = random.Random(20261126)
    pairs = list(itertools.product(edge, counts))
    pairs += [(rng.randint(lo, hi), rng.randrange(64)) for _ in range(50000)]
    pairs += [(rng.randint(lo, hi), rng.randint(lo, hi)) for _ in range(50000)]
    def signed(x):
        x &= mask
        return x if x <= hi else x-(1<<64)
    rows = []
    for a,n in pairs:
        expected = [signed(a*(1<<n)), signed((a & mask)//(1<<n)), a//(1<<n)] if 0 <= n < 64 else None
        rows.append([str(a),str(n),None if expected is None else list(map(str,expected))])
    js = '''import fs from 'node:fs';
const [file, cases] = process.argv.slice(2);
const {instance} = await WebAssembly.instantiate(fs.readFileSync(file));
const memory = new DataView(instance.exports.memory.buffer);
const rows = JSON.parse(fs.readFileSync(cases, 'utf8'));
for (const [i,op] of ['shl','lshr','ashr'].entries()) {
  let ok=0, denied=0;
  for (const [a,n,expected] of rows) {
    memory.setBigInt64(4096,1234567n,true);
    const status=instance.exports['checked_'+op](BigInt(a),BigInt(n),4096);
    const want=expected===null?1234567n:BigInt(expected[i]);
    if(status!==(expected===null?1:0)||memory.getBigInt64(4096,true)!==want) throw Error(`${op} ${a} ${n}`);
    if(expected===null) denied++; else ok++;
  }
  console.log(`Wasm ${op}: ${ok} values, ${denied} denials`);
}
'''
    with tempfile.TemporaryDirectory() as tmp:
        p=Path(tmp); (p/'shift.ll').write_text(ir); (p/'cases.json').write_text(json.dumps(rows)); (p/'wasm.mjs').write_text(js)
        for level in (0,2):
            lib=p/f'shift-O{level}.so'; wasm=p/f'shift-O{level}.wasm'
            subprocess.run([clang,f'-O{level}','-shared','-fPIC',str(p/'shift.ll'),'-o',str(lib)],check=True,capture_output=True,timeout=90)
            dll=C.CDLL(str(lib))
            for i,op in enumerate(('shl','lshr','ashr')):
                f=getattr(dll,'checked_'+op); f.argtypes=[C.c_int64,C.c_int64,C.POINTER(C.c_int64)];f.restype=C.c_int32
                ok=denied=0
                for (a,n),row in zip(pairs,rows):
                    expected=row[2]; out=C.c_int64(1234567); status=f(a,n,C.byref(out))
                    if status!=int(expected is None) or out.value!=(1234567 if expected is None else int(expected[i])):
                        raise AssertionError((level,op,a,n,status,out.value,expected))
                    if expected is None: denied+=1
                    else: ok+=1
                print(f'Native O{level} {op}: {ok} values, {denied} denials')
            subprocess.run([clang,'--target=wasm32',f'-O{level}','-nostdlib','-Wl,--no-entry','-Wl,--export=checked_shl','-Wl,--export=checked_lshr','-Wl,--export=checked_ashr','-Wl,--export-memory',str(p/'shift.ll'),'-o',str(wasm)],check=True,capture_output=True,timeout=90)
            print(f'Wasm O{level}:\n'+checked_run([node,str(p/'wasm.mjs'),str(wasm),str(p/'cases.json')]).decode(),end='')
    print(f'REPRESENTATIVE_SHIFT_PASS {12*len(rows)} checks; NOT Atto compiler evidence')


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--solver',required=True);parser.add_argument('--clang');parser.add_argument('--node')
    args=parser.parse_args();model=Path(__file__).with_name('model.smt2').read_bytes()
    if hashlib.sha256(model).hexdigest()!=DIGEST: raise ValueError('unreviewed model')
    version=checked_run([args.solver,'-version']).split()
    if version[:3] not in ([b'Z3',b'version',b'4.13.3'],[b'Z3',b'version',b'4.13.3.0']):raise RuntimeError('expected Z3 4.13.3')
    transcript=checked_run([args.solver,'-in','-smt2'],model);validate(model,transcript)
    for m,t in [(model+b' ',transcript),(model,b''),(model,transcript+b'sat\n'),(model,transcript.replace(b'unsat',b'unknown',1)),(model,transcript.replace(b'unsat',b'sat',1))]:
        try:validate(m,t)
        except ValueError:continue
        raise AssertionError('bad replay accepted')
    print(transcript.decode(),end='');print('SHIFT_MODEL_PASS 7 UNSAT, 3 mutation SAT, 4 reachability SAT, 5 invalid replays rejected')
    if bool(args.clang)!=bool(args.node):raise ValueError('supply both clang and node for native/Wasm execution')
    if args.clang:native_wasm(args.clang,args.node)

if __name__=='__main__':main()
