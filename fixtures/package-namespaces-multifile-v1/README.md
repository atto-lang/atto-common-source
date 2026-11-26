# Multi-file package namespace conformance fixture (proposed)

This is a **future-acceptance fixture**, not a verified current-main compiler program.

- `checkout/.ores.pkg.toml` declares exactly ten source files in one verified package.
- Four files declare `namespace billing;`, three `identity`, and three `telemetry`.
- `checkout/src/identity/accounts.ores` imports `billing` once from its own package and must produce `10` from `find_account()`.
- `client/src/main.ores` imports the same namespace once from a separately pinned `checkout` dependency and must produce `10` from `smoke()`.
- The `calculate_fee` function is package-private: allowed inside the exact `checkout` package and denied in `client`. `internal_sequence` remains private.
- All import members have statically bound providers. Header-matching files in a *different* package instance must never be merged.

The canonical dependency lock/instance mapping is deliberately left as a host-resolver input, not an invented version/name convention. Both `import namespace` and schema-v2 manifest grouping still require compiler integration; Java/Graal, LLVM, .NET and Wasm must fail closed until they execute this exact kind of multi-source graph. A source-free reference model is in `scripts/verify_package_namespace_multifile_contract.py` and its JSON vector in `contracts/package-namespace-multifile-v1.json`.
