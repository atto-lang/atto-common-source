import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export const connectionSourceSha256 = "eed836d5649c2f99eac0e3423a6a694e1792811fa4804c9348213bcfd8dae3df";

// The reviewed fixture defines this fixed model. The abstract stop gate is
// shared with publication, and a candidate takes effect only on its serial turn.
const model = `(set-logic QF_BV)
(declare-fun state () (_ BitVec 2))
(declare-fun elapsed () (_ BitVec 32))
(declare-fun delay () (_ BitVec 32))
(declare-fun complete () Bool)
(declare-fun owns-turn () Bool)
(declare-fun stopped () Bool)
(define-fun stored-valid () Bool (and (bvsge elapsed (_ bv0 32)) (bvsle elapsed (_ bv10 32))))
(define-fun payload-valid () Bool (and (bvsge delay (_ bv1 32)) (bvsle delay (_ bv60000 32))))
(define-fun edge () Bool
  (or (and (= state #b00) (not complete))
      (and (= state #b01) complete)))
(define-fun destination () (_ BitVec 2) (ite complete #b10 #b01))
(define-fun staged () (_ BitVec 33)
  (bvadd ((_ sign_extend 1) elapsed) ((_ sign_extend 1) delay)))
(define-fun fits-i32 () Bool (= staged ((_ sign_extend 1) ((_ extract 31 0) staged))))
(define-fun invariant () Bool
  (and (bvsge staged (_ bv0 33)) (bvsle staged (_ bv10 33))))
(define-fun pre-publish () Bool (and edge payload-valid owns-turn (not stopped)))
(define-fun commit () Bool (and pre-publish fits-i32 invariant))
(define-fun new-elapsed () (_ BitVec 32)
  (ite commit ((_ extract 31 0) staged) elapsed))
(define-fun new-state () (_ BitVec 2) (ite commit destination state))
(assert stored-valid)
(assert (bvule state #b10))
`;

const obligations = [
  ["initializer", "(not (and (bvsge (_ bv2 32) (_ bv0 32)) (bvsle (_ bv2 32) (_ bv10 32))))", "unsat"],
  ["carrier-representability", "(and payload-valid (not fits-i32))", "unsat"],
  ["invariant-after-dispatch",
    "(or (bvslt new-elapsed (_ bv0 32)) (bvsgt new-elapsed (_ bv10 32)))", "unsat"],
  ["edge-and-authority",
    `(and commit (not (and owns-turn (not stopped) payload-valid
      (or (and (= state #b00) (not complete) (= new-state #b01))
          (and (= state #b01) complete (= new-state #b10))))))`, "unsat"],
  ["rollback-pair",
    "(and (not commit) (or (not (= new-elapsed elapsed)) (not (= new-state state))))", "unsat"],
  ["commit-reachable", "commit", "sat"],
  ["omitted-invariant-mutant", "(and pre-publish fits-i32 (not invariant))", "sat"],
  ["omitted-stop-fence-mutant", "(and edge payload-valid owns-turn fits-i32 invariant stopped)", "sat"],
];

export function verifyConnectionStaging(sourceBytes, solver) {
  const sourceSha256 = hash(sourceBytes);
  if (sourceSha256 !== connectionSourceSha256)
    throw new Error("Staging proof requires the reviewed Connection source");
  const results = obligations.map(([id, counterexample, expected]) => {
    const query = model + `(assert ${counterexample})\n(check-sat)\n`;
    const replay = spawnSync(solver, ["-smt2", "-in"], {
      input: query, encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024,
    });
    if (replay.error) throw replay.error;
    const verdict = replay.stdout.trim();
    if (replay.status !== 0 || replay.stderr.trim() !== "" || verdict !== expected)
      throw new Error(`Staging proof ${id}: expected ${expected}, received ${replay.stdout}${replay.stderr}`);
    return { id, querySha256: hash(query), verdict };
  });
  return {
    profile: "connection-serial-staging-model-v1", sourceSha256,
    solverSha256: hash(readFileSync(solver)), results,
  };
}
