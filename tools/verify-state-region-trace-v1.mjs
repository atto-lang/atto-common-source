// Source-free, backend-neutral safety checker for Oreslang state-region traces.
// It checks reported linearization events, not compiler execution or trace completeness.
import { readFileSync } from 'node:fs';

const isText = (value) => typeof value === 'string' && value.length > 0;
const key = (domain, generation) => `${domain}\u0000${generation}`;
const ownerKey = (item) => `${item.domain}\u0000${item.actor_generation}\u0000${item.execution}\u0000${item.execution_generation}`;

export function verifyStateRegionTrace(trace) {
  const fail = (code, index) => { throw new Error(`${code} at event ${index}`); };
  if (!trace || trace.schema_version !== 1 || !['java', 'llvm', 'net', 'wasm', 'forge'].includes(trace.backend)) {
    fail('INVALID_TRACE_HEADER', 0);
  }
  if (typeof trace.source_sha !== 'string' || !/^[0-9a-f]{40}$/.test(trace.source_sha)) fail('INVALID_SOURCE_SHA', 0);
  if (![3, 7, 15].includes(trace.thread_count) || !Array.isArray(trace.events)) fail('INVALID_MATRIX', 0);
  const tickets = new Map();
  const domains = new Map();
  const carriers = new Set();
  let sequence = 0;
  let peakReaders = 0;
  let operations = 0;
  const domainFor = (item) => {
    const id = key(item.domain, item.actor_generation);
    if (!domains.has(id)) domains.set(id, { retired: false, reclaimed: false, activeReaders: 0, activeWriter: false });
    return domains.get(id);
  };
  const pendingWriterBefore = (ticket) => [...tickets.values()].some(x =>
    x.domain === ticket.domain && x.actor_generation === ticket.actor_generation &&
    x.mode === 'write' && x.state === 'pending' && x.sequence < ticket.sequence);
  for (const [index, event] of trace.events.entries()) {
    if (!event || !Number.isSafeInteger(event.seq) || event.seq <= sequence) fail('NON_MONOTONIC_SEQUENCE', index);
    sequence = event.seq;
    const op = event.op;
    if (op === 'request') {
      if (!['read', 'write'].includes(event.mode) || !isText(event.ticket) ||
          !isText(event.domain) || !isText(event.execution) || !isText(event.carrier) ||
          !Number.isSafeInteger(event.actor_generation) || event.actor_generation < 1 ||
          !Number.isSafeInteger(event.execution_generation) || event.execution_generation < 1) fail('INVALID_REQUEST', index);
      if (tickets.has(event.ticket)) fail('DUPLICATE_TICKET', index);
      const domain = domainFor(event);
      if (domain.retired || domain.reclaimed) fail('REQUEST_AFTER_RETIREMENT', index);
      if ([...tickets.values()].some(x => ownerKey(x) === ownerKey(event) &&
          (x.state === 'pending' || x.state === 'active'))) fail('REENTRANT_EXECUTION', index);
      const ticket = { ...event, state: 'pending', sequence: event.seq };
      tickets.set(event.ticket, ticket);
      carriers.add(event.carrier);
    } else if (op === 'retire' || op === 'reclaim') {
      if (!isText(event.domain) || !Number.isSafeInteger(event.actor_generation) || event.actor_generation < 1) fail('INVALID_DOMAIN', index);
      const domain = domainFor(event);
      if (op === 'retire') {
        if (domain.retired || domain.reclaimed) fail('DOUBLE_RETIRE', index);
        domain.retired = true;
      } else {
        if (!domain.retired || domain.reclaimed || domain.activeReaders || domain.activeWriter ||
          [...tickets.values()].some(x => x.domain === event.domain &&
            x.actor_generation === event.actor_generation && x.state === 'pending')) fail('PREMATURE_RECLAMATION', index);
        domain.reclaimed = true;
      }
    } else {
      const ticket = tickets.get(event.ticket);
      if (!ticket) fail('UNKNOWN_TICKET', index);
      const domain = domainFor(ticket);
      if (op === 'grant') {
        if (ticket.state !== 'pending' || domain.retired) fail('INVALID_GRANT', index);
        if (ticket.mode === 'read') {
          if (domain.activeWriter || pendingWriterBefore(ticket)) fail('READ_BYPASSES_WRITER', index);
          domain.activeReaders++;
          peakReaders = Math.max(peakReaders, domain.activeReaders);
        } else {
          if (domain.activeWriter || domain.activeReaders) fail('OVERLAPPING_WRITER', index);
          if ([...tickets.values()].some(x => x.domain === ticket.domain &&
              x.actor_generation === ticket.actor_generation && x.state === 'pending' &&
              x.sequence < ticket.sequence)) fail('WRITER_BYPASSES_QUEUE', index);
          domain.activeWriter = true;
        }
        ticket.state = 'active';
      } else if (op === 'cancel') {
        if (ticket.state !== 'pending') fail('INVALID_CANCELLATION', index);
        ticket.state = 'cancelled';
      } else if (op === 'access' || op === 'release' || op === 'suspend') {
        if (!isText(event.execution) || !Number.isSafeInteger(event.execution_generation) ||
            ticket.execution !== event.execution || ticket.execution_generation !== event.execution_generation ||
            (event.domain !== undefined && event.domain !== ticket.domain) ||
            (event.actor_generation !== undefined && event.actor_generation !== ticket.actor_generation)) fail('FOREIGN_OR_STALE_EXECUTION', index);
        if (op === 'suspend') {
          if ([...tickets.values()].some(x => ownerKey(x) === ownerKey(ticket) &&
              (x.state === 'pending' || x.state === 'active'))) fail('SUSPENSION_WITH_LIVE_LOAN', index);
        } else if (op === 'access') {
          if (ticket.state !== 'active' || domain.retired) fail('ACCESS_OUTSIDE_LOAN', index);
          if (event.kind !== 'read' && event.kind !== 'write') fail('INVALID_ACCESS', index);
          if (event.kind === 'write' && ticket.mode !== 'write') fail('READONLY_MUTATION', index);
          operations++;
        } else {
          if (ticket.state !== 'active') fail('INVALID_OR_DOUBLE_RELEASE', index);
          if (ticket.mode === 'read') {
            if (!domain.activeReaders) fail('UNDERFLOW', index);
            domain.activeReaders--;
          } else {
            if (!domain.activeWriter) fail('UNDERFLOW', index);
            domain.activeWriter = false;
          }
          ticket.state = 'released';
        }
      } else fail('UNKNOWN_OPERATION', index);
    }
  }
  if (carriers.size !== trace.thread_count) fail('CARRIER_COUNT_MISMATCH', trace.events.length);
  if ([...tickets.values()].some(x => x.state === 'pending' || x.state === 'active')) fail('UNFINISHED_LOAN', trace.events.length);
  if ([...domains.values()].some(x => !x.reclaimed)) fail('UNFINISHED_RETIREMENT', trace.events.length);
  if (trace.minimum_parallel_readers !== undefined &&
      (!Number.isSafeInteger(trace.minimum_parallel_readers) || trace.minimum_parallel_readers < 1 ||
       peakReaders < trace.minimum_parallel_readers)) fail('READ_PARALLELISM_NOT_OBSERVED', trace.events.length);
  return { backend: trace.backend, source_sha: trace.source_sha, thread_count: trace.thread_count,
    carriers_seen: carriers.size, peak_readers: peakReaders, checked_accesses: operations,
    checked_events: trace.events.length, status: 'trace_consistent_not_guest_verified' };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (process.argv.length !== 3) { console.error('usage: node verify-state-region-trace-v1.mjs TRACE.json'); process.exitCode = 2; }
  else {
    try { console.log(JSON.stringify(verifyStateRegionTrace(JSON.parse(readFileSync(process.argv[2], 'utf8'))))); }
    catch (error) { console.error(String(error)); process.exitCode = 1; }
  }
}
