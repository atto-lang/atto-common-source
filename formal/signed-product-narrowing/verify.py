"""Replay the reviewed model and test representative LLVM checked multiplication."""
import argparse
import ctypes as C
import hashlib
import itertools
from pathlib import Path
import random
import subprocess
import tempfile

EXPECTED = 'bff0a373572d334d69a04887a0a5a0f790e4804f650e0bffdd20372aa1573285'
LABELS = '''P01 overflow iff exact product outside signed i64
P02 accepted product equals sign-extended result
P03 every signed i64 value is accepted
P04 accepted negative result has all-one high half
M01 high-half-zero-only guard is incorrect
M02 low-sign-only guard is incorrect
M03 accepting either zero or all-one high half is incorrect
R01 exact signed minimum accepted
R02 exact signed maximum accepted
R03 one above maximum rejected
R04 one below minimum rejected'''.splitlines()
TRANSCRIPT = ''.join(label + '\n' + ('unsat' if label.startswith('P') else 'sat') + '\n' for label in LABELS).encode()


def validate(model, output):
    if hashlib.sha256(model).hexdigest() != EXPECTED:
        raise ValueError('model bytes differ from reviewed digest')
    if output != TRANSCRIPT:
        raise ValueError('unexpected solver transcript')


def checked_run(argv, data=None):
    p = subprocess.run(argv, input=data, capture_output=True, timeout=60)
    if p.returncode or p.stderr or len(p.stdout) > 65536:
        raise RuntimeError(f'command failed or output invalid: {argv[0]}')
    return p.stdout


def run_native(clang):
    # Handwritten representative IR, not an Atto-generated artifact.
    source = b'''declare {i64, i1} @llvm.smul.with.overflow.i64(i64, i64)
    define i32 @checked_mul(i64 %a, i64 %b, ptr %out) {
    entry:
      %pair = call {i64, i1} @llvm.smul.with.overflow.i64(i64 %a, i64 %b)
      %value = extractvalue {i64, i1} %pair, 0
      %overflow = extractvalue {i64, i1} %pair, 1
      br i1 %overflow, label %err, label %ok
    err:
      ret i32 1
    ok:
      store i64 %value, ptr %out, align 8
      ret i32 0
    }
    '''
    lo, hi = -(1 << 63), (1 << 63) - 1
    edges = [lo, lo+1, -3037000500, -3037000499, -2, -1, 0, 1, 2, 3037000499, 3037000500, hi-1, hi]
    rng = random.Random(20261126)
    pairs = list(itertools.product(edges, repeat=2))
    # Stratified corpus: full width, fitting small products, mixed magnitudes.
    pairs += [(rng.randint(lo, hi), rng.randint(lo, hi)) for _ in range(40000)]
    pairs += [(rng.randint(-(1<<31), (1<<31)-1), rng.randint(-(1<<31), (1<<31)-1)) for _ in range(40000)]
    pairs += [(rng.randint(lo, hi), rng.choice([-2,-1,0,1,2])) for _ in range(20000)]
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp); (p/'mul.ll').write_bytes(source)
        for opt in (0, 2):
            target = p/f'mul-O{opt}.so'
            subprocess.run([clang, f'-O{opt}', '-shared', '-fPIC', str(p/'mul.ll'), '-o', str(target)], check=True, capture_output=True, timeout=60)
            lib = C.CDLL(str(target)); fn = lib.checked_mul
            fn.argtypes = [C.c_int64, C.c_int64, C.POINTER(C.c_int64)]; fn.restype = C.c_int32
            ok = err = 0
            for a,b in pairs:
                exact = a*b; expected = int(not lo <= exact <= hi)
                out = C.c_int64(1234567); status = fn(a,b,C.byref(out))
                if status != expected or out.value != (1234567 if expected else exact):
                    raise AssertionError((opt,a,b,status,out.value,expected,exact))
                ok += int(not expected); err += expected
            print(f'O{opt}: {len(pairs)} checks ({ok} exact products, {err} overflow denials preserving output)')
    print(f'REPRESENTATIVE_NATIVE_MUL_PASS {2*len(pairs)}; NOT production compiler evidence')


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--solver', required=True); parser.add_argument('--clang')
    args = parser.parse_args()
    model = Path(__file__).with_name('model.smt2').read_bytes()
    if hashlib.sha256(model).hexdigest() != EXPECTED:
        raise ValueError('unreviewed model')
    version = checked_run([args.solver,'-version']).split()
    if version[:3] not in ([b'Z3', b'version', b'4.13.3'], [b'Z3', b'version', b'4.13.3.0']):
        raise RuntimeError('expected Z3 4.13.3')
    output = checked_run([args.solver,'-in','-smt2'], model)
    validate(model, output)
    print(output.decode(), end='')
    bad = [(model+b' ',output),(b'',output),(model,b''),(model,output+b'sat\n'),(model,output.replace(b'unsat',b'unknown',1)),(model,output.replace(b'unsat',b'sat',1)),(model,output.replace(b'\nsat\n',b'\nunsat\n',1))]
    for m,o in bad:
        try: validate(m,o)
        except ValueError: continue
        raise AssertionError('invalid replay accepted')
    print('NARROWING_MODEL_PASS 4 UNSAT, 3 mutation SAT, 4 reachability SAT; 7 invalid replays rejected')
    if args.clang: run_native(args.clang)

if __name__ == '__main__': main()
