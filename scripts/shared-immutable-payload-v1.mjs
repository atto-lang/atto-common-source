// Portable reference oracle ONLY; not an Atto compiler or backend implementation.
// This JavaScript model copies once to freeze input; native move/zero-copy must
// be proved separately with executed backend-specific tests.
const fail = (reason) => { throw new Error('SHARED_PAYLOAD_V1: ' + reason); };
let nextId = 1;
const INTERNAL_TOKEN = Symbol('shared-payload-oracle-internal');

export class SharedPayloadRefOracle {
  #backing;
  #offset;
  #length;
  #live = true;
  constructor(token, backing, offset, length) {
    if (token !== INTERNAL_TOKEN) fail('forged descriptor');
    this.#backing = backing;
    this.#offset = offset;
    this.#length = length;
    backing.refs += 1;
  }
  static freeze(bytes, maxBytes = 16 * 1024 * 1024) {
    if (!Array.isArray(bytes) && !(bytes instanceof Uint8Array)) fail('invalid source');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) fail('invalid limit');
    if (bytes.length > maxBytes) fail('slab quota');
    for (const x of bytes) {
      if (!Number.isInteger(x) || x < 0 || x > 255) fail('invalid octet');
    }
    const bytesCopy = Uint8Array.from(bytes);
    return new SharedPayloadRefOracle(INTERNAL_TOKEN, {id:nextId++, bytes:bytesCopy, refs:0, freed:false}, 0, bytesCopy.length);
  }
  #requireLive() {
    if (!this.#live || this.#backing.freed) fail('stale handle');
  }
  get size() { this.#requireLive(); return this.#length; }
  get backingBytes() { this.#requireLive(); return this.#backing.bytes.length; }
  get backingId() { this.#requireLive(); return this.#backing.id; }
  clone() { this.#requireLive(); return new SharedPayloadRefOracle(INTERNAL_TOKEN, this.#backing, this.#offset, this.#length); }
  slice(offset,length) {
    this.#requireLive();
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
        offset < 0 || length < 0 || offset > this.#length || length > this.#length - offset)
      fail('slice out of bounds');
    return new SharedPayloadRefOracle(INTERNAL_TOKEN, this.#backing, this.#offset + offset, length);
  }
  readByte(index) {
    this.#requireLive();
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.#length)
      fail('read out of bounds');
    return this.#backing.bytes[this.#offset + index];
  }
  drop() {
    this.#requireLive();
    this.#live = false;
    this.#backing.refs -= 1;
    if (this.#backing.refs === 0) {
      this.#backing.bytes.fill(0);
      this.#backing.freed = true;
    }
  }
  // Test-only: never serialize backing IDs as capabilities.
  get backingRefsForTest() { this.#requireLive(); return this.#backing.refs; }
}

export class SharedPayloadInboxOracle {
  #queue = [];
  #used = 0;
  #closed = false;
  constructor({slots, bytes}) {
    if (!Number.isSafeInteger(slots) || slots < 1 ||
        !Number.isSafeInteger(bytes) || bytes < 0) fail('invalid mailbox quota');
    this.slots = slots;
    this.maxBytes = bytes;
  }
  get bufferedBytes() { return this.#used; }
  get queued() { return this.#queue.length; }
  trySend(payload) {
    if (!(payload instanceof SharedPayloadRefOracle)) return 'invalid';
    // Validate handle before admission or payload refcount increment.
    const charge = payload.backingBytes;
    if (this.#closed) return 'closed';
    if (this.#queue.length === this.slots || charge > this.maxBytes - this.#used)
      return 'full';
    const descriptor = payload.clone();
    this.#queue.push({descriptor,charge});
    this.#used += charge;
    return 'admitted';
  }
  tryReceive() {
    if (!this.#queue.length) return null;
    const {descriptor,charge} = this.#queue.shift();
    this.#used -= charge;
    return descriptor;
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const {descriptor} of this.#queue) descriptor.drop();
    this.#queue = [];
    this.#used = 0;
  }
}
