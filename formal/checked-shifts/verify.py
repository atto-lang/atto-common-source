"""Exact reviewed model replay and independent shift-bit-pattern witnesses."""
import argparse
import hashlib
from pathlib import Path
import random
import subprocess
import tempfile

MODEL_SHA256 = '63e32cbc980b0144695262d9fcce03d96ac84af52dc037629223891c496fa451'
LABELS = '''P01 unsigned guard equals signed interval
P02 left shift equals low half of widened shift
P03 logical right equals zero-extended widened shift
P04 arithmetic right equals sign-extended widened shift
P05 zero count preserves every bit
M01 masking invalid distances admits invalid input
M02 signed upper bound alone admits negative count
M03 arithmetic and logical right are not interchangeable
R01 last legal count
R02 first too-large count
R03 negative one
R04 minimum signed count'''.splitlines()
EXPECTED = ''.join(x+'\n'+('unsat' if x.startswith('P') else 'sat')+'\n' for x in LABELS).encode()


def replay(solver):
    model = Path(__file__).with_name('model.smt2').read_bytes()
    if hashlib.sha256(model).hexdigest() != MODEL_SHA256:
        raise ValueError('unreviewed model bytes')
    version = subprocess.run([solver,'-version'],check=True,capture_output=True,timeout=10)
    if version.stderr or version.stdout.split()[:3] not in ([b'Z3',b'version',b'4.13.3'],[b'Z3',b'version',b'4.13.3.0']):
        raise ValueError('unexpected solver version')
    p = subprocess.run([solver,'-in','-smt2'],input=model,capture_output=True,timeout=60)
    if p.returncode or p.stderr or p.stdout != EXPECTED:
        raise ValueError('unexpected solver transcript')
    print(p.stdout.decode(),end='')


C_SOURCE = r'''#include <stdint.h>
#include <stdio.h>
#include <inttypes.h>
int main(void) {
 uint64_t a,n;
 int rc;
 while ((rc=scanf("%" SCNx64 " %" SCNx64,&a,&n))==2) {
   if(n>=64) { puts("reject"); continue; }
   uint64_t logical=a>>n;
   uint64_t arithmetic=logical;
   if(n && (a>>63)) arithmetic|=UINT64_MAX<<(64-n);
   printf("%016" PRIx64 " %016" PRIx64 " %016" PRIx64 "\n",a<<n,logical,arithmetic);
 }
 return rc==EOF ? 0 : 1;
}'''
JAVA_SOURCE = r'''import java.io.*;
import java.util.*;
class ShiftWitness {
 public static void main(String[] args) throws IOException {
  var in=new BufferedReader(new InputStreamReader(System.in));
  var out=new BufferedWriter(new OutputStreamWriter(System.out));
  String line;
  while((line=in.readLine())!=null){
   String[] p=line.split(" ");
   long a=Long.parseUnsignedLong(p[0],16), n=Long.parseUnsignedLong(p[1],16);
   if(n<0 || n>63) {out.write("reject\n"); continue;}
   out.write(String.format(Locale.ROOT,"%016x %016x %016x\n",a<<n,a>>>n,a>>n));
  }
  out.flush();
 }
}'''
JS_SOURCE = r'''import fs from 'node:fs';
const mask=(1n<<64n)-1n;
const hex=x=>(x&mask).toString(16).padStart(16,'0');
const lines=fs.readFileSync(0,'utf8').trimEnd().split('\n');
for(const line of lines){
 const [a,n]=line.split(' ').map(s=>BigInt('0x'+s));
 if(n>=64n){console.log('reject');continue;}
 console.log(hex(a<<n)+' '+hex(a>>n)+' '+hex(BigInt.asIntN(64,a)>>n));
}'''


def witnesses(cc, javac, java, node):
    mask=(1<<64)-1; lo=-(1<<63); hi=(1<<63)-1
    edges=[lo,lo+1,-(1<<53)-1,-8,-1,0,1,8,(1<<53)+1,hi-1,hi]
    counts=list(range(64))+[lo,-65,-64,-1,64,65,127,hi]
    pairs=[(a,n) for a in edges for n in counts]
    rng=random.Random(20261126)
    pairs += [(rng.randint(lo,hi),rng.randrange(64)) for _ in range(60000)]
    pairs += [(rng.randint(lo,hi),rng.randint(lo,hi)) for _ in range(40000)]
    source=''.join(f'{a&mask:016x} {n&mask:016x}\n' for a,n in pairs).encode()
    expected=[]
    for a,n in pairs:
        if not 0<=n<64: expected.append('reject'); continue
        # Reference uses integer multiplication and floor division, not host shifts.
        factor=2**n
        expected.append(f'{(a*factor) % (2**64):016x} {(a%(2**64))//factor:016x} {(a//factor)%(2**64):016x}')
    oracle=('\n'.join(expected)+'\n').encode()
    with tempfile.TemporaryDirectory() as tmp:
        d=Path(tmp)
        (d/'shift.c').write_text(C_SOURCE); (d/'ShiftWitness.java').write_text(JAVA_SOURCE); (d/'shift.mjs').write_text(JS_SOURCE)
        commands=[]
        for opt in (0,2):
            target=d/f'shift-O{opt}'
            subprocess.run([cc,f'-O{opt}','-std=c11','-Wall','-Wextra','-Werror',str(d/'shift.c'),'-o',str(target)],check=True,timeout=60)
            commands.append((f'C O{opt}',[str(target)]))
        subprocess.run([javac,'-d',str(d),str(d/'ShiftWitness.java')],check=True,timeout=60)
        commands.extend([('Java',[java,'-cp',str(d),'ShiftWitness']),('JavaScript',[node,str(d/'shift.mjs')])])
        valid=sum(0<=n<64 for _,n in pairs)
        for label,cmd in commands:
            p=subprocess.run(cmd,input=source,capture_output=True,timeout=60)
            if p.returncode or p.stderr or p.stdout!=oracle:
                raise RuntimeError(label+' witness differs from reference')
            print(f'{label}: {valid} valid triples, {len(pairs)-valid} invalid counts rejected')
    print(f'WITNESS_PASS {len(pairs)*len(commands)} rows; {valid*3*len(commands)} result values; NOT Atto compiler receipts')


def main():
    p=argparse.ArgumentParser(); p.add_argument('--solver',required=True); p.add_argument('--witnesses',action='store_true'); p.add_argument('--cc',default='clang'); p.add_argument('--javac',default='javac'); p.add_argument('--java',default='java'); p.add_argument('--node',default='node'); a=p.parse_args()
    replay(a.solver)
    if a.witnesses: witnesses(a.cc,a.javac,a.java,a.node)

if __name__=='__main__': main()
