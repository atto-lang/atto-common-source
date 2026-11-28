"""Replay the reviewed abstract single-allocation ownership model."""
import argparse
import hashlib
from pathlib import Path
import subprocess

DIGEST = 'dd3bd54108edadddf4cf07bbb94bf8e26cebc49beb4d5973274a37ff313cf36e'
LABELS = '''P01 initial invariant
P02 allocation preserves invariant
P03 transfer preserves invariant
P04 retirement preserves invariant
P05 loan issuance preserves invariant
P06 loan release preserves invariant
P07 all modeled steps preserve generations monotonically
P08 live loan excludes transfer and retirement
P09 stale owner generation cannot be admitted
P10 stale loan generation cannot be admitted
P11 stale loan slot epoch cannot be admitted
P12 owner write and loan access cannot coexist
P13 owner read and writer loan cannot coexist
P14 retired allocation admits no access
P15 transfer invalidates prior owner generation
P16 reissued loan slot increments its epoch
M01 mutable issuance ignoring other readers violates invariant
M02 retirement ignoring live loan violates invariant
M03 two moves without generation advance admit original owner token
M04 missing loan slot epoch invalidation admits old epoch on reuse
R01 second read loan admitted alongside first
R02 exclusive writer
R03 owner transfer
R04 allocation with a nonzero prior generation admissible
R05 release of valid read loan'''.splitlines()
EXPECTED = ''.join(x+'\n'+('unsat' if x.startswith('P') else 'sat')+'\n' for x in LABELS).encode()


def validate(model, output):
    if hashlib.sha256(model).hexdigest() != DIGEST:
        raise ValueError('unreviewed ownership model bytes')
    if output != EXPECTED:
        raise ValueError('ownership solver transcript mismatch')


def run(argv, data=None):
    p = subprocess.run(argv,input=data,capture_output=True,timeout=60)
    if p.returncode or p.stderr or len(p.stdout)>65536:
        raise RuntimeError('solver command failed')
    return p.stdout


def main():
    p=argparse.ArgumentParser();p.add_argument('--solver',required=True);a=p.parse_args()
    model=Path(__file__).with_name('model.smt2').read_bytes()
    if hashlib.sha256(model).hexdigest()!=DIGEST: raise ValueError('unreviewed model')
    version=run([a.solver,'-version']).split()
    if version[:3] not in ([b'Z3',b'version',b'4.13.3'],[b'Z3',b'version',b'4.13.3.0']): raise ValueError('unexpected solver version')
    output=run([a.solver,'-in','-smt2'],model)
    validate(model,output)
    print(output.decode(),end='')
    mutations=[(model+b' ',output),(b'',output),(model,b''),(model,output+b'sat\n'),(model,output.replace(b'unsat',b'unknown',1)),(model,output.replace(b'unsat',b'sat',1)),(model,output.replace(b'\nsat\n',b'\nunsat\n',1))]
    for m,o in mutations:
        try: validate(m,o)
        except ValueError: continue
        raise AssertionError('bad model/transcript accepted')
    print('OWNERSHIP_MODEL_PASS 16 UNSAT, 4 mutant SAT, 5 admission SAT; 7 invalid replays rejected')

if __name__=='__main__': main()
