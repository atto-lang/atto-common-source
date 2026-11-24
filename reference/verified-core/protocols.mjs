import { full, includes, signedI32 } from "./intervals.mjs";
import { elaborateQuantityDeclarations, resolveQuantityUnit, sameUnit } from "./quantities.mjs";

function reject(code, message) {
  throw Object.assign(new Error(message), { code });
}

/** Resolve a file-local declaration into an immutable scalar message table. */
export function elaborateProtocol(declaration, aliases = new Map(), quantities = []) {
  const { name, initial, terminals, edges } = declaration;
  if (!initial) reject("E_PROTOCOL_INITIAL", "missing initial state");
  if (edges.length > 256 || terminals.length > 128) reject("E_PROTOCOL_LIMIT", "protocol is too large");
  const units = elaborateQuantityDeclarations(quantities);
  const states = new Set([initial]);
  const outgoing = new Map();
  const signatures = new Map();
  const terminalStates = new Set();
  const scalar = resolveQuantityUnit(units);

  function resolve(type) {
    if (type === "int") return Object.freeze({ carrier: "int", range: full, unit: scalar });
    if (type === "i32") return Object.freeze({ carrier: "i32", range: signedI32, unit: scalar });
    const alias = aliases.get(type);
    if (!alias) reject("E_PROTOCOL_PAYLOAD", "unknown scalar payload type");
    const { carrier, range: [low, high], unit } = alias;
    const limits = carrier === "int" ? full : carrier === "i32" ? signedI32 : null;
    if (!limits || typeof low !== "bigint" || typeof high !== "bigint" || low > high ||
        !includes(limits, [low, high])) reject("E_PROTOCOL_PAYLOAD", "invalid scalar payload range");
    return Object.freeze({ carrier, range: Object.freeze([low, high]), unit: resolveQuantityUnit(units, unit) });
  }

  for (const { source, target, message, payload = [] } of edges) {
    states.add(source).add(target);
    if (states.size > 128 || payload.length > 16)
      reject("E_PROTOCOL_LIMIT", "too many states or payload fields");
    if (!outgoing.has(source)) outgoing.set(source, new Map());
    const fromState = outgoing.get(source);
    if (fromState.has(message)) reject("E_PROTOCOL_DUPLICATE", "duplicate source state and message edge");
    const fields = new Set();
    const signature = Object.freeze(payload.map(({ name: field, type }) => {
      if (fields.has(field)) reject("E_PROTOCOL_PAYLOAD", "duplicate payload field name");
      fields.add(field);
      return resolve(type);
    }));
    const prior = signatures.get(message);
    if (prior && (prior.length !== signature.length || prior.some((type, i) => {
      const current = signature[i];
      return type.carrier !== current.carrier || type.range[0] !== current.range[0] ||
        type.range[1] !== current.range[1] || !sameUnit(type.unit, current.unit);
    }))) reject("E_PROTOCOL_PAYLOAD", "inconsistent message payload type");
    signatures.set(message, signature);
    fromState.set(message, Object.freeze({ source, target, message, signature }));
  }
  for (const terminal of terminals) {
    if (terminalStates.has(terminal) || !states.has(terminal) || outgoing.has(terminal))
      reject("E_PROTOCOL_TERMINAL", "duplicate, unknown or outgoing terminal state");
    terminalStates.add(terminal);
  }
  return Object.freeze({ name, initial, edge: (state, message) => outgoing.get(state)?.get(message),
    unit: (name) => resolveQuantityUnit(units, name) });
}

/** Sequential oracle for an actor's serial, copy-scalar protocol lane. */
export class SerialProtocolReference {
  #protocol;
  #invariant;
  #state;
  #staging = false;

  constructor(protocol, value, invariant) {
    this.#protocol = protocol;
    this.#invariant = invariant;
    this.#state = this.#initial(value, 1n);
  }

  #initial(value, incarnation) {
    if (typeof value !== "bigint" || !this.#invariant(value))
      reject("E_PROTOCOL_INVARIANT", "initial actor state violates its invariant");
    return Object.freeze({ incarnation, state: this.#protocol.initial, value, live: true });
  }

  get snapshot() { return this.#state; }

  stop() {
    this.#state = Object.freeze({ ...this.#state, live: false });
  }

  restart(value) {
    if (this.#state.live) reject("E_PROTOCOL_LIFECYCLE", "stop the prior incarnation before restart");
    this.#state = this.#initial(value, this.#state.incarnation + 1n);
  }

  dispatch({ incarnation, message, payload }, stage) {
    const before = this.#state;
    if (before.incarnation !== incarnation) return "stale";
    if (!before.live) return "closed";
    if (this.#staging) return "busy";
    const edge = this.#protocol.edge(before.state, message);
    if (!edge) return "illegal-edge";
    if (!Array.isArray(payload) || payload.length !== edge.signature.length || edge.signature.some((type, i) => {
      const { value, unit } = payload[i] ?? {};
      return typeof value !== "bigint" || !includes(type.range, [value, value]) ||
        !Array.isArray(unit?.powers) || !sameUnit(type.unit, unit);
    })) return "invalid-payload";

    this.#staging = true;
    try {
      // The oracle assumes a pure staged handler. Only this operation can
      // publish its returned scalar state and chosen destination together.
      let proposed;
      try {
        proposed = stage(before.value, payload.map(field => field.value));
      } catch {
        return "handler-failed";
      }
      if (proposed?.target !== edge.target) return "wrong-destination";
      if (typeof proposed.value !== "bigint" || !this.#invariant(proposed.value)) return "invariant-failed";
      if (this.#state !== before) return "interrupted";
      this.#state = Object.freeze({ ...before, state: edge.target, value: proposed.value });
      return "committed";
    } finally {
      this.#staging = false;
    }
  }
}
