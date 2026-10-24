// Source-free Oreslang reference model. NOT a compiler, sandbox, or backend proof.
const fail = (reason) => { throw new Error('ACTOR_MEMORY_V1: ' + reason); };
const integer = (n, name, min = 0) => {
  if (!Number.isSafeInteger(n) || n < min) fail(name + ' must be a safe integer >= ' + min);
  return n;
};
const bytesFor = (...parts) => {
  let product = 1;
  for (const part of parts) {
    integer(part, 'extent');
    if (part && product > Number.MAX_SAFE_INTEGER / part) fail('byte arithmetic overflow');
    product *= part;
  }
  return product;
};

/** An actor identity, an incarnation, and its own bounded persistent/scratch memory. */
const MAX_LIVE_HANDLES = 4096;
const MAX_LIVE_LOANS = 4096;
const MAX_LIVE_PINS = 4096;
const MAX_LIVE_TASKS = 4096;
const MAX_LIVE_MESSAGES = 4096;

export class ActorArenaOracle {
  #actor;
  #incarnation;
  #quota;
  #used = 0;
  #turn = 0;
  #sealed = false;
  #reclaimed = false;
  #allocations = new Map();
  #loans = new Map();
  #pins = new Set();
  #tasks = new Set();
  // Outstanding message LIFETIMES can overlap, but only one enters the
  // actor's execution lane at a time. A suspended message retains its own
  // scratch allocations until that exact message completes.
  #messages = new Map();
  #executing = null;

  constructor(actor, incarnation, quota = 1048576) {
    if (typeof actor !== 'string' || !actor || actor.length > 128 ||
        !Number.isSafeInteger(incarnation) || incarnation < 1) fail('invalid actor identity');
    integer(quota, 'quota', 1);
    if (quota > 16777216) fail('reference oracle quota ceiling exceeded');
    this.#actor = actor;
    this.#incarnation = incarnation;
    this.#quota = quota;
  }
  get used() { return this.#used; }
  get turn() { return this.#turn; }
  get sealed() { return this.#sealed; }
  get reclaimed() { return this.#reclaimed; }
  get actor() { return this.#actor; }
  get incarnation() { return this.#incarnation; }
  get pendingMessages() { return this.#messages.size; }
  get executingMessage() { return this.#executing !== null; }

  #active() { if (this.#sealed) fail('actor retired'); }
  #record(handle) {
    const record = this.#allocations.get(handle);
    if (!record || !record.live) fail('foreign, forged, or stale allocation handle');
    if (record.message && this.#executing !== record.message)
      fail('message scratch is not accessible outside its owning execution turn');
    return record;
  }
  #range(record, offset) {
    integer(offset, 'offset');
    if (offset >= record.bytes.length) fail('out of bounds');
  }
  allocate(size, lifetime = 'persistent') {
    this.#active();
    integer(size, 'allocation bytes', 1);
    if (!['persistent', 'scratch'].includes(lifetime)) fail('unknown lifetime');
    if (lifetime === 'scratch' && this.#messages.size && !this.#executing)
      fail('scratch allocation requires an executing message');
    if (size > this.#quota - this.#used) fail('actor quota exceeded');
    if (this.#allocations.size >= MAX_LIVE_HANDLES) fail('live allocation handle limit');
    const bytes = new Uint8Array(size);
    const handle = Object.freeze({actor: this.#actor, incarnation: this.#incarnation,
      lifetime, turn: this.#turn});
    this.#allocations.set(handle, {
      bytes, view: new DataView(bytes.buffer), lifetime, turn: this.#turn,
      message: lifetime === 'scratch' ? this.#executing : null, live: true
    });
    this.#used += size;
    return handle;
  }
  read(handle, offset) {
    this.#active();
    const record = this.#record(handle);
    this.#range(record, offset);
    return record.bytes[offset];
  }
  write(handle, offset, value) {
    this.#active();
    const record = this.#record(handle);
    this.#range(record, offset);
    integer(value, 'byte');
    if (value > 255) fail('byte out of range');
    if ([...this.#loans.values()].some(loan => loan.handle === handle)) fail('active loan forbids mutation');
    record.bytes[offset] = value;
  }
  borrowRead(handle) {
    this.#active();
    this.#record(handle);
    if (this.#loans.size >= MAX_LIVE_LOANS) fail('active read loan limit');
    const lease = Object.freeze({kind: 'read-only'});
    this.#loans.set(lease, {handle, turn: this.#turn, message: this.#executing});
    return lease;
  }
  readLoan(lease, offset) {
    const loan = this.#loans.get(lease);
    if (!loan) fail('stale read lease');
    this.#active();
    const record = this.#record(loan.handle);
    this.#range(record, offset);
    return record.bytes[offset];
  }
  releaseLoan(lease) {
    if (!this.#loans.delete(lease)) fail('stale read lease');
    this.#tryReclaim();
  }
  readF64(handle, index) {
    this.#active();
    const record = this.#record(handle);
    integer(index, 'cell index');
    if (index >= Math.floor(record.bytes.length / 8)) fail('F64 out of bounds');
    return record.view.getFloat64(index * 8, true);
  }
  writeF64(handle, index, value) {
    this.ensureWritable(handle);
    const record = this.#record(handle);
    integer(index, 'cell index');
    if (index >= Math.floor(record.bytes.length / 8)) fail('F64 out of bounds');
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('nonfinite F64');
    record.view.setFloat64(index * 8, value, true);
  }
  ensureWritable(handle) {
    this.#active();
    this.#record(handle);
    if ([...this.#loans.values()].some(loan => loan.handle === handle)) fail('borrowed allocation');
  }
  free(handle) {
    this.ensureWritable(handle);
    this.#drop(handle, this.#record(handle));
  }
  #drop(handle, record) {
    record.bytes.fill(0);
    record.live = false;
    this.#used -= record.bytes.length;
    this.#allocations.delete(handle);
  }
  nextTurn() {
    this.#active();
    if (this.#messages.size) fail('legacy actor-global scratch reset denied with in-flight messages');
    if (this.#loans.size) fail('read loan cannot cross actor turn');
    if (this.#turn === Number.MAX_SAFE_INTEGER) fail('turn overflow');
    for (const [handle, record] of this.#allocations) {
      if (record.lifetime === 'scratch') this.#drop(handle, record);
    }
    this.#turn++;
  }
  startMessage() {
    this.#active();
    if (this.#executing) fail('actor lane already executing');
    if (this.#loans.size) fail('previous turn loan must be released before message admission');
    // The reference keeps a legacy actor-global nextTurn() mode only for
    // strictly serial callers. It cannot silently carry that old scratch
    // allocation into concurrent message-lifetime mode.
    for (const record of this.#allocations.values())
      if (record.lifetime === 'scratch' && record.message === null)
        fail('legacy scratch must be retired before message admission');
    if (this.#messages.size >= MAX_LIVE_MESSAGES) fail('outstanding message limit');
    if (this.#turn === Number.MAX_SAFE_INTEGER) fail('turn overflow');
    // An opaque issued object is not a caller-supplied actor ID or message ID.
    const message = Object.freeze({kind:'actor-message-lifetime'});
    this.#messages.set(message, {incarnation:this.#incarnation});
    this.#executing = message;
    this.#turn++;
    return message;
  }
  suspendMessage(message) {
    this.#active();
    if (this.#executing !== message || !this.#messages.has(message))
      fail('not the executing message');
    for (const loan of this.#loans.values())
      if (loan.message === message) fail('loan cannot cross message suspension');
    this.#executing = null;
  }
  resumeMessage(message) {
    this.#active();
    if (!this.#messages.has(message)) fail('foreign or stale message');
    if (this.#executing) fail('actor lane already executing');
    this.#executing = message;
  }
  completeMessage(message) {
    if (!this.#messages.has(message)) fail('foreign or stale message');
    // Completion can arrive after the actor is sealed; it can revoke a
    // suspended message, but cannot run guest code after retirement.
    if (this.#executing && this.#executing !== message)
      fail('another message owns the actor lane');
    for (const loan of this.#loans.values())
      if (loan.message === message) fail('message has outstanding loans');
    for (const [handle,record] of this.#allocations)
      if (record.message === message) this.#drop(handle,record);
    this.#messages.delete(message);
    if (this.#executing === message) this.#executing = null;
    this.#tryReclaim();
  }
  pinExternal() {
    this.#active();
    if (this.#pins.size >= MAX_LIVE_PINS) fail('external pin limit');
    const pin = Object.freeze({kind: 'lifetime-only'});
    this.#pins.add(pin);
    return pin;
  }
  releasePin(pin) {
    if (!this.#pins.delete(pin)) fail('stale external pin');
    this.#tryReclaim();
  }
  beginTask() {
    this.#active();
    if (this.#tasks.size >= MAX_LIVE_TASKS) fail('outstanding task limit');
    const token = Object.freeze({kind: 'task-lifetime'});
    this.#tasks.add(token);
    return token;
  }
  finishTask(token) {
    if (!this.#tasks.delete(token)) fail('stale task completion');
    this.#tryReclaim();
  }
  retire() {
    this.#sealed = true;
    return this.#tryReclaim();
  }
  #tryReclaim() {
    if (!this.#sealed || this.#reclaimed) return this.#reclaimed;
    if (this.#loans.size || this.#pins.size || this.#tasks.size ||
        this.#messages.size) return false;
    for (const [handle, record] of this.#allocations) this.#drop(handle, record);
    this.#reclaimed = true;
    return true;
  }
}

export const LAYOUTS = Object.freeze(['aos', 'soa', 'aosoa', 'soaos']);
const layout = (value) => {
  if (!LAYOUTS.includes(value)) fail('unrecognized physical layout');
  return value;
};
/**
 * All four layouts hold the same rows but use different physical indexing:
 * AoS: row-major, SoA: column-major, AoSoA: tile/field/row,
 * SoAoS: tile/row/field. Padding is inaccessible to guest row operations.
 */
export class DenseRegionOracle {
  #arena;
  #fields;
  #capacity;
  #tile;
  #layout;
  #backing;
  #rows = [];
  #identities = new Map();
  #nextId = 0;
  #epoch = 0;
  #closed = false;
  #admitting = false;

  constructor(arena, fields, capacity, physicalLayout = 'aos', tile = 8) {
    if (!(arena instanceof ActorArenaOracle)) fail('actor arena required');
    if (!Array.isArray(fields) || fields.length === 0 || fields.length > 32 ||
        fields.some(f => typeof f !== 'string' || !/^[a-z][a-z0-9_]*$/.test(f)) ||
        new Set(fields).size !== fields.length) fail('invalid component fields');
    integer(capacity, 'capacity', 1);
    integer(tile, 'tile', 1);
    if (tile > 1024 || capacity > 65536) fail('reference layout limits exceeded');
    this.#arena = arena;
    this.#fields = Object.freeze([...fields]);
    this.#capacity = capacity;
    this.#tile = tile;
    this.#layout = layout(physicalLayout);
    const allocated = this.#createStorage(this.#layout);
    this.#backing = allocated.backing;
  }
  get length() { return this.#rows.length; }
  get epoch() { return this.#epoch; }
  get physicalLayout() { return this.#layout; }
  get fields() { return this.#fields; }
  #live() {
    if (this.#closed || this.#arena.sealed) fail('region closed');
    if (this.#admitting) fail('reentrant region operation during input snapshot');
  }
  #geometry(kind) {
    const padded = Math.ceil(this.#capacity / this.#tile) * this.#tile;
    const cells = bytesFor(kind === 'aos' || kind === 'soa' ? this.#capacity : padded,
      this.#fields.length);
    return {padded, bytes: bytesFor(cells, 8)};
  }
  #createStorage(kind) {
    const geom = this.#geometry(kind);
    return {backing: this.#arena.allocate(geom.bytes)};
  }
  #index(row, field, kind = this.#layout) {
    const count = this.#fields.length;
    if (kind === 'aos') return row * count + field;
    if (kind === 'soa') return field * this.#capacity + row;
    const group = Math.floor(row / this.#tile);
    const inGroup = row % this.#tile;
    if (kind === 'aosoa')
      return group * this.#tile * count + field * this.#tile + inGroup;
    // SoAoS = field-group major, each group holds an array of small AoS
    // records. A group is 2 fields here; for 3+ fields the physical order is
    // distinct from both plain AoS and AoSoA. Last group may be partial.
    const firstField = Math.floor(field / 2) * 2;
    const groupFields = Math.min(2, count - firstField);
    return group * this.#tile * count + firstField * this.#tile +
      inGroup * groupFields + (field - firstField);
  }
  physicalIndexOf(row, field) {
    this.#live();
    integer(row, 'row index');
    integer(field, 'field index');
    if (row >= this.#capacity || field >= this.#fields.length)
      fail('physical cell is out of region capacity');
    return this.#index(row, field);
  }
  #get(row, field, kind = this.#layout, backing = this.#backing) {
    return this.#arena.readF64(backing, this.#index(row, field, kind));
  }
  #put(row, field, value, kind = this.#layout, backing = this.#backing) {
    this.#arena.writeF64(backing, this.#index(row, field, kind), value);
  }
  #rowIndex(id) {
    const index = this.#identities.get(id);
    if (index === undefined) fail('foreign or stale entity handle');
    return index;
  }
  #values(values) {
    // Snapshot only own DATA descriptors; never execute a component getter or
    // read the caller's array again after mutation starts. Proxies are not a
    // security boundary: their descriptor traps execute in the trusted host.
    if (!Array.isArray(values)) fail('component values must be a dense array');
    if (this.#admitting) fail('reentrant component admission');
    this.#admitting = true;
    const snapshot = [];
    try {
      const size = Reflect.getOwnPropertyDescriptor(values, 'length');
      if (!size || size.value !== this.#fields.length)
        fail('component count does not match schema');
      for (let field = 0; field < this.#fields.length; field++) {
        const descriptor = Reflect.getOwnPropertyDescriptor(values, String(field));
        if (!descriptor || !Object.hasOwn(descriptor, 'value'))
          fail('component must be an own data value (no getter or hole)');
        snapshot.push(descriptor.value);
      }
    } catch (error) {
      fail('untrusted component descriptor');
    } finally {
      this.#admitting = false;
    }
    if (!snapshot.every(v => typeof v === 'number' && Number.isFinite(v)))
      fail('component values must be finite F64 numbers');
    return snapshot;
  }
  insert(values) {
    this.#live();
    const stable = this.#values(values);
    if (this.length >= this.#capacity) fail('region capacity exceeded');
    this.#arena.ensureWritable(this.#backing);
    if (this.#nextId === Number.MAX_SAFE_INTEGER) fail('entity generation exhausted');
    const id = Object.freeze({entity: ++this.#nextId});
    const row = this.length;
    for (let field = 0; field < stable.length; field++) this.#put(row, field, stable[field]);
    this.#rows.push(id);
    this.#identities.set(id, row);
    return id;
  }
  read(id) {
    this.#live();
    const row = this.#rowIndex(id);
    return this.#fields.map((_, field) => this.#get(row, field));
  }
  write(id, values) {
    this.#live();
    const row = this.#rowIndex(id);
    const stable = this.#values(values);
    this.#arena.ensureWritable(this.#backing);
    for (let field = 0; field < stable.length; field++) this.#put(row, field, stable[field]);
  }
  eraseSwap(id) {
    this.#live();
    const row = this.#rowIndex(id);
    this.#arena.ensureWritable(this.#backing);
    const last = this.length - 1;
    const trailing = this.#rows[last];
    if (row !== last) {
      for (let f = 0; f < this.#fields.length; f++) this.#put(row, f, this.#get(last, f));
      this.#rows[row] = trailing;
      this.#identities.set(trailing, row);
    }
    for (let f = 0; f < this.#fields.length; f++) this.#put(last, f, 0);
    this.#rows.pop();
    this.#identities.delete(id);
  }
  borrowRead() {
    this.#live();
    return this.#arena.borrowRead(this.#backing);
  }
  releaseRead(lease) { this.#arena.releaseLoan(lease); }
  changeLayout(to) {
    this.#live();
    layout(to);
    if (to === this.#layout) return this.#epoch;
    if (this.#epoch === Number.MAX_SAFE_INTEGER) fail('layout epoch overflow');
    // A borrowed region is never eligible for copy/reconciliation: reject
    // BEFORE allocating a second physical backing or modifying the epoch.
    this.#arena.ensureWritable(this.#backing);
    const next = this.#createStorage(to);
    try {
      for (let row = 0; row < this.length; row++)
        for (let f = 0; f < this.#fields.length; f++)
          this.#put(row, f, this.#get(row, f), to, next.backing);
      this.#arena.free(this.#backing); // May reject an outstanding read lease.
    } catch (error) {
      this.#arena.free(next.backing);
      throw error;
    }
    this.#backing = next.backing;
    this.#layout = to;
    this.#epoch++;
    return this.#epoch;
  }
  close() {
    if (this.#closed) return;
    this.#live();
    this.#arena.free(this.#backing); // Transactional: does not close if leased.
    this.#identities.clear();
    this.#rows.length = 0;
    this.#closed = true;
  }
}
