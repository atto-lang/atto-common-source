# Keyed comparisons and owned collections — candidate v1

Tracks #170. Confirmed language rule: `eq` compares values; `==` compares reference/pointer identity. Do not implement structural comparisons through identity. Proposed spellings `~=~`, `=~=`, `><`, `neq`, `<>` require grammar collision audit and owner ratification. Named methods may precede operators. Existing factory contract uses `Map.of<string,int>("a" => 1)`; do not introduce an unreviewed `:=` factory separator.

## Semantics

- `same_keys`: equal key sets independent of values and order.
- `has_overlap`: nonempty intersection of keys.
- `overlapping_values_equal`: shared values agree using `eq`; candidate nonvacuous rule is false for disjoint inputs (including one empty), true for both empty. `conflict_free` is the vacuous variant. Overlap is symmetric and nontransitive: never use as an Eq/Hash witness.
- `contains_keys` and `contains_entries`: directional left contains right; empty right succeeds. `contains_entries` uses `eq` on right-hand values. Missing differs from present None. `eq` on maps requires equal key sets and equal corresponding values.
- Sets compare memberships; do not synthesize map values. Symmetric difference is membership XOR, nonmutating and independently owned; Map `><` not defined.
- Records use declared visible key view, no reflection, top-level only; reject incompatible types unless an explicit coherent equality witness exists. Key values and hashing must remain stable while stored. No silent identity fallback or implicit clone of non-Copy values.

## Layers and cost

`core` supplies allocation-free equality/hash/borrowed key-view contracts; `alloc` supplies actor-owned generic Set/Map with checked capacity, deterministic destruction and fallible growth; `std` reexports. Preserve dense and bounded variants. Avoid temporary collections and copying pointers on read-only comparisons where provable. Hash table scan cost depends on storage capacity or live-entry iteration; expected O(min(n,m)) probes requires live-entry iteration and bounded load, not a guaranteed worst-case. Budget collision work, overflow and cancellation, distinguish unsupported backends from passed guests. Static record shape comparisons can fold at compile time.

## Evidence

`node --test tests/keyed-comparison-reference.test.mjs` runs host reference cases and exhaustive scalar comparisons, not an Atto compiler. The manifest is proposed and all backend statuses remain NOT_EXECUTED. Each backend must run exact-tree compiler-backed positive/negative fixtures, with no allocation claim until measured and independent review. Test collision chains, tombstones, capacity rollback, actor isolation, key mutation rejection, None presence, non-Copy ownership and AOT independently. No public export of private trees without authorization and verified destination policy.
