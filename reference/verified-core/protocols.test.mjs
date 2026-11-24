import assert from "node:assert/strict";
import test from "node:test";
import { elaborateProtocol, SerialProtocolReference } from "./protocols.mjs";

const quantityDeclarations = [
  { kind: "dimension", name: "Time" },
  { kind: "unit", name: "Second", dimension: "Time" },
  { kind: "unit", name: "Millis", dimension: "Time", relativeTo: "Second", factor: "1000", divide: true },
  { kind: "unit", name: "Tick", dimension: "Time", relativeTo: "Millis" },
];
const aliases = new Map([
  ["Timeout", { carrier: "i32", unit: "Millis", range: [1n, 60_000n] }],
  ["EquivalentTimeout", { carrier: "i32", unit: "Tick", range: [1n, 60_000n] }],
]);
const connection = {
  name: "Connection",
  initial: "Disconnected",
  terminals: ["Failed"],
  edges: [
    { source: "Disconnected", target: "Connecting", message: "connect",
      payload: [{ name: "timeout", type: "Timeout" }] },
    { source: "Connecting", target: "Connected", message: "ready" },
    { source: "Connecting", target: "Failed", message: "fail" },
    { source: "Connected", target: "Connecting", message: "connect",
      payload: [{ name: "replacement", type: "EquivalentTimeout" }] },
  ],
};
const graph = (declaration = connection) => elaborateProtocol(declaration, aliases, quantityDeclarations);

test("a tag can recur across states with the same resolved message type", () => {
  const protocol = graph();
  assert.equal(protocol.edge("Disconnected", "connect").target, "Connecting");
  assert.equal(protocol.edge("Connected", "connect").signature[0].carrier, "i32");
  assert.equal(protocol.edge("Connecting", "connect"), undefined);
  assert.equal(protocol.edge("Failed", "connect"), undefined);
});

test("invalid initial states, terminals, duplicate edges and changed payloads fail declaration", () => {
  const extra = (edge) => ({ ...connection, edges: [...connection.edges, edge] });
  assert.throws(() => graph({ ...connection, initial: undefined }), { code: "E_PROTOCOL_INITIAL" });
  assert.throws(() => graph({ ...connection, terminals: ["Unknown"] }), { code: "E_PROTOCOL_TERMINAL" });
  assert.throws(() => graph(extra({ source: "Failed", target: "Connected", message: "retry" })),
    { code: "E_PROTOCOL_TERMINAL" });
  assert.throws(() => graph(extra(connection.edges[0])), { code: "E_PROTOCOL_DUPLICATE" });
  assert.throws(() => graph(extra({ source: "Connecting", target: "Connected", message: "connect",
    payload: [{ name: "timeout", type: "int" }] })), { code: "E_PROTOCOL_PAYLOAD" });
});

test("only a legal edge with the checked payload and invariant publishes state", () => {
  const protocol = graph();
  const actor = new SerialProtocolReference(protocol, 0n, (elapsed) => elapsed >= 0n);
  const request = (value, unit = "Millis") => ({
    incarnation: 1n, message: "connect", payload: [{ value, unit: protocol.unit(unit) }],
  });
  const accept = (elapsed, [timeout]) => ({ target: "Connecting", value: elapsed + timeout });
  const before = actor.snapshot;
  assert.equal(actor.dispatch({ incarnation: 1n, message: "ready", payload: [] }, accept), "illegal-edge");
  assert.equal(actor.dispatch(request(0n), accept), "invalid-payload");
  assert.equal(actor.dispatch(request(60_001n), accept), "invalid-payload");
  assert.equal(actor.dispatch(request(42n, "Second"), accept), "invalid-payload");
  assert.equal(actor.dispatch(request(42n), () => { throw new Error("staged failure"); }), "handler-failed");
  assert.equal(actor.dispatch(request(42n), () => ({ target: "Connected", value: 42n })), "wrong-destination");
  assert.equal(actor.dispatch(request(42n), () => ({ target: "Connecting", value: -1n })), "invariant-failed");
  assert.equal(actor.snapshot, before);
  assert.equal(actor.dispatch(request(42n, "Tick"), accept), "committed");
  assert.deepEqual(actor.snapshot, { incarnation: 1n, state: "Connecting", value: 42n, live: true });
  assert.equal(actor.dispatch(request(42n), accept), "illegal-edge");
});

test("stop before publication fences the staged turn and restart fences the old message", () => {
  const protocol = graph();
  const actor = new SerialProtocolReference(protocol, 0n, (elapsed) => elapsed >= 0n);
  const request = { incarnation: 1n, message: "connect", payload: [
    { value: 42n, unit: protocol.unit("Millis") },
  ] };
  assert.equal(actor.dispatch(request, () => {
    assert.equal(actor.dispatch(request, () => assert.fail()), "busy");
    actor.stop();
    return { target: "Connecting", value: 42n };
  }), "interrupted");
  assert.deepEqual(actor.snapshot, { incarnation: 1n, state: "Disconnected", value: 0n, live: false });
  assert.equal(actor.dispatch(request, () => assert.fail()), "closed");
  assert.throws(() => actor.restart(-1n), { code: "E_PROTOCOL_INVARIANT" });
  actor.restart(0n);
  assert.equal(actor.dispatch(request, () => assert.fail()), "stale");
  assert.equal(actor.dispatch({ ...request, incarnation: 2n },
    () => ({ target: "Connecting", value: 42n })), "committed");
  actor.stop();
  assert.deepEqual(actor.snapshot, { incarnation: 2n, state: "Connecting", value: 42n, live: false });
});
