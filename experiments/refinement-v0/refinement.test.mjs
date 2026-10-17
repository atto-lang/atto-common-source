import assert from "node:assert/strict";
import {spec,validate,tryFrom,entails,codePoints} from "./refinement.mjs";
const good = ["@Size(min=10,max=10) type A = string;","type B = string with length eq 10;","@NotEmpty define newtype N(string);","define newtype C(string) with length gt 0;","type D = int with value gte 1 and value lte 10;","type E = string where it.length > 0;","type F = int where it > 0 and it < 10;","type G = int where it == 1 or it == 3;","@Size(min=0,max=20) type H = string with length gt 0;"];
for (const src of good) assert.ok(spec(src));
const bad = ["type Bad = int with value ge 1;","type Bad = int with value le 10;","type Bad = string with length gt 10 and length lt 5;","type Bad = string with length eq -1;","type Bad = int with length gt 0;","type Bad = string with length gt readFile();","type Bad = string where it.trim().length > 0;","type Bad = string with length gt 0 or length eq 5;","@Size(min=1,max=2) @Size(min=3,max=4) type Bad = string;","@Whatever type Bad = string;"];
for (const src of bad) assert.throws(() => spec(src), /./);
const exact=spec("type Exact = string with length eq 10;");
const nonempty=spec("type NonEmpty = string with length gt 0;");
assert.equal(entails(exact,nonempty), true);
assert.equal(entails(nonempty,exact), false);
assert.equal(tryFrom(nonempty, "").ok, false);
assert.equal(tryFrom(nonempty, "😀").ok, true);
assert.equal(tryFrom(nonempty, "\\uD800").ok, true); // literal backslash sequence, not surrogate
assert.equal(tryFrom(nonempty, String.fromCharCode(0xD800)).ok, false);
assert.equal(codePoints(String.fromCodePoint(0x65,0x301)), 2); // decomposed e + combining acute
assert.equal(codePoints("😀"), 1);
const nominal=spec("define newtype N(string) with length gt 0;");
assert.equal(entails(nominal, nonempty), false);
assert.equal(tryFrom(nominal,"x").value.type,"N");
console.log("refinement standalone reference tests passed");

const portKeyword=spec("type Port = int with value gte 1 and value lte 65535;");
const portSymbols=spec("type Port = int with value >= 1 and value <= 65535;");
for (const v of [0,1,443,65535,65536]) assert.equal(validate(portKeyword,v),validate(portSymbols,v));
const pctKeyword=spec("type Percentage = int with value gte 0 and value lte 100;");
const pctSymbols=spec("type Percentage = int with value >= 0 and value <= 100;");
for (const v of [-1,0,50,100,101]) assert.equal(validate(pctKeyword,v),validate(pctSymbols,v));
