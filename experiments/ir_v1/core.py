"""Experimental typed HIR to SSA-like MIR, with strict validation and interpreter.

Intentionally bounded and backend-neutral. This is not a verified Oreslang
compiler frontend or an adapter to the Java/LLVM backends. No IO, effects,
actors, generics, mutable places, recursion or loops in the supported subset.
"""
from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from hashlib import sha256
import json
import re

VERSION = "1.0.0-experimental"
FEATURES = ["bool.v1", "checked-i64.v1", "control-flow.v1", "functions.v1"]
MIN_I64, MAX_I64 = -(2**63), 2**63 - 1
NAME = re.compile(r"[A-Za-z_][A-Za-z_0-9]*\Z")
INTEGER = re.compile(r"(?:0|-?[1-9][0-9]*)\Z")
MAX_BYTES, MAX_FUNCTIONS, MAX_BLOCKS, MAX_INSTRUCTIONS = 1_048_576, 32, 128, 2048


class IRValidationError(ValueError):
    pass


class IRRuntimeError(RuntimeError):
    pass


def require(ok, message):
    if not ok:
        raise IRValidationError(message)


def keys(value, expected, where):
    require(type(value) is dict, f"{where}: expected an object")
    require(set(value) == set(expected), f"{where}: keys must equal {sorted(expected)}")


def identifier(value):
    require(type(value) is str and len(value) <= 128 and NAME.fullmatch(value),
            f"invalid identifier: {str(value)[:100]}")


def i64_literal(value):
    require(type(value) is str and len(value) <= 21 and INTEGER.fullmatch(value),
            "i64 literal must be a canonical decimal string")
    number = int(value)
    require(MIN_I64 <= number <= MAX_I64, "i64 literal outside signed 64-bit range")
    return number


def canonical_bytes(value):
    try:
        raw = json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False,
                         separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError, RecursionError) as exc:
        raise IRValidationError("invalid canonical JSON value") from exc
    require(len(raw) <= MAX_BYTES, "IR exceeds the one MiB limit")
    return raw


def fingerprint(value):
    return sha256(canonical_bytes(value)).hexdigest()


def load_json(raw):
    require(type(raw) in (str, bytes), "JSON input must be text/bytes")
    raw = raw.encode("utf-8") if type(raw) is str else raw
    require(len(raw) <= MAX_BYTES, "JSON input too large")

    def no_duplicates(pairs):
        d = {}
        for k, v in pairs:
            require(k not in d, f"duplicate JSON key: {k}")
            d[k] = v
        return d

    def invalid_constant(v):
        raise IRValidationError(f"nonfinite JSON value: {v}")

    try:
        return json.loads(raw, object_pairs_hook=no_duplicates,
                          parse_constant=invalid_constant)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as exc:
        raise IRValidationError("invalid or overnested JSON document") from exc


def envelope(value, family):
    keys(value, ["ir_family", "schema_version", "module_id", "required_features", "functions"], family)
    require(value["ir_family"] == family, "IR family mismatch")
    require(value["schema_version"] == VERSION, "unknown IR schema version")
    identifier(value["module_id"])
    require(value["required_features"] == FEATURES, "unsupported required feature set")
    funcs = value["functions"]
    require(type(funcs) is list and 0 < len(funcs) <= MAX_FUNCTIONS, "invalid function count")
    seen = set()
    for f in funcs:
        require(type(f) is dict and type(f.get("name")) is str, "invalid function")
        identifier(f["name"])
        require(f["name"] not in seen, "duplicate function")
        seen.add(f["name"])
    require([f["name"] for f in funcs] == sorted(seen), "functions must be sorted by name")
    canonical_bytes(value)
    return funcs


def signatures(funcs):
    out = {}
    for f in funcs:
        require(type(f.get("params")) is list and len(f["params"]) <= 32, "invalid params")
        names = []
        for p in f["params"]:
            keys(p, ["name", "type"], "parameter")
            identifier(p["name"])
            require(p["type"] in ("i64", "bool"), "unsupported parameter type")
            names.append(p["name"])
        require(len(set(names)) == len(names), "duplicate parameters")
        require(f.get("result_type") in ("i64", "bool"), "invalid function return type")
        out[f["name"]] = ([p["type"] for p in f["params"]], f["result_type"])
    return out


def expression(expr, env, sigs, budget, depth=0):
    require(depth <= 48 and budget[0] < 2048, "HIR expression budget exceeded")
    budget[0] += 1
    require(type(expr) is dict and type(expr.get("kind")) is str, "invalid HIR expression")
    kind = expr["kind"]
    if kind == "int":
        keys(expr, ["kind", "value"], kind)
        i64_literal(expr["value"])
        return "i64"
    if kind == "bool":
        keys(expr, ["kind", "value"], kind)
        require(type(expr["value"]) is bool, "boolean literal required")
        return "bool"
    if kind == "var":
        keys(expr, ["kind", "name"], kind)
        identifier(expr["name"])
        require(expr["name"] in env, "unbound local")
        return env[expr["name"]]
    if kind == "bin":
        keys(expr, ["kind", "op", "lhs", "rhs"], kind)
        require(expr["op"] in ("add", "sub", "mul", "lt", "eq"), "unsupported binary operation")
        a = expression(expr["lhs"], env, sigs, budget, depth + 1)
        b = expression(expr["rhs"], env, sigs, budget, depth + 1)
        require(a == b == "i64", "binary operands must be i64")
        return "bool" if expr["op"] in ("lt", "eq") else "i64"
    if kind == "call":
        keys(expr, ["kind", "function", "args"], kind)
        identifier(expr["function"])
        require(expr["function"] in sigs, "call of unknown function")
        require(type(expr["args"]) is list, "call args must be a list")
        params, result = sigs[expr["function"]]
        require(len(expr["args"]) == len(params), "call arity mismatch")
        for arg, param_type in zip(expr["args"], params):
            require(expression(arg, env, sigs, budget, depth + 1) == param_type,
                    "call argument type mismatch")
        return result
    if kind == "let":
        keys(expr, ["kind", "name", "value", "body"], kind)
        identifier(expr["name"])
        require(expr["name"] not in env, "shadowing forbidden in experimental subset")
        typ = expression(expr["value"], env, sigs, budget, depth + 1)
        return expression(expr["body"], {**env, expr["name"]: typ}, sigs, budget, depth + 1)
    if kind == "if":
        keys(expr, ["kind", "condition", "then", "else"], kind)
        require(expression(expr["condition"], env, sigs, budget, depth + 1) == "bool",
                "if condition must be bool")
        a = expression(expr["then"], env, sigs, budget, depth + 1)
        b = expression(expr["else"], env, sigs, budget, depth + 1)
        require(a == b, "if arms must return the same type")
        return a
    raise IRValidationError("unknown HIR expression kind")


def reject_call_cycles(graph):
    """The experimental subset does not admit recursion, including mutual recursion."""
    active, done = set(), set()
    def walk(name):
        require(name not in active, "recursive call cycle unsupported in v1")
        if name in done:
            return
        active.add(name)
        for callee in graph[name]:
            walk(callee)
        active.remove(name)
        done.add(name)
    for name in graph:
        walk(name)


def hir_callees(expr):
    kind = expr["kind"]
    if kind == "call":
        return {expr["function"]} | set().union(*(hir_callees(a) for a in expr["args"]))
    if kind == "bin":
        return hir_callees(expr["lhs"]) | hir_callees(expr["rhs"])
    if kind == "if":
        return hir_callees(expr["condition"]) | hir_callees(expr["then"]) | hir_callees(expr["else"])
    if kind == "let":
        return hir_callees(expr["value"]) | hir_callees(expr["body"])
    return set()


def validate_hir(module):
    funcs = envelope(module, "ores-hir")
    sigs = signatures(funcs)
    for f in funcs:
        keys(f, ["name", "params", "result_type", "body"], "HIR function")
        env = {p["name"]: p["type"] for p in f["params"]}
        require(expression(f["body"], env, sigs, [0]) == f["result_type"],
                f"return type mismatch in {f['name']}")
    reject_call_cycles({f["name"]: hir_callees(f["body"]) for f in funcs})
    return deepcopy(module)


class Builder:
    def __init__(self, function):
        self.function = function
        self.blocks = []
        self.temp = 0
        self.current = self.block(function["params"])

    def fresh(self):
        v = f"v{self.temp}"
        self.temp += 1
        return v

    def block(self, params):
        b = {"id": f"b{len(self.blocks)}", "params": deepcopy(params),
             "instructions": [], "term": None}
        self.blocks.append(b)
        return b

    def emit(self, op, typ, **fields):
        vid = self.fresh()
        self.current["instructions"].append({"op": op, "id": vid, "type": typ, **fields})
        return vid

    def lower_expr(self, expr, env):
        kind = expr["kind"]
        if kind == "int":
            return self.emit("const_i64", "i64", value=expr["value"]), "i64"
        if kind == "bool":
            return self.emit("const_bool", "bool", value=expr["value"]), "bool"
        if kind == "var":
            return env[expr["name"]]
        if kind == "bin":
            a, _ = self.lower_expr(expr["lhs"], env)
            b, _ = self.lower_expr(expr["rhs"], env)
            op = expr["op"]
            result = "bool" if op in ("lt", "eq") else "i64"
            return self.emit(op + "_i64", result, lhs=a, rhs=b), result
        if kind == "call":
            args = [self.lower_expr(a, env)[0] for a in expr["args"]]
            result = self.function["signatures"][expr["function"]][1]
            return self.emit("call", result, function=expr["function"], args=args), result
        if kind == "let":
            val = self.lower_expr(expr["value"], env)
            return self.lower_expr(expr["body"], {**env, expr["name"]: val})
        if kind == "if":
            condition, _ = self.lower_expr(expr["condition"], env)
            left, right = self.block([]), self.block([])
            self.current["term"] = {"op": "branch", "cond": condition,
                                    "then": left["id"], "then_args": [],
                                    "else": right["id"], "else_args": []}
            self.current = left
            vleft, typ = self.lower_expr(expr["then"], env)
            end_left = self.current
            self.current = right
            vright, _ = self.lower_expr(expr["else"], env)
            end_right = self.current
            joined = self.fresh()
            join = self.block([{"name": joined, "type": typ}])
            end_left["term"] = {"op": "jump", "target": join["id"], "args": [vleft]}
            end_right["term"] = {"op": "jump", "target": join["id"], "args": [vright]}
            self.current = join
            return joined, typ
        raise AssertionError("unreachable: HIR verified")


def lower(hir):
    hir = validate_hir(hir)
    sigs = signatures(hir["functions"])
    funcs = []
    for fn in hir["functions"]:
        builder = Builder({**fn, "signatures": sigs})
        env = {p["name"]: (p["name"], p["type"]) for p in fn["params"]}
        result, _ = builder.lower_expr(fn["body"], env)
        builder.current["term"] = {"op": "return", "value": result}
        funcs.append({"name": fn["name"], "params": fn["params"],
                      "result_type": fn["result_type"], "blocks": builder.blocks})
    mir = {"ir_family": "ores-mir", "schema_version": VERSION,
           "module_id": hir["module_id"], "required_features": FEATURES,
           "functions": funcs}
    return validate_mir(mir)


def validate_mir(module):
    funcs = envelope(module, "ores-mir")
    sigs = signatures(funcs)
    call_graph = {f["name"]: set() for f in funcs}
    for fn in funcs:
        keys(fn, ["name", "params", "result_type", "blocks"], "MIR function")
        blocks = fn["blocks"]
        require(type(blocks) is list and 0 < len(blocks) <= MAX_BLOCKS, "invalid block count")
        names = [f"b{i}" for i in range(len(blocks))]
        require([b.get("id") if type(b) is dict else None for b in blocks] == names,
                "blocks must be uniquely sequential and ordered")
        by_id = {b["id"]: b for b in blocks}
        definition = {}
        predecessors = defaultdict(set)
        edges = defaultdict(list)
        uses = []
        instruction_count = 0
        for b in blocks:
            keys(b, ["id", "params", "instructions", "term"], "block")
            require(type(b["params"]) is list and type(b["instructions"]) is list,
                    "invalid block content")
            require(len(b["params"]) <= 32, "too many block parameters")
            for p in b["params"]:
                keys(p, ["name", "type"], "block parameter")
                identifier(p["name"])
                require(p["type"] in ("i64", "bool"), "invalid block parameter type")
                require(p["name"] not in definition, "SSA value defined twice")
                definition[p["name"]] = (b["id"], -1, p["type"])
            for idx, ins in enumerate(b["instructions"]):
                instruction_count += 1
                require(instruction_count <= MAX_INSTRUCTIONS, "instruction budget exceeded")
                require(type(ins) is dict and type(ins.get("op")) is str, "bad instruction")
                op = ins["op"]
                if op in ("const_i64", "const_bool"):
                    keys(ins, ["op", "id", "type", "value"], op)
                    if op == "const_i64":
                        i64_literal(ins["value"])
                    else:
                        require(type(ins["value"]) is bool, "const_bool requires boolean")
                    typ = "i64" if op == "const_i64" else "bool"
                elif op in ("add_i64", "sub_i64", "mul_i64", "lt_i64", "eq_i64"):
                    keys(ins, ["op", "id", "type", "lhs", "rhs"], op)
                    uses += [(b["id"], idx, ins["lhs"], "i64"),
                             (b["id"], idx, ins["rhs"], "i64")]
                    typ = "bool" if op in ("lt_i64", "eq_i64") else "i64"
                elif op == "call":
                    keys(ins, ["op", "id", "type", "function", "args"], op)
                    identifier(ins["function"])
                    require(ins["function"] in sigs, "call of undefined function")
                    call_graph[fn["name"]].add(ins["function"])
                    arg_types, typ = sigs[ins["function"]]
                    require(type(ins["args"]) is list and len(ins["args"]) == len(arg_types),
                            "call arity mismatch")
                    uses += [(b["id"], idx, arg, typ) for arg, typ in zip(ins["args"], arg_types)]
                else:
                    raise IRValidationError("unknown MIR opcode")
                require(ins["type"] == typ, "instruction result type mismatch")
                identifier(ins["id"])
                require(ins["id"] not in definition, "SSA value defined twice")
                definition[ins["id"]] = (b["id"], idx, typ)
            term = b["term"]
            require(type(term) is dict and type(term.get("op")) is str,
                    "each block requires a terminator")
            pos = len(b["instructions"])
            if term["op"] == "return":
                keys(term, ["op", "value"], "return")
                uses.append((b["id"], pos, term["value"], fn["result_type"]))
            elif term["op"] == "jump":
                keys(term, ["op", "target", "args"], "jump")
                edges[b["id"]].append((term["target"], term["args"]))
            elif term["op"] == "branch":
                keys(term, ["op", "cond", "then", "then_args", "else", "else_args"], "branch")
                uses.append((b["id"], pos, term["cond"], "bool"))
                edges[b["id"]].extend([(term["then"], term["then_args"]),
                                        (term["else"], term["else_args"])])
            else:
                raise IRValidationError("unknown terminator")
        require(blocks[0]["params"] == fn["params"], "entry parameters must match function signature")
        for src, destinations in edges.items():
            for target, args in destinations:
                require(type(target) is str and target in by_id, "edge targets undefined block")
                require(type(args) is list and len(args) == len(by_id[target]["params"]),
                        "edge argument arity mismatch")
                predecessors[target].add(src)
                for arg, param in zip(args, by_id[target]["params"]):
                    uses.append((src, len(by_id[src]["instructions"]), arg, param["type"]))
        require(not predecessors["b0"], "entry cannot have predecessors")
        for b in blocks[1:]:
            require(predecessors[b["id"]], "nonentry block requires a predecessor")
        visited, visiting = set(), set()
        def walk(bid):
            require(bid not in visiting, "CFG cycle unsupported in v1")
            if bid in visited:
                return
            visiting.add(bid)
            for dest, _ in edges[bid]:
                walk(dest)
            visiting.remove(bid)
            visited.add(bid)
        walk("b0")
        require(visited == set(by_id), "unreachable MIR block")
        dominators = {bid: set(by_id) for bid in by_id}
        dominators["b0"] = {"b0"}
        changed = True
        while changed:
            changed = False
            for b in blocks[1:]:
                bid = b["id"]
                new = {bid} | set.intersection(*(dominators[p] for p in predecessors[bid]))
                if new != dominators[bid]:
                    dominators[bid] = new
                    changed = True
        for block, position, name, expected in uses:
            require(type(name) is str and name in definition, "SSA reference is undefined")
            defblock, defpos, typ = definition[name]
            require(typ == expected, "SSA operand type mismatch")
            require(defblock in dominators[block], "SSA definition does not dominate use")
            if defblock == block:
                require(defpos < position, "SSA use occurs before definition")
    reject_call_cycles(call_graph)
    return deepcopy(module)


def execute(mir, function, args, *, max_steps=10_000):
    mir = validate_mir(mir)
    require(type(function) is str and type(args) is list, "invalid entry request")
    functions = {f["name"]: f for f in mir["functions"]}
    require(function in functions, "unknown entry function")
    require(type(max_steps) is int and 0 < max_steps <= 1_000_000, "invalid execution budget")
    budget = [max_steps]

    def assert_type(value, typ):
        require(type(value) is (int if typ == "i64" else bool), "runtime argument type mismatch")
        if typ == "i64":
            require(MIN_I64 <= value <= MAX_I64, "runtime argument i64 overflow")

    def run(name, values, depth):
        if depth >= 32:
            raise IRRuntimeError("maximum call depth exceeded")
        fn = functions[name]
        require(len(values) == len(fn["params"]), "runtime arity mismatch")
        for value, p in zip(values, fn["params"]):
            assert_type(value, p["type"])
        blocks = {b["id"]: b for b in fn["blocks"]}
        bid = "b0"
        pending = values
        env = {}
        while True:
            if budget[0] <= 0:
                raise IRRuntimeError("instruction budget exceeded")
            block = blocks[bid]
            env.update(zip((p["name"] for p in block["params"]), pending))
            for ins in block["instructions"]:
                budget[0] -= 1
                if budget[0] < 0:
                    raise IRRuntimeError("instruction budget exceeded")
                op = ins["op"]
                if op == "const_i64":
                    value = int(ins["value"])
                elif op == "const_bool":
                    value = ins["value"]
                elif op == "call":
                    value = run(ins["function"], [env[a] for a in ins["args"]], depth + 1)
                else:
                    a, b = env[ins["lhs"]], env[ins["rhs"]]
                    if op == "add_i64":
                        value = a + b
                    elif op == "sub_i64":
                        value = a - b
                    elif op == "mul_i64":
                        value = a * b
                    elif op == "lt_i64":
                        value = a < b
                    elif op == "eq_i64":
                        value = a == b
                    else:
                        raise AssertionError("verifier missed opcode")
                    if op in ("add_i64", "sub_i64", "mul_i64") and not MIN_I64 <= value <= MAX_I64:
                        raise IRRuntimeError("checked i64 arithmetic overflow")
                env[ins["id"]] = value
            budget[0] -= 1
            term = block["term"]
            if term["op"] == "return":
                return env[term["value"]]
            if term["op"] == "jump":
                bid, pending = term["target"], [env[a] for a in term["args"]]
            else:
                if env[term["cond"]]:
                    bid, pending = term["then"], [env[a] for a in term["then_args"]]
                else:
                    bid, pending = term["else"], [env[a] for a in term["else_args"]]

    return run(function, args, 0)
