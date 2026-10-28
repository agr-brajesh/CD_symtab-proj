# Symbol Table Collision Resolution - performance evaluation (C++ + interactive lab)

Topic: *Performance evaluation of a compiler's symbol table implementation - collision resolution.*
Eight strategies (separate chaining, linear / quadratic probing, double hashing, Robin Hood, and three hybrids:
H1 chaining+tree, H2 open addressing+overflow, H3 cuckoo+stash) measured under identical conditions.

## Quick start (for the demo)
Double-click **lab/index.html** - works offline in any modern browser, nothing to install.
Tabs: Visualizer (animated probe traces) - Benchmark (change any value, sweep any parameter, charts, CSV/PNG) -
Compiler (paste real source code) - Hash Lab - Tests (correctness proof) - Guide.


## Folder structure
| path | content |
|---|---|
| `source/symtab.h, symtab.cpp` | the library: 8 strategies, 5 hash functions, block-scope manager |
| `source/benchmark.cpp` | produces `data/results.csv` (load-factor sweep) and `results_extended.csv` |
| `source/symtab_cli.cpp` | scriptable runner used to check the JS port against the C++ |
| `source/plot_results.py` | regenerates the 12 graphs in `data/` |
| `tests/test_correctness.cpp` | 1.44 M checks: hash vectors, edge cases, scopes, differential fuzzing |
| `lab/` | `index.html` (built), `src/` (sources), `build.py`, `tests/` (JS vs C++ equivalence) |
| `data/` | CSV results + graphs |

## Build / run (needs g++ with C++17 and make)
```
make                 # benchmark + symtab_cli
make test            # correctness suite under AddressSanitizer/UBSan
cd data && ../benchmark && ../benchmark --extended --n 30000 --hash all --file ../source/symtab.cpp
python3 ../source/plot_results.py        # needs pandas + matplotlib
cd lab && node tests/test_engine.js      # JS engine vs C++ binary (needs node, built symtab_cli)
python3 lab/build.py                     # rebuild lab/index.html after editing lab/src
```

## What was verified
* C++ library vs `std::unordered_map`: 1,440,000 random operations, 8 strategies x 5 hashes x 6 configurations.
* JS engine vs C++ binary on identical operation scripts: probes, collisions, resizes, failures, memory all identical.
* Browser test of every tab and preset, 0 JavaScript errors.

## Corrections made to the original code
1. Linking failed without `-O2` (`static const` members odr-used) - now runtime options.
2. FNV-1a 64-bit offset basis had a digit missing - now the standard constant (test vector added).
3. Cuckoo used two `rng()` calls in one expression (compiler-dependent) - own deterministic PRNG, sequenced.
4. Experiment A gave cuckoo slightly more keys than the others - now identical n for every strategy.

## Notes
"Probe" = one slot, list node or tree level examined. H1's tree cost is estimated as ceil(log2(size+1)); cuckoo
counts slots in its two buckets. Probe counts are machine independent; times are single-machine (C++ times are
authoritative, browser times include JIT effects).

## Revised evaluation (experiments.cpp, analysis/, run_all.sh)
`make all experiments test_correctness`, then `sh run_all.sh` regenerates every number of the manuscript: per-trial Experiment A (30 trials, djb2 and FNV-1a),
probe-length distributions, hybrid stress tests (weak hash, multi-collision keys), name@depth vs shadow-chain scope designs, Experiment B (7 workloads x 5 hashes x 8 strategies, repeated),
and replays of identifier streams from Lua 5.4.7, zlib 1.3.1, Redis 7.2.5 and SQLite 3.46.0 (`fetch_corpora.sh`, pinned tags). Raw per-trial CSV files are in `results/`, figures in `figures/`.
"Consistent probes" = raw counter + 1 for chaining/H1 lookups (bucket-head read), see manuscript Section III-D.
