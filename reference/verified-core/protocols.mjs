import { full, includes, signedI32 } from "./intervals.mjs";
import { elaborateQuantityDeclarations, resolveQuantityUnit, sameUnit } from "./quantities.mjs";

const actorBindings = new WeakMap();

function reject(code, message) {
  throw Object.assign(new Error(message), { code });
}

function samePayload(left, right) {
  return left.length === right.length && left.every((type, index) => {
    const other = right[index];
    return type.carrier === other.carrier && type.range[0] === other.range[0] &&
      type.range[1] === other.range[1] && sameUnit(type.unit, other.unit);
  });
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

  function payloadTypes(payload) {
    if (payload.length > 16) reject("E_PROTOCOL_LIMIT", "too many payload fields");
    const fields = new Set();
    return Object.freeze(payload.map(({ name: field, type }) => {
      if (fields.has(field)) reject("E_PROTOCOL_PAYLOAD", "duplicate payload field name");
      fields.add(field);
      return resolve(type);
    }));
  }

  for (const { source, target, message, payload = [] } of edges) {
    states.add(source).add(target);
    if (states.size > 128) reject("E_PROTOCOL_LIMIT", "too many states");
    if (!outgoing.has(source)) outgoing.set(source, new Map());
    const fromState = outgoing.get(source);
    if (fromState.has(message)) reject("E_PROTOCOL_DUPLICATE", "duplicate source state and message edge");
    const signature = payloadTypes(payload);
    const prior = signatures.get(message);
    if (prior) {
      if (!samePayload(prior.types, signature))
        reject("E_PROTOCOL_PAYLOAD", "inconsistent message payload type");
      prior.destinations.add(target);
    } else {
      signatures.set(message, { types: signature, destinations: new Set([target]) });
    }
    fromState.set(message, Object.freeze({ source, target, message, signature }));
  }
  for (const terminal of terminals) {
    if (terminalStates.has(terminal) || !states.has(terminal) || outgoing.has(terminal))
      reject("E_PROTOCOL_TERMINAL", "duplicate, unknown or outgoing terminal state");
    terminalStates.add(terminal);
  }
  const mailbox = Object.freeze({
    name, initial,
    states: Object.freeze([...states].sort().map(state => Object.freeze({
      name: state, terminal: terminalStates.has(state),
    }))),
    messages: Object.freeze([...signatures.keys()].sort().map(message => Object.freeze({
      name: message, fields: signatures.get(message).types,
    }))),
    edges: Object.freeze([...outgoing.keys()].sort().flatMap(source =>
      [...outgoing.get(source).keys()].sort().map(message => outgoing.get(source).get(message)))),
  });
  const protocol = Object.freeze({
    name, initial, mailbox,
    edge: (state, message) => outgoing.get(state)?.get(message),
    unit: (name) => resolveQuantityUnit(units, name),
    bindActor(actorName, handlers) {
      const destinations = new Map();
      for (const { message, parameters = [], destination } of handlers) {
        const signature = signatures.get(message);
        if (!signature || destinations.has(message))
          reject("E_PROTOCOL_HANDLER", "undeclared or duplicate handler");
        if (!samePayload(signature.types, payloadTypes(parameters)))
          reject("E_PROTOCOL_PAYLOAD", "handler parameter types differ from the message");
        if (signature.destinations.size !== 1 || !signature.destinations.has(destination))
          reject("E_PROTOCOL_TRANSITION", "handler destination must match every edge for its message");
        destinations.set(message, destination);
      }
      if (destinations.size !== signatures.size) reject("E_PROTOCOL_HANDLER", "missing protocol handler");
      const actor = Object.freeze({ name: actorName });
      actorBindings.set(actor, { protocol, destinations });
      return actor;
    },
  });
  return protocol;
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

  dispatchBound(actor, envelope) {
    const binding = actorBindings.get(actor);
    if (binding?.protocol !== this.#protocol) return "unbound-actor";
    return this.dispatch(envelope, value => ({
      target: binding.destinations.get(envelope.message), value,
    }));
  }

  dispatch({ incarnation, message, payload }, stage) {
    const before = this.#state;
    if (before.incarnation !== incarnation) return "stale";
    if (!before.live) return "closed";
    if (this.#staging) return "busy";
    const edge = this.#protocol.edge(before.state, message);
    if (!edge) return "illegal-edge";
    if (!Array.isArray(payload) || payload.length !== edge.signature.length) return "invalid-payload";
    // Detach the validated scalar values; do not read fields again during staging.
    const values = [];
    for (let i = 0; i < edge.signature.length; i++) {
      const type = edge.signature[i];
      if (!Object.hasOwn(payload, i)) return "invalid-payload";
      const { value, unit } = payload[i] ?? {};
      if (typeof value !== "bigint" || !includes(type.range, [value, value]) ||
          !Array.isArray(unit?.powers) || !sameUnit(type.unit, unit)) return "invalid-payload";
      values.push(value);
    }

    this.#staging = true;
    try {
      // The oracle assumes a pure staged handler. Only this operation can
      // publish its returned scalar state and chosen destination together.
      let proposed;
      try {
        proposed = stage(before.value, values);
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
