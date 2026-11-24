import { createHash } from "node:crypto";

// Wire-format oracle for the local serial protocol DATA profile. The mailbox
// authenticates the recipient separately; this digest is not authority.
export function protocolMailboxFingerprint(layout) {
  const digest = createHash("sha256");
  const count = value => {
    const bytes = Buffer.alloc(4);
    bytes.writeInt32LE(value);
    digest.update(bytes);
  };
  const scalar = value => {
    const bytes = Buffer.alloc(8);
    bytes.writeBigInt64LE(value);
    digest.update(bytes);
  };
  const flag = value => digest.update(Uint8Array.of(value ? 1 : 0));
  const string = value => {
    const bytes = Buffer.from(value, "utf8");
    let remaining = bytes.length;
    while (remaining >= 128) {
      digest.update(Uint8Array.of((remaining % 128) | 128));
      remaining = Math.floor(remaining / 128);
    }
    digest.update(Uint8Array.of(remaining));
    digest.update(bytes);
  };

  string("atto.protocol.mailbox.v1");
  string(layout.name);
  string(layout.initial);
  count(layout.states.length);
  for (const { name, terminal } of layout.states) {
    string(name);
    flag(terminal);
  }
  count(layout.messages.length);
  for (const { name, fields } of layout.messages) {
    string(name);
    count(fields.length);
    for (const { carrier, range: [minimum, maximum], unit } of fields) {
      flag(carrier === "i32");
      scalar(minimum);
      scalar(maximum);
      count(unit.powers.length);
      for (const [dimension, exponent] of unit.powers) {
        string(dimension);
        count(exponent);
      }
      string(unit.n.toString());
      string(unit.d.toString());
    }
  }
  count(layout.edges.length);
  for (const { source, message, target } of layout.edges) {
    string(source);
    string(message);
    string(target);
  }
  return digest.digest();
}

export function encodeProtocolMailboxMessage(layout, name, fields) {
  const ordinal = layout.messages.findIndex(message => message.name === name);
  if (ordinal < 0 || fields.length !== layout.messages[ordinal].fields.length)
    throw new RangeError("invalid protocol message shape");
  const frame = Buffer.alloc(39 + 8 * fields.length);
  frame.write("ATPM\x01", "ascii");
  protocolMailboxFingerprint(layout).copy(frame, 5);
  frame.writeUInt16LE(ordinal, 37);
  fields.forEach((value, i) => frame.writeBigInt64LE(value, 39 + 8 * i));
  return frame;
}

export function decodeProtocolTurnReceipt(frame) {
  if (frame.length !== 34 || !frame.subarray(0, 5).equals(Buffer.from("ATPR\x01", "ascii")) ||
      frame[29] < 1 || frame[29] > 5) throw new RangeError("invalid protocol turn receipt");
  return Object.freeze({
    actorId: frame.readBigUInt64LE(5),
    generation: frame.readBigUInt64LE(13),
    turn: frame.readBigUInt64LE(21),
    status: frame[29],
    source: frame.readUInt16LE(30),
    destination: frame.readUInt16LE(32),
  });
}
