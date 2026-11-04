// Reference model only: deliberately NOT the Oreslang implementation or transport.
export class ObservableActorReference {
  constructor({policy = 'RELIABLE', capacity = 2, publisher = 'p#1'} = {}) {
    if (!['RELIABLE', 'LATEST', 'LOSSY'].includes(policy)) throw new Error('unknown policy');
    if (!Number.isSafeInteger(capacity) || capacity < 1 || (policy === 'LATEST' && capacity !== 1)) {
      throw new Error('invalid bounded capacity');
    }
    this.publisher = publisher;
    this.policy = policy;
    this.capacity = capacity;
    this.subscribers = new Map();
    this.sequence = 0;
    this.live = true;
    this.retained = 0; // logical per-delivery reservations, not process heap bytes
    this.notifications = []; // deferred metadata only; NEVER invoke guest callbacks inline
  }
  subscribe(observer, {expectedPublisher = this.publisher} = {}) {
    if (!this.live || expectedPublisher !== this.publisher) throw new Error('stale publisher');
    if (this.subscribers.has(observer)) throw new Error('duplicate lease');
    const lease = {observer, pending: [], active: true};
    this.subscribers.set(observer, lease);
    this.notifications.push(['subscribed', observer]);
    return lease;
  }
  publish(value) {
    if (!this.live) throw new Error('publisher closed');
    if (value === null || value === undefined) throw new Error('null event');
    const participants = [...this.subscribers.values()].filter(x => x.active);
    if (this.policy === 'RELIABLE' && participants.some(x => x.pending.length >= this.capacity)) {
      throw new Error('EventBackpressure');
    }
    const event = Object.freeze({publisher: this.publisher, sequence: ++this.sequence, value});
    let accepted = 0, dropped = 0, coalesced = 0;
    for (const lease of participants) {
      if (this.policy === 'LATEST' && lease.pending.length) {
        this.retained -= lease.pending.length;
        coalesced += lease.pending.length;
        lease.pending.length = 0;
      }
      if (this.policy === 'LOSSY' && lease.pending.length >= this.capacity) {
        dropped++;
        continue;
      }
      lease.pending.push(event);
      this.retained++;
      accepted++;
    }
    this.notifications.push(['published', event.sequence]);
    return {accepted, dropped, coalesced, sequence: event.sequence};
  }
  read(lease) {
    if (!lease.active || this.subscribers.get(lease.observer) !== lease) throw new Error('closed lease');
    const next = lease.pending.shift();
    if (next) this.retained--;
    return next;
  }
  cancel(lease) {
    if (!lease.active) return false;
    lease.active = false;
    this.subscribers.delete(lease.observer);
    this.retained -= lease.pending.length;
    lease.pending.length = 0;
    this.notifications.push(['unsubscribed', lease.observer]);
    return true;
  }
  close() {
    if (!this.live) return false;
    this.live = false;
    for (const lease of [...this.subscribers.values()]) this.cancel(lease);
    return true;
  }
}
