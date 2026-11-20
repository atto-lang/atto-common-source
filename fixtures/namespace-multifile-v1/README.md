# One package, ten files, three namespaces

Package foo owns 10 .ores files across folders: namespace a (3 files), namespace b (4), namespace c (3). Namespaces DO NOT span packages. Package app imports namespace a ONCE from foo with exact source syntax: import ns a from 'pkg:foo';. The expected integer is 43.

These are proposed future compiler fixtures, not proven runnable. Package manifest schema v2 and pinned dependency alias resolution are also proposals. The source-free oracle validates the contract only.
