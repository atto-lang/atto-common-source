import assert from "node:assert/strict";
import test from "node:test";
import { elaborateProtocol } from "./protocols.mjs";
import { decodeProtocolTurnReceipt, encodeProtocolMailboxMessage, protocolMailboxFingerprint } from "./protocol-mailbox.mjs";

const edge = { source: "Waiting", target: "Ready", message: "ready",
  payload: [{ name: "input", type: "int" }] };
const reset = { source: "Ready", target: "Waiting", message: "reset" };
const declaration = { name: "Reset", initial: "Waiting", terminals: [], edges: [edge, reset] };

test("protocol fingerprints canonicalize graph order and distinguish payload carrier types", () => {
  const first = elaborateProtocol(declaration).mailbox;
  const reordered = elaborateProtocol({ ...declaration, edges: [reset, {
    ...edge, payload: [{ name: "renamed", type: "int" }],
  }] }).mailbox;
  const narrowed = elaborateProtocol({ ...declaration, edges: [{
    ...edge, payload: [{ name: "input", type: "i32" }],
  }, reset] }).mailbox;
  assert.equal(protocolMailboxFingerprint(first).length, 32);
  assert.deepEqual(protocolMailboxFingerprint(first), protocolMailboxFingerprint(reordered));
  assert.notDeepEqual(protocolMailboxFingerprint(first), protocolMailboxFingerprint(narrowed));
});

test("the protocol DATA frame preserves the signed i64 bit pattern and rejects the wrong arity", () => {
  const layout = elaborateProtocol(declaration).mailbox;
  const encoded = encodeProtocolMailboxMessage(layout, "ready", [-(1n << 63n)]);
  assert.equal(encoded.length, 47);
  assert.equal(encoded.subarray(0, 5).toString("hex"), "4154504d01");
  assert.equal(encoded.readUInt16LE(37), 0);
  assert.equal(encoded.subarray(39).toString("hex"), "0000000000000080");
  assert.throws(() => encodeProtocolMailboxMessage(layout, "ready", []), RangeError);
  assert.throws(() => encodeProtocolMailboxMessage(layout, "missing", []), RangeError);
});

test("protocol receipts fail on malformed framing, including a high-bit prefix", () => {
  const frame = Buffer.from("41545052010100000000000000020000000000000003000000000000000104000500", "hex");
  assert.deepEqual(decodeProtocolTurnReceipt(frame), {
    actorId: 1n, generation: 2n, turn: 3n, status: 1, source: 4, destination: 5,
  });
  assert.throws(() => decodeProtocolTurnReceipt(frame.subarray(0, -1)), RangeError);
  frame[0] |= 0x80;
  assert.throws(() => decodeProtocolTurnReceipt(frame), RangeError);
});
