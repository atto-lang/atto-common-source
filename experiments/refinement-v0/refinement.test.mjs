import assert from "node:assert/strict";
import {spec,validate,tryFrom,entails,codePoints} from "./refinement.mjs";
const good = ["@Size(min=10,max=10) type A = string;","type B = string with length eq 10;","@NotEmpty define newtype N(string);","define newtype C(string) with length gt 0;","type D = int with value ge 1 and value le 10;","type E = string where it.length > 0;","type F = int where it > 0 and it < 10;","type G = int where it == 1 or it == 3;","@Size(min=0,max=20) type H = string with length gt 0;"];
for (const src of good) assert.ok(spec(src));
const bad = ["type Bad = string with length gt 10 and length lt 5;","type Bad = string with length eq -1;","type Bad = int with length gt 0;","type Bad = string with length gt readFile();","type Bad = string where it.trim().length > 0;","type Bad = string with length gt 0 or length eq 5;","@Size(min=1,max=2) @Size(min=3,max=4) type Bad = string;","@Whatever type Bad = string;"];
for (const src of bad) assert.throws(() => spec(src), /./);
const exact=spec("type Exact = string with length eq 10;");
const nonempty=spec("type NonEmpty = string with length gt 0;");
assert.equal(entails(exact,nonempty), true);
assert.equal(entails(nonempty,exact), false);
assert.equal(tryFrom(nonempty, "").ok, false);
assert.equal(tryFrom(nonempty, "😀").ok, true);
assert.equal(tryFrom(nonempty, "\\uD800").ok, true); // literal backslash sequence, not surrogate
assert.equal(tryFrom(nonempty, String.fromCharCode(0xD800)).ok, false);
assert.equal(codePoints("e\\u0301"), 6); // escaped source text
assert.equal(codePoints("😀"), 1);
const nominal=spec("define newtype N(string) with length gt 0;");
assert.equal(entails(nominal, nonempty), false);
assert.equal(tryFrom(nominal,"x").value.type,"N");
console.log("refinement standalone reference tests passed");
