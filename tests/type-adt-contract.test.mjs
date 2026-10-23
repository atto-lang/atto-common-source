// Source-free finite ADT reference tests. NOT a guest compiler/parser test.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "contracts/v1/type-adt/declarations.v1.json"), "utf8"));
const kinds = new Map(manifest.declaration_kinds.map(d => [d.kind, d]));

const Bool = { kind: "bool" }, Int = { kind: "int" }, Unit = { kind: "unit" }, Never = { kind: "never" };
const option = of => ({ kind: "option", of });
const result = (ok, err) => ({ kind: "result", ok, err });
const tuple = (...fields) => ({ kind: "tuple", fields });
const sum = cases => ({ kind: "sum", cases });
const wild = { kind: "wild" };
const lit = value => ({ kind: "literal", value });
const ctor = (name, payload = wild) => ({ kind: "case", name, payload });
const branch = (pattern, guarded = false) => ({ pattern, guarded });

function cartesian(rows, limit = 2048) {
  let output = [[]];
  for (const row of rows) {
    if (output.length * row.length > limit) return null;
    output = output.flatMap(prefix => row.map(value => [...prefix, value]));
  }
  return output;
}

// null = cannot prove by enumeration (infinite, recursive or too large).
function enumerate(type, depth = 0) {
  if (depth > 12) return null;
  switch (type.kind) {
    case "never": return [];
    case "unit": return [{ kind: "unit" }];
    case "bool": return [false, true].map(value => ({ kind: "bool", value }));
    case "int": return null;
    case "option": {
      const values = enumerate(type.of, depth + 1);
      return values === null ? null : [{ kind: "none" }, ...values.map(value => ({ kind: "some", value }))];
    }
    case "result": {
      const ok = enumerate(type.ok, depth + 1), err = enumerate(type.err, depth + 1);
      if (ok === null || err === null || ok.length + err.length > 2048) return null;
      return [...ok.map(value => ({ kind: "ok", value })), ...err.map(value => ({ kind: "err", value }))];
    }
    case "tuple": {
      const domains = type.fields.map(t => enumerate(t, depth + 1));
      if (domains.some(x => x === null)) return null;
      const values = cartesian(domains);
      return values?.map(value => ({ kind: "tuple", value })) ?? null;
    }
    case "sum": {
      const out = [];
      for (const c of type.cases) {
        const values = enumerate(c.payload, depth + 1);
        if (values === null || out.length + values.length > 2048) return null;
        out.push(...values.map(value => ({ kind: "case", name: c.name, value })));
      }
      return out;
    }
    default: throw new Error("unrecognized type: " + type.kind);
  }
}

function matches(pattern, value) {
  if (pattern.kind === "wild") return true;
  if (pattern.kind === "literal") return (value.kind === "bool" || value.kind === "int") && Object.is(value.value, pattern.value);
  if (pattern.kind === "unit") return value.kind === "unit";
  if (pattern.kind === "none") return value.kind === "none";
  if (pattern.kind === "some") return value.kind === "some" && matches(pattern.payload, value.value);
  if (pattern.kind === "ok") return value.kind === "ok" && matches(pattern.payload, value.value);
  if (pattern.kind === "err") return value.kind === "err" && matches(pattern.payload, value.value);
  if (pattern.kind === "case") return value.kind === "case" && value.name === pattern.name && matches(pattern.payload, value.value);
  if (pattern.kind === "tuple") return value.kind === "tuple" &&
    pattern.fields.length === value.value.length && pattern.fields.every((p, i) => matches(p, value.value[i]));
  throw new Error("unrecognized pattern: " + pattern.kind);
}

function exhaustive(type, arms, depth = 0) {
  if (depth > 12) return false;
  const patterns = arms.filter(arm => !arm.guarded).map(arm => arm.pattern);
  if (patterns.some(p => p.kind === "wild")) return true;
  const values = enumerate(type);
  if (values !== null) return values.every(v => patterns.some(p => matches(p, v)));
  // Sound (conservative) symbolic coverage for unbounded payloads.
  if (type.kind === "option") {
    return patterns.some(p => p.kind === "none") &&
      exhaustive(type.of, patterns.filter(p => p.kind === "some").map(p => branch(p.payload)), depth + 1);
  }
  if (type.kind === "result") {
    return exhaustive(type.ok, patterns.filter(p => p.kind === "ok").map(p => branch(p.payload)), depth + 1) &&
      exhaustive(type.err, patterns.filter(p => p.kind === "err").map(p => branch(p.payload)), depth + 1);
  }
  if (type.kind === "sum") {
    return type.cases.every(c => exhaustive(c.payload, patterns.filter(p => p.kind === "case" && p.name === c.name)
      .map(p => branch(p.payload)), depth + 1));
  }
  if (type.kind === "tuple") {
    return patterns.some(p => p.kind === "tuple" && p.fields.length === type.fields.length &&
      p.fields.every(f => f.kind === "wild"));
  }
  return false;
}

function unreachable(type, arms) {
  const values = enumerate(type);
  if (values === null) return null;
  const seen = new Set(), dead = [];
  arms.forEach((arm, index) => {
    const hits = values.flatMap((value, i) => matches(arm.pattern, value) ? [i] : []);
    if (hits.every(i => seen.has(i))) dead.push(index);
    if (!arm.guarded) hits.forEach(i => seen.add(i));
  });
  return dead;
}

function validCases(cases, exported = false) {
  if (!Array.isArray(cases) || cases.length === 0 || cases.length > 2048) return false;
  const names = new Set(), tags = new Set();
  for (const c of cases) {
    if (typeof c.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.name) || names.has(c.name)) return false;
    names.add(c.name);
    if (exported && !Object.hasOwn(c, "tag")) return false;
    if (Object.hasOwn(c, "tag")) {
      if (!Number.isSafeInteger(c.tag) || c.tag < 1 || c.tag > 2147483647 || tags.has(c.tag)) return false;
      tags.add(c.tag);
    }
  }
  return true;
}

function shapeAccepts(expected, value) {
  if (!expected || typeof expected !== "object") return false;
  if (expected.kind === "bool") return typeof value === "boolean";
  if (expected.kind === "int") return typeof value === "number" && Number.isSafeInteger(value);
  if (expected.kind === "unit") return value === null;
  if (expected.kind === "record") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const actual = Object.keys(value).sort(), required = Object.keys(expected.fields).sort();
    if (actual.length !== required.length || actual.some((k, i) => k !== required[i])) return false;
    return required.every(k => shapeAccepts(expected.fields[k], value[k]));
  }
  return false;
}

function authenticConstructor(schema, supplied) {
  if (schema.nominalId !== supplied.nominalId || !validCases(schema.cases, true)) return false;
  const def = schema.cases.find(c => c.name === supplied.case);
  return !!def && def.tag === supplied.tag && shapeAccepts(def.payload, supplied.payload);
}

test("manifest contains 16 distinct kinds and never invents first-class type objects", () => {
  assert.equal(manifest.schema, "oreslang.type-adt-declarations.v1");
  assert.equal(kinds.size, manifest.declaration_kinds.length);
  assert.deepEqual([...kinds.keys()], [
    "class", "actor", "supervisor_actor", "proxy_actor", "model", "enum", "struct", "record",
    "newtype", "interface", "trait", "contract", "type", "pattern", "symbol", "module"
  ]);
  for (const item of kinds.values()) {
    assert.equal(item.reifiable_type_object, false, item.kind);
    assert.ok(["grammar", "spelling-proposed", "draft", "prototype", "proposed"].includes(item.source_status), item.kind);
    assert.ok(["concrete", "contract", "alias", "pattern", "constant", "namespace"].includes(item.semantic_class), item.kind);
    assert.equal(item.declares_runtime_instance, ["concrete", "constant"].includes(item.semantic_class), item.kind);
    assert.equal(item.form.startsWith("define "), true, item.kind);
  }
  assert.equal(kinds.get("type").semantic_class, "alias");
  assert.equal(kinds.get("module").semantic_class, "namespace");
  assert.equal(kinds.get("supervisor_actor").source_status, "proposed");
  assert.equal(kinds.get("model").source_status, "draft");
  assert.equal(kinds.get("enum").source_status, "draft");
});

test("declare only permits type/trait/interface, including pub forms", () => {
  assert.deepEqual(manifest.forward_declarations.map(x => x.kind), ["type", "trait", "interface"]);
  for (const d of manifest.forward_declarations) {
    assert.equal(d.private_form, "declare " + d.kind + " Name;");
    assert.equal(d.public_form, "declare pub " + d.kind + " Name;");
    assert.equal(d.status, "proposed");
    assert.equal(kinds.get(d.kind).declares_runtime_instance, false);
  }
});

test("product/sum cardinalities are exact and nominal cases stay distinct", () => {
  assert.equal(enumerate(tuple(Bool, Bool)).length, 4);
  assert.equal(enumerate(sum([{name:"Left",payload:Bool},{name:"Right",payload:Bool}])).length, 4);
  assert.equal(enumerate(option(Bool)).length, 3);
  assert.equal(enumerate(result(Bool, Bool)).length, 4);
  assert.equal(enumerate(option(result(Bool, Bool))).length, 5);
  assert.deepEqual(enumerate(Never), []);
  assert.equal(enumerate(Unit).length, 1);
  assert.equal(enumerate(Int), null);
});

test("Option requires every Some payload and None; infinite int needs wildcard", () => {
  assert.equal(exhaustive(option(Bool),[branch({kind:"some",payload:lit(true)}),branch({kind:"none"})]),false);
  assert.equal(exhaustive(option(Bool),[
    branch({kind:"some",payload:lit(true)}),branch({kind:"some",payload:lit(false)}),branch({kind:"none"})
  ]),true);
  assert.equal(exhaustive(option(Int),[branch({kind:"some",payload:lit(0)}),branch({kind:"none"})]),false);
  assert.equal(exhaustive(option(Int),[branch({kind:"some",payload:wild}),branch({kind:"none"})]),true);
});

test("nested Option<Result> payload coverage is recursive", () => {
  const ty = option(result(Bool,Bool));
  const arms=[
    branch({kind:"none"}),
    branch({kind:"some",payload:{kind:"ok",payload:lit(true)}}),
    branch({kind:"some",payload:{kind:"err",payload:wild}})
  ];
  assert.equal(exhaustive(ty,arms),false);
  assert.equal(exhaustive(ty,[...arms,branch({kind:"some",payload:{kind:"ok",payload:lit(false)}})]),true);
  assert.equal(exhaustive(result(Int,Bool),[branch({kind:"ok",payload:lit(0)}),branch({kind:"err",payload:wild})]),false);
  assert.equal(exhaustive(result(Int,Bool),[branch({kind:"ok",payload:wild}),branch({kind:"err",payload:wild})]),true);
});

test("guards cannot establish coverage", () => {
  assert.equal(exhaustive(Bool,[branch(lit(true),true),branch(lit(false))]),false);
  assert.equal(exhaustive(option(Int),[branch({kind:"some",payload:wild},true),branch({kind:"none"})]),false);
  assert.equal(exhaustive(Bool,[branch(wild,true)]),false);
});

test("dead-arm reachability is cumulative; guards do not shadow", () => {
  assert.deepEqual(unreachable(Bool,[branch(lit(true)),branch(lit(false)),branch(wild)]),[2]);
  assert.deepEqual(unreachable(Bool,[branch(wild),branch(lit(true))]),[1]);
  assert.deepEqual(unreachable(Bool,[branch(lit(true),true),branch(lit(true))]),[]);
  assert.deepEqual(unreachable(Bool,[branch(lit(true)),branch(lit(true))]),[1]);
  assert.equal(unreachable(Int,[branch(lit(0)),branch(wild)]),null);
});

test("exported enum tags reject absent, duplicate, zero, overflow and fractions", () => {
  assert.equal(validCases([{name:"Ok",tag:1},{name:"Err",tag:2}],true),true);
  assert.equal(validCases([{name:"Ok"},{name:"Err",tag:2}],true),false);
  assert.equal(validCases([{name:"Ok",tag:1},{name:"Err",tag:1}],true),false);
  assert.equal(validCases([{name:"Ok",tag:0}],true),false);
  assert.equal(validCases([{name:"Ok",tag:2147483648}],true),false);
  assert.equal(validCases([{name:"Ok",tag:1.5}],true),false);
  assert.equal(validCases([{name:"Ok",tag:1},{name:"Ok",tag:2}],true),false);
  assert.equal(validCases([],true),false);
});

test("constructor checks nominal owner, tag, exact payload shape and scalar types", () => {
  const schema={nominalId:"pkg/Response@v1",cases:[
    {name:"Success",tag:1,payload:{kind:"record",fields:{code:Int,body:Bool}}},
    {name:"Failure",tag:2,payload:Unit}
  ]};
  const value={nominalId:"pkg/Response@v1",case:"Success",tag:1,payload:{code:200,body:true}};
  assert.equal(authenticConstructor(schema,value),true);
  assert.equal(authenticConstructor(schema,{...value,nominalId:"pkg/Other@v1"}),false);
  assert.equal(authenticConstructor(schema,{...value,tag:2}),false);
  assert.equal(authenticConstructor(schema,{...value,payload:{code:200,body:1}}),false);
  assert.equal(authenticConstructor(schema,{...value,payload:{code:200,body:true,extra:7}}),false);
  assert.equal(authenticConstructor(schema,{...value,payload:{code:200.5,body:true}}),false);
  assert.equal(authenticConstructor(schema,{...value,case:"Missing"}),false);
});

test("user-defined tagged sums are closed and nominal", () => {
  const ty=sum([{name:"A",payload:Bool},{name:"B",payload:Bool}]);
  assert.equal(exhaustive(ty,[branch(ctor("A",wild)),branch(ctor("B",wild))]),true);
  assert.equal(exhaustive(ty,[branch(ctor("A",wild))]),false);
  assert.equal(exhaustive(ty,[branch(ctor("A",lit(true))),branch(ctor("B",wild))]),false);
});

test("large finite domains fail conservatively, rather than sample their space", () => {
  const huge = tuple(...Array.from({length: 15},()=>Bool));
  assert.equal(enumerate(huge),null);
  assert.equal(exhaustive(huge,[branch(wild)]),true);
  assert.equal(exhaustive(huge,[branch({kind:"tuple",fields:[lit(true),...Array.from({length:14},()=>wild)]})]),false);
});
