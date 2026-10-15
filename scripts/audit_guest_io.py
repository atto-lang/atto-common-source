#!/usr/bin/env python3
"""Inventory source references requiring strict native I/O migration.

This is a lexical migration gate, not a compiler/effect checker or execution
proof. It deliberately does not infer safety from an _async suffix.
"""
import argparse, hashlib, json, pathlib, re
TOKEN = re.compile(r'//[^\n]*|/\*.*?\*/|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|[A-Za-z_][A-Za-z_0-9]*|[^\s]', re.S)
LEGACY = {
    "stdio": None, "fs": None, "File": None,
    "http": {"get", "post", "listen", "get_text", "post_text", "get_text_async", "post_text_async", "get_async", "post_async"},
    "network": {"connect", "connect_async", "listen", "listen_async_legacy", "listen_nonblocking"},
    "tcp": None,
}
BARE = {"print", "println", "read_text_blocking", "read_text_async", "write_text_blocking", "write_text_async", "println_blocking", "println_async"}
EXCLUDED = {".git", "node_modules", "target", "build", "audit-worktrees", "audit-reports", "merge-reports", "batch-worktrees-20261015"}
def references(source):
    tokens = [(m.group(), m.start()) for m in TOKEN.finditer(source)
              if not m.group().startswith(("//", "/*", '"', "'"))]
    found = []
    for i, (token, offset) in enumerate(tokens):
        name = None
        if token in LEGACY and i+2 < len(tokens) and tokens[i+1][0] == ".":
            member = tokens[i+2][0]
            if LEGACY[token] is None or member in LEGACY[token]: name = token+"."+member
        elif token in BARE and (i == 0 or tokens[i-1][0] != "."):
            name = token
        if name: found.append({"line":source.count("\n",0,offset)+1,"reference":name})
    return found

def scan(root):
    records = []
    for path in sorted(root.rglob("*.ores")):
        relative = path.relative_to(root)
        if path.is_symlink() or any(part in EXCLUDED or part.startswith("batch-worktrees-") for part in relative.parts): continue
        source = path.read_text(encoding="utf-8")
        matches = references(source)
        if matches: records.append({"file":str(relative),"sha256":hashlib.sha256(source.encode()).hexdigest(),"references":matches})
    return {"schemaVersion":1,"policy":"native-async-only","scope":"lexical migration candidates; compiler verification required","files":records,"references":sum(len(x["references"]) for x in records)}
if __name__ == "__main__":
    parser=argparse.ArgumentParser();parser.add_argument("root",type=pathlib.Path);parser.add_argument("--require-clean",action="store_true")
    args=parser.parse_args();result=scan(args.root.resolve());print(json.dumps(result,indent=2))
    raise SystemExit(1 if args.require_clean and result["references"] else 0)
