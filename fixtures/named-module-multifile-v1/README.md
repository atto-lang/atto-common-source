# Named modules across multiple Oreslang files (future compiler fixture)

There are ten physical Oreslang files in the analytics package, forming exactly three named logical modules: data (4 files), compute (3 files), api (3 files).

The consumer package uses one import of the public compute module from a pinned package alias. Its main function should return **43** after future compilers support this contract (add(20, 1) = 21, double = 42, aggregate = 43).

The files use proposed module fragment merging, explicit module visibility, scoped member visibility and package-qualified module selectors. This directory is intentionally **not advertised as a running Oreslang program yet**. The manifests use proposed schema v2; dependency alias-to-package-instance pinning is modeled by contracts/named-module-multifile-js-v1.json, not a made-up lockfile format.

The source-free Node tests validate fixture shape and a conservative namespace linker/ESM export model. Passing them does **not** validate Java/LLVM execution or working JS transpilation. Actual compiler proof is required before promoting this feature.
