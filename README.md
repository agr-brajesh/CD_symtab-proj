# Symbol Table Collision Resolution - Performance Evaluation (C++ + Interactive Lab)

> Topic: *Performance evaluation of a compiler's symbol table implementation — collision resolution.*  
> Eight strategies (separate chaining, linear / quadratic probing, double hashing, Robin Hood, and three hybrids: H1 chaining+tree, H2 open addressing+overflow, H3 cuckoo+stash) measured under identical conditions.

---

## 📑 Project Documents & Research Manuscript (For Faculty & Reviewers)

> [!IMPORTANT]
> **Direct links to review documents (open directly in GitHub):**
> 
> | Document | Description | Format / Direct Link |
> | :--- | :--- | :--- |
> | 📄 **Research Paper (Draft 2)** | Full 16-page manuscript formatted for *IEEE Access*: *"Performance Evaluation of a Compiler's Symbol Table Implementation: Collision Resolution Strategies"* | [**Open `docs/Manuscript_Draft2.pdf`**](docs/Manuscript_Draft2.pdf) *(GitHub PDF Viewer)* |
> | 📦 **Overleaf LaTeX Package** | Complete Overleaf-ready project archive including all source `.tex` files, figures, and author photos | [**Download `symbol_table_overleaf.zip`**](docs/symbol_table_overleaf.zip) |
> | 📝 **Overleaf LaTeX Source** | IEEE Access article LaTeX source file | [**View `manuscript/access.tex`**](manuscript/access.tex) |
> | 🔬 **Interactive Web Lab** | Zero-install interactive browser lab: probe trace visualizer, benchmark harness, and compiler simulator | [**Launch `lab/index.html`**](lab/index.html) |
> | 📊 **Experimental Figures** | High-resolution publication plots (probe distributions, load sweeps, memory models, scope latency) | [**Browse `figures/`**](figures/) |
> | 📈 **Empirical Dataset** | Raw per-trial benchmark CSVs across 30 repetitions, real-world C corpora, and stress scenarios | [**Browse `results/`**](results/) |

### 📌 Research Manuscript Summary
- **Title:** *Performance Evaluation of a Compiler’s Symbol Table Implementation: Collision Resolution Strategies*
- **Target Journal:** *IEEE Access* (Under Review, November 2026)
- **Authors:** Syed Ayman Alam, Girijeshvasan M, and Brajesh Agrawal
- **Institution:** School of Computer Science and Engineering (SCOPE), Vellore Institute of Technology (VIT), Vellore, India
- **Key Highlights:**
  1. **Comprehensive Library:** 8 collision-resolution strategies (separate chaining, linear / quadratic probing, double hashing, Robin Hood, H1 chaining+tree, H2 open addressing+overflow, H3 cuckoo+stash) and 5 string hashes.
  2. **Consistent Probe Metric:** Normalizes comparison across open addressing and chaining by counting physical memory reads consistently.
  3. **Real-World Compiler Traces:** Evaluated over 547,703 tokens from four production C codebases: **Lua 5.4.7**, **zlib 1.3.1**, **Redis 7.2.5**, and **SQLite 3.46.0**.
  4. **Scope Architectures:** Proves that the conventional **shadow-chain scope design is $2.6\times\text{--}3.2\times$ faster** than `name@depth` at nesting depth 8.

---

## Quick start (for the demo)
Double-click **lab/index.html** - works offline in any modern browser, nothing to install.  
Tabs: Visualizer (animated probe traces) - Benchmark (change any value, sweep any parameter, charts, CSV/PNG) - Compiler (paste real source code) - Hash Lab - Tests (correctness proof) - Guide.

## System requirements
- Linux or macOS (tested on Ubuntu 24.04.4 LTS, x86-64); Windows users can use WSL
- g++ 13 (any compiler with C++17), make
- Python 3.12 and the packages in `requirements.txt` (only for the analysis and plots)
- Node.js 22 (only for the JavaScript-vs-C++ equivalence test in `lab/tests`)
- A modern web browser (for `lab/index.html`)

## Installation
```bash
git clone https://github.com/agr-brajesh/CD_symtab-proj.git
cd CD_symtab-proj
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
make all experiments test_correctness
```

## Run
| goal | command |
|---|---|
| correctness tests (1.44 M checks, sanitizers) | `make test` |
| reproduce every number and figure of the manuscript | `sh run_all.sh` |
| download the four real-code corpora (Lua, zlib, Redis, SQLite) | `sh fetch_corpora.sh` |
| interactive demo, no installation | open `lab/index.html` in a browser |

## Folder structure
| path | content |
|---|---|
| `docs/` | project documentation: [Manuscript PDF](docs/Manuscript_Draft2.pdf) and [Overleaf ZIP bundle](docs/symbol_table_overleaf.zip) |
| `source/symtab.h, symtab.cpp` | the library: 8 strategies, 5 hash functions, block-scope manager |
| `source/benchmark.cpp` | produces `data/results.csv` (load-factor sweep) and `results_extended.csv` |
| `source/experiments.cpp` | per-trial sweeps, distributions, stress tests, scope designs, Experiment B, traces |
| `source/symtab_cli.cpp` | scriptable runner used to check the JS port against the C++ |
| `source/plot_results.py` | regenerates the 12 graphs in `data/` |
| `analysis/analyze.py` | statistics, figures and tables from the raw CSV files |
| `tests/test_correctness.cpp` | 1.44 M checks: hash vectors, edge cases, scopes, differential fuzzing |
| `lab/` | `index.html` (built), `src/` (sources), `build.py`, `tests/` (JS vs C++ equivalence) |
| `data/` | CSV results + graphs |
| `results/` | raw per-trial CSV files from revised evaluations |
| `figures/` | generated manuscript figures and plots |
| `manuscript/` | [Overleaf LaTeX source (`access.tex`)](manuscript/access.tex) and build script for Overleaf / docx |

## Datasets
Synthetic workloads are generated by the programs (fixed seeds). The real identifier streams come from the pinned release
tags listed in Table 5 of the manuscript and are downloaded by `fetch_corpora.sh` (SHA-256 checksums in `corpora/SHA256SUMS.txt`).

## Results
Raw per-trial CSV files are in `results/`, figures in `figures/`, the original five-trial results in `data/`.

## Documentation
- **Manuscript (Draft 2):** [`docs/Manuscript_Draft2.pdf`](docs/Manuscript_Draft2.pdf)
- **Overleaf LaTeX Archive:** [`docs/symbol_table_overleaf.zip`](docs/symbol_table_overleaf.zip)
- **Overleaf LaTeX Source File:** [`manuscript/access.tex`](manuscript/access.tex)

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
