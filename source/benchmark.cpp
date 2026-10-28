// =============================================================================
//  benchmark.cpp
//
//  Mode 1 (default)  MODEL-STYLE LOAD-FACTOR SWEEP  ->  results.csv
//      Same methodology as the reference project: fixed capacity 10,007 slots, load factors
//      0.1 ... 0.95, n = capacity * LF unique random identifiers, n successful + n unsuccessful
//      searches, averaged over several trials. All 8 strategies get the SAME keys.
//
//  Mode 2 (--extended)  REAL-COMPILER CONDITIONS  ->  results_extended.csv
//      Tables start small and resize automatically (max load 0.7); 3-4 workloads (random,
//      sequential var0..varN, code-like names, optional real identifiers from a source file);
//      all 5 hash functions; insert / hit / miss / delete in ns per op; plus a block-scoped
//      workload (enter scope / declare / resolve / exit scope) and a correctness check.
//
//  Build:  g++ -O2 -std=c++17 -Wall -o benchmark symtab.cpp benchmark.cpp
//  Run  :  ./benchmark                        (sweep)
//          ./benchmark --extended [--n 100000] [--file some_source.c] [--hash all|djb2|...]
// =============================================================================
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <functional>
#include <iostream>
#include <numeric>
#include <random>
#include <string>
#include <unordered_set>
#include <vector>

#include "symtab.h"
using namespace std;

static const size_t CAPACITY = 10007;   // prime, same as the reference project
static const int NUM_TRIALS = 5;        // averaged
static const char ALNUM[] = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";

template <class F> static double timeMs(F f) {
    auto a = chrono::steady_clock::now(); f(); auto b = chrono::steady_clock::now();
    return chrono::duration<double, milli>(b - a).count();
}

/* ------------------------------ key generators ------------------------------ */
static string genIdent(mt19937_64 &r, size_t minLen = 3, size_t maxLen = 15) {      // compiler-like: 3-15 chars, first char alphabetic
    size_t len = minLen + r() % (maxLen - minLen + 1); string s;
    s += ALNUM[r() % 52]; for (size_t i = 1; i < len; i++) s += ALNUM[r() % 63];
    return s;
}
static vector<string> uniqueRandom(size_t n, mt19937_64 &r, const unordered_set<string> *avoid = nullptr) {
    unordered_set<string> seen; vector<string> v; v.reserve(n);
    while (v.size() < n) { string s = genIdent(r); if (avoid && avoid->count(s)) continue; if (seen.insert(s).second) v.push_back(s); }
    return v;
}
static vector<string> genSequential(size_t n) { vector<string> v; for (size_t i = 0; i < n; i++) v.push_back("var" + to_string(i)); return v; }
static vector<string> genCodeLike(size_t n, mt19937_64 &r) {
    static const char *W[] = {"buf","len","count","index","tmp","result","node","next","prev","head","tail","size",
                              "value","key","data","ptr","flag","state","error","name","type","scope","table","offset"};
    unordered_set<string> seen; vector<string> v;
    while (v.size() < n) {
        string s = W[r() % 24]; int parts = (int)(r() % 3);
        for (int p = 0; p < parts; p++) { s += '_'; s += W[r() % 24]; }
        if (r() % 2) s += to_string(r() % 1000);
        if (r() % 5 == 0) s = "m_" + s;
        if (seen.insert(s).second) v.push_back(s);
    }
    return v;
}
static vector<string> loadIdentifiers(const string &path) {
    ifstream in(path); if (!in) { fprintf(stderr, "cannot open %s\n", path.c_str()); exit(1); }
    string txt((istreambuf_iterator<char>(in)), istreambuf_iterator<char>());
    unordered_set<string> seen; vector<string> v; size_t i = 0;
    while (i < txt.size()) {
        unsigned char c = txt[i];
        if (isalpha(c) || c == '_') { size_t j = i; while (j < txt.size() && (isalnum((unsigned char)txt[j]) || txt[j] == '_')) j++; string id = txt.substr(i, j - i); if (seen.insert(id).second) v.push_back(id); i = j; }
        else i++;
    }
    return v;
}
static vector<string> makeMisses(const vector<string> &keys, mt19937_64 &r) {      // near-miss "typos" guaranteed absent
    unordered_set<string> in(keys.begin(), keys.end()), seen; vector<string> m;
    while (m.size() < keys.size()) {
        string s = keys[r() % keys.size()]; s[r() % s.size()] = ALNUM[r() % 63];
        if (r() % 3 == 0) s += ALNUM[r() % 63];
        if (!in.count(s) && seen.insert(s).second) m.push_back(s);
    }
    return m;
}

/* ============================================================================
   MODE 1: load-factor sweep  (matches the reference project's CSV columns,
   plus failed_inserts and bytes_per_entry)
   ============================================================================ */
static int runSweep(const string &outPath) {
    FILE *csv = fopen(outPath.c_str(), "w");
    if (!csv) { perror("results.csv"); return 1; }
    fprintf(csv, "strategy,load_factor,capacity,n_items,insert_time_ms,avg_insert_probes,max_insert_probes,"
                 "search_hit_time_ms,avg_search_probes_hit,search_miss_time_ms,avg_search_probes_miss,failed_inserts,bytes_per_entry\n");
    const double LFS[] = {0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95};
    const int NLF = sizeof(LFS) / sizeof(LFS[0]); const int REPS = 5; bool allOk = true;

    for (int s = 0; s < STRAT_COUNT; s++) {
        for (int li = 0; li < NLF; li++) {
            double lf = LFS[li];
            double tIns = 0, tHit = 0, tMiss = 0, aIns = 0, aHit = 0, aMiss = 0, mx = 0, fail = 0, bpe = 0; size_t cap = 0, nItems = 0;
            for (int trial = 0; trial < NUM_TRIALS; trial++) {
                TableOptions o; o.capacity = CAPACITY; o.auto_resize = false;            // fixed capacity, like the reference
                auto t = symtab_create((Strategy)s, o);
                cap = t->capacity(); nItems = (size_t)(CAPACITY * lf);          // same n (and keys) for EVERY strategy, even if its real capacity differs (cuckoo)
                mt19937_64 rng(17 * li + 7 * trial + 1);                                  // identical keys for every strategy
                vector<string> keys = uniqueRandom(nItems, rng);
                unordered_set<string> keySet(keys.begin(), keys.end());
                vector<string> misses = uniqueRandom(nItems, rng, &keySet);
                vector<Symbol> syms; syms.reserve(nItems);
                for (size_t i = 0; i < nItems; i++) syms.push_back(Symbol{keys[i], 0, 0, (int)i});

                u64 probes = 0, maxP = 0, failed = 0; vector<size_t> inserted; inserted.reserve(nItems);
                tIns += timeMs([&] {
                    for (size_t i = 0; i < nItems; i++) {
                        int r = t->insert(syms[i]); u64 p = t->stats.lastProbes; probes += p; if (p > maxP) maxP = p;
                        if (r == INSERT_FAILED) failed++; else inserted.push_back(i);
                    }
                });
                aIns += (double)probes / nItems; mx += maxP; fail += failed; bpe += (double)t->memoryBytes() / max<size_t>(t->size(), 1);

                size_t found = 0; t->stats.lookups = t->stats.lookupProbes = 0;
                tHit += timeMs([&] { for (int k = 0; k < REPS; k++) for (size_t i : inserted) found += t->lookup(keys[i]) != nullptr; }) / REPS;
                aHit += (double)t->stats.lookupProbes / t->stats.lookups;
                if (found != inserted.size() * REPS) { allOk = false; fprintf(stderr, "VERIFY FAIL (hit) %s lf=%.2f\n", strategy_names[s], lf); }

                size_t ghost = 0; t->stats.lookups = t->stats.lookupProbes = 0;
                tMiss += timeMs([&] { for (int k = 0; k < REPS; k++) for (auto &m : misses) ghost += t->lookup(m) != nullptr; }) / REPS;
                aMiss += (double)t->stats.lookupProbes / t->stats.lookups;
                if (ghost != 0) { allOk = false; fprintf(stderr, "VERIFY FAIL (miss) %s lf=%.2f\n", strategy_names[s], lf); }
            }
            double N = NUM_TRIALS;
            fprintf(csv, "%s,%.2f,%zu,%zu,%.4f,%.4f,%.0f,%.4f,%.4f,%.4f,%.4f,%.1f,%.1f\n", strategy_names[s], lf, cap, nItems,
                    tIns / N, aIns / N, mx / N, tHit / N, aHit / N, tMiss / N, aMiss / N, fail / N, bpe / N);
            printf("Done: %-26s LF=%.2f  n=%zu\n", strategy_names[s], lf, nItems);
        }
    }
    fclose(csv);
    printf("\nResults written to %s  (%s)\n", outPath.c_str(), allOk ? "all verification checks passed" : "VERIFICATION FAILURES - see stderr");
    return allOk ? 0 : 2;
}

/* ============================================================================
   MODE 2: extended benchmark
   ============================================================================ */
struct Row {
    string table, kind, hash, workload;
    double insNs = 0, hitNs = 0, missNs = 0, delNs = 0, scopeNs = 0, hitPr = 0, missPr = 0, load = 0, bytesPerEntry = 0;
    u64 maxProbe = 0, collisions = 0, resizes = 0, failed = 0; bool ok = true;
};

static double runScoped(SymbolTable &t, const vector<string> &pool, size_t rounds) {
    ScopedSymbolTable st(t); mt19937_64 r(7); u64 ops = 0;
    st.enter_scope();
    size_t globals = min<size_t>(pool.size() / 10 + 1, 2000);
    for (size_t i = 0; i < globals; i++) st.declare(pool[i], 0, (int)i);
    function<void(int)> block = [&](int depth) {
        st.enter_scope();
        size_t k = 5 + r() % 11, m = 10 + r() % 20;
        for (size_t i = 0; i < k; i++) st.declare(pool[r() % pool.size()], 0, (int)i);
        for (size_t i = 0; i < m; i++) st.resolve(pool[r() % pool.size()]);
        if (depth < 4 && r() % 3 == 0) block(depth + 1);
        st.exit_scope(); ops += 2 * k + m;
    };
    double ms = timeMs([&] { for (size_t i = 0; i < rounds; i++) block(1); });
    return ms * 1e6 / (double)max<u64>(ops, 1);
}

static Row runOne(Strategy sp, const HashInfo &hs, const string &wname, const vector<string> &keys, const vector<string> &misses, size_t cap, double ml) {
    Row r; r.table = strategy_names[sp]; r.kind = strategy_kind[sp]; r.hash = hs.name; r.workload = wname;
    size_t N = keys.size(); TableOptions o; o.capacity = cap; o.hash = hs.fn; o.auto_resize = true; o.max_load = ml;
    auto t = symtab_create(sp, o);
    vector<Symbol> syms; syms.reserve(N);
    for (size_t i = 0; i < N; i++) syms.push_back(Symbol{keys[i], 0, 0, (int)i});
    vector<size_t> order(N); iota(order.begin(), order.end(), 0); mt19937_64 rng(99); shuffle(order.begin(), order.end(), rng);

    r.insNs = timeMs([&] { for (size_t i = 0; i < N; i++) t->insert(syms[i]); }) * 1e6 / N;
    r.collisions = t->stats.collisions; r.resizes = t->stats.resizes; r.failed = t->stats.failed;
    r.load = t->load_factor(); r.bytesPerEntry = (double)t->memoryBytes() / max<size_t>(t->size(), 1);

    const int REPS = 3; size_t found = 0;
    t->stats.lookups = t->stats.lookupProbes = 0;
    r.hitNs = timeMs([&] { for (int k = 0; k < REPS; k++) for (size_t i : order) found += t->lookup(keys[i]) != nullptr; }) * 1e6 / (N * REPS);
    r.hitPr = (double)t->stats.lookupProbes / t->stats.lookups; if (found != N * REPS) r.ok = false;

    t->stats.lookups = t->stats.lookupProbes = 0; found = 0;
    r.missNs = timeMs([&] { for (int k = 0; k < REPS; k++) for (auto &m : misses) found += t->lookup(m) != nullptr; }) * 1e6 / (misses.size() * REPS);
    r.missPr = (double)t->stats.lookupProbes / t->stats.lookups; if (found != 0) r.ok = false;
    r.maxProbe = max(t->stats.maxInsertProbes, t->stats.maxLookupProbes);

    size_t del = 0;
    r.delNs = timeMs([&] { for (size_t j = 0; j < N; j += 2) del += t->erase(keys[order[j]]); }) * 1e6 / max<size_t>(N / 2, 1);
    if (del != (N + 1) / 2) r.ok = false;
    for (size_t j = 0; j < N; j++) {                                  // verification: deleted keys gone, others intact
        if ((t->lookup(keys[order[j]]) != nullptr) != (j % 2 == 1)) { r.ok = false; break; }
    }
    auto t2 = symtab_create(sp, o);
    r.scopeNs = runScoped(*t2, keys, max<size_t>(500, N / 20));
    return r;
}

static int runExtended(size_t N, const string &hashArg, const string &file, bool presize, double ml, const string &outPath) {
    vector<HashInfo> hashes;
    for (auto &h : all_hashes()) if (hashArg == "all" || hashArg == h.name) hashes.push_back(h);
    if (hashes.empty()) { fprintf(stderr, "unknown hash '%s'\n", hashArg.c_str()); return 1; }
    FILE *csv = fopen(outPath.c_str(), "w");
    fprintf(csv, "workload,hash,strategy,kind,insert_ns,hit_ns,miss_ns,delete_ns,scope_ns_per_op,hit_probes,miss_probes,max_probe,collisions,resizes,failed,load_factor,bytes_per_entry,ok\n");
    mt19937_64 rng(1);
    vector<pair<string, vector<string>>> workloads;
    workloads.push_back({"random", uniqueRandom(N, rng)});
    workloads.push_back({"sequential", genSequential(N)});
    workloads.push_back({"code-like", genCodeLike(N, rng)});
    if (!file.empty()) { auto ids = loadIdentifiers(file); printf("loaded %zu unique identifiers from %s\n", ids.size(), file.c_str()); if (ids.size() >= 10) workloads.push_back({"file", ids}); }

    bool allOk = true;
    for (auto &hs : hashes) for (auto &w : workloads) {
        auto misses = makeMisses(w.second, rng);
        size_t cap = presize ? (size_t)(w.second.size() / ml) + 1 : 1031;
        printf("\n=== workload=%s hash=%s n=%zu maxLoad=%.2f %s ===\n", w.first.c_str(), hs.name, w.second.size(), ml, presize ? "presized" : "grows from 1031");
        printf("%-26s %-8s %7s %7s %7s %7s %8s %6s %6s %7s %5s %7s %s\n", "Strategy", "Kind", "ins ns", "hit ns", "miss ns", "del ns", "scope ns", "hitPr", "missPr", "maxPr", "rsz", "B/entry", "ok");
        for (int s = 0; s < STRAT_COUNT; s++) {
            Row r = runOne((Strategy)s, hs, w.first, w.second, misses, cap, ml); allOk &= r.ok;
            printf("%-26s %-8s %7.1f %7.1f %7.1f %7.1f %8.1f %6.2f %6.2f %7llu %5llu %7.1f %s\n", r.table.c_str(), r.kind.c_str(), r.insNs, r.hitNs, r.missNs, r.delNs, r.scopeNs,
                   r.hitPr, r.missPr, (unsigned long long)r.maxProbe, (unsigned long long)r.resizes, r.bytesPerEntry, r.ok ? "OK" : "FAIL");
            fprintf(csv, "%s,%s,%s,%s,%.2f,%.2f,%.2f,%.2f,%.2f,%.3f,%.3f,%llu,%llu,%llu,%llu,%.3f,%.1f,%d\n", r.workload.c_str(), r.hash.c_str(), r.table.c_str(), r.kind.c_str(),
                    r.insNs, r.hitNs, r.missNs, r.delNs, r.scopeNs, r.hitPr, r.missPr, (unsigned long long)r.maxProbe, (unsigned long long)r.collisions,
                    (unsigned long long)r.resizes, (unsigned long long)r.failed, r.load, r.bytesPerEntry, r.ok ? 1 : 0);
        }
    }
    fclose(csv);
    printf("\n%s\nResults written to %s\n", allOk ? "All correctness checks passed." : "WARNING: some correctness checks FAILED.", outPath.c_str());
    return allOk ? 0 : 2;
}

int main(int argc, char **argv) {
    bool extended = false, presize = false; size_t N = 100000; string hashArg = "all", file, out; double ml = 0.7;
    for (int i = 1; i < argc; i++) {
        string a = argv[i];
        auto nxt = [&]() -> string { if (i + 1 >= argc) { fprintf(stderr, "missing value for %s\n", a.c_str()); exit(1); } return argv[++i]; };
        if (a == "--extended") extended = true; else if (a == "--n") N = stoull(nxt()); else if (a == "--hash") hashArg = nxt();
        else if (a == "--file") file = nxt(); else if (a == "--maxload") ml = stod(nxt()); else if (a == "--presize") presize = true; else if (a == "--out") out = nxt();
        else { printf("usage: %s [--extended] [--n N] [--hash all|djb2|fnv1a|sdbm|pjw|sum] [--file src] [--maxload 0.7] [--presize] [--out file.csv]\n", argv[0]); return 0; }
    }
    if (extended) return runExtended(N, hashArg, file, presize, ml, out.empty() ? "results_extended.csv" : out);
    return runSweep(out.empty() ? "results.csv" : out);
}
