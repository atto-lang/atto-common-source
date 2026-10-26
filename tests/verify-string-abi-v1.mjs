import assert from "node:assert/strict";
import fs from "node:fs";

const contract = JSON.parse(fs.readFileSync(new URL("../contracts/v1/string-abi-v1.json", import.meta.url), "utf8"));

function fromCodePoints(points) {
  return String.fromCodePoint(...points);
}

function validateUtf16ScalarString(text) {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      assert.ok(i + 1 < text.length, "unpaired high surrogate");
      const low = text.charCodeAt(++i);
      assert.ok(low >= 0xdc00 && low <= 0xdfff, "unpaired high surrogate");
    } else {
      assert.ok(!(unit >= 0xdc00 && unit <= 0xdfff), "unpaired low surrogate");
    }
  }
}

function encode(text) {
  validateUtf16ScalarString(text);
  return [...Buffer.from(text, "utf8")];
}

function toCString(text) {
  validateUtf16ScalarString(text);
  const bytes = encode(text);
  if (bytes.includes(0)) {
    const error = new Error("embedded NUL");
    error.code = "EMBEDDED_NUL";
    throw error;
  }
  return {storage:[...bytes, 0], byte_length:bytes.length};
}

function decodeExplicit(storage, byteLength) {
  assert.ok(Number.isInteger(byteLength) && byteLength >= 0 && byteLength <= storage.length);
  const decoder = new TextDecoder("utf-8", {fatal:true});
  return decoder.decode(Uint8Array.from(storage.slice(0, byteLength)));
}

assert.equal(contract.schema, "oreslang.string-abi.v1");
assert.equal(contract.string.encoding, "utf-8");
assert.equal(contract.string.extent, "explicit_byte_length");
assert.equal(contract.string.embedded_nul, "allowed");
assert.equal(contract.string.sentinel_scan_for_extent, false);
assert.equal(contract.cstring.distinct_from_string, true);
assert.equal(contract.cstring.implicit_conversion, false);
assert.equal(contract.cstring.embedded_nul, "reject");
assert.equal(contract.cstring.byte_length_excludes_terminator, true);
assert.equal(contract.inbound_pointer.unbounded_scan_allowed, false);

for (const c of contract.cases) {
  const text = fromCodePoints(c.code_points);
  const bytes = encode(text);
  assert.deepEqual(bytes, c.utf8, c.name);
  assert.equal(bytes.length, c.byte_length, c.name);
  assert.equal(decodeExplicit(bytes, c.byte_length), text, c.name);
  if (c.cstring.ok) {
    assert.deepEqual(toCString(text), c.cstring, c.name);
  } else {
    assert.throws(() => toCString(text), {code:c.cstring.error}, c.name);
  }
}

for (const c of contract.invalid_utf8) {
  assert.throws(() => decodeExplicit(c.bytes, c.bytes.length), undefined, c.name);
}

for (const c of contract.invalid_utf16) {
  const text = String.fromCharCode(...c.code_units);
  assert.throws(() => validateUtf16ScalarString(text), undefined, c.name);
}

for (const c of contract.inbound_cases) {
  const text = decodeExplicit(c.storage, c.byte_length);
  assert.deepEqual(encode(text), c.utf8, c.name);
}

console.log(JSON.stringify({
  status:"PASS",
  schema:contract.schema,
  revision:contract.revision,
  string_cases:contract.cases.length,
  invalid_utf8_cases:contract.invalid_utf8.length,
  invalid_utf16_cases:contract.invalid_utf16.length,
  inbound_cases:contract.inbound_cases.length
}));
