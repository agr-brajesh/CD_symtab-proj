// =============================================================================
//  experiments.cpp  -  additional experiments for the revised manuscript
//
//  Sub-commands (all write CSV files; every row is ONE trial / repetition, no averaging is done here):
//    sweep   Experiment A, per-trial rows (fixed capacity 10,007, 12 load factors, N trials, chosen hash)
//    dist    per-key probe-length distribution at a fixed load factor (linear probing vs Robin Hood ...)
//    hybrid  stress tests that make H1/H2/H3 use their special mechanisms (weak hash, multi-collision keys)
//    scopes  scope designs compared: name@depth keys (original) vs shadow chains (conventional)
//    extb    Experiment B (resize workloads x hashes x strategies), repeated; synthetic + real corpora
//    trace   replay of identifier streams captured from real C source code (flat and block-scoped)
//
//  Build: g++ -O2 -std=c++17 -Wall -Wextra -o experiments symtab.cpp experiments.cpp
// =============================================================================
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <functional>
#include <malloc.h>
#include <map>
#include <numeric>
#include <random>
#include <set>
#include <sstream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "symtab.h"
using namespace std;

static const size_t CAPACITY = 10007;
static const char ALNUM[] = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";

template <class F> static double timeMs(F f) {
    auto a = chrono::steady_clock::now(); f(); auto b = chrono::steady_clock::now();
    return chrono::duration<double, milli>(b - a).count();
}
static size_t heapBytes() { struct mallinfo2 m = mallinfo2(); return m.uordblks + m.hblkhd; }
static HashFn hashByName(const string &n) { for (auto &h : all_hashes()) if (n == h.name) return h.fn; fprintf(stderr, "unknown hash %s\n", n.c_str()); exit(1); }

/* ---------------- key generators (identical to benchmark.cpp) ---------------- */
static string genIdent(mt19937_64 &r, size_t minLen = 3, size_t maxLen = 15) {
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
static vector<string> makeMisses(const vector<string> &keys, mt19937_64 &r) {
    unordered_set<string> in(keys.begin(), keys.end()), seen; vector<string> m;
    while (m.size() < keys.size()) {
        string s = keys[r() % keys.size()]; s[r() % s.size()] = ALNUM[r() % 63];
        if (r() % 3 == 0) s += ALNUM[r() % 63];
        if (!in.count(s) && seen.insert(s).second) m.push_back(s);
    }
    return m;
}
/* multi-collision keys for djb2: blocks "ab" and "bA" have the same djb2 contribution (97*33+98 == 98*33+65),
   so ANY concatenation of k blocks gives the same 64-bit djb2 value -> 2^k keys with one hash value. */
static vector<string> adversarialDjb2(size_t k) {
    vector<string> v; for (size_t m = 0; m < ((size_t)1 << k); m++) { string s; for (size_t b = 0; b < k; b++) s += ((m >> b) & 1) ? "bA" : "ab"; v.push_back(s); }
    return v;
}
static string argOf(int argc, char **argv, const char *name, const char *def) {
    for (int i = 2; i + 1 < argc; i++) if (!strcmp(argv[i], name)) return argv[i + 1];
    return def;
}

/* ============================ sweep: Experiment A, per trial ============================ */
static int cmdSweep(int argc, char **argv) {
    string hashName = argOf(argc, argv, "--hash", "djb2"), out = argOf(argc, argv, "--out", "exp_a_trials.csv");
    int trials = stoi(argOf(argc, argv, "--trials", "30")); HashFn hf = hashByName(hashName);
    FILE *csv = fopen(out.c_str(), "w"); if (!csv) { perror(out.c_str()); return 1; }
    fprintf(csv, "hash,strategy,load_factor,trial,n_items,insert_ms,avg_insert_probes,max_insert_probes,hit_ms,hit_probes,miss_ms,miss_probes,"
                 "failed,model_bytes_per_entry,heap_bytes_per_entry,max_lookup_probes,collisions,treeifications,overflow_inserts,overflow_lookups,stash_inserts,stash_lookups,ok\n");
    const double LFS[] = {0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95}; const int REPS = 5; bool allOk = true;
    for (int s = 0; s < STRAT_COUNT; s++) for (int li = 0; li < 12; li++) for (int tr = 0; tr < trials; tr++) {
        double lf = LFS[li]; size_t n = (size_t)(CAPACITY * lf);
        mt19937_64 rng(1000003ULL * (li + 1) + tr + 1);                 // identical keys for every strategy (seed depends on LF and trial only)
        vector<string> keys = uniqueRandom(n, rng); unordered_set<string> ks(keys.begin(), keys.end());
        vector<string> misses = uniqueRandom(n, rng, &ks);
        vector<Symbol> syms; syms.reserve(n); for (size_t i = 0; i < n; i++) syms.push_back(Symbol{keys[i], 0, 0, (int)i});
        TableOptions o; o.capacity = CAPACITY; o.hash = hf; o.auto_resize = false;
        vector<size_t> ins; ins.reserve(n);                              // allocated BEFORE the heap snapshot so it is not charged to the table
        size_t h0 = heapBytes(); auto t = symtab_create((Strategy)s, o);
        u64 probes = 0, maxP = 0, failed = 0;
        double tIns = timeMs([&] { for (size_t i = 0; i < n; i++) { int r = t->insert(syms[i]); u64 p = t->stats.lastProbes; probes += p; maxP = max(maxP, p); if (r == INSERT_FAILED) failed++; else ins.push_back(i); } });
        size_t h1 = heapBytes(); size_t sz = max<size_t>(t->size(), 1);
        Stats afterIns = t->stats; bool ok = true;
        size_t found = 0; t->stats.lookups = t->stats.lookupProbes = 0;
        double tHit = timeMs([&] { for (int k = 0; k < REPS; k++) for (size_t i : ins) found += t->lookup(keys[i]) != nullptr; }) / REPS;
        double hitP = (double)t->stats.lookupProbes / t->stats.lookups; if (found != ins.size() * REPS) ok = false;
        size_t ghost = 0; t->stats.lookups = t->stats.lookupProbes = 0;
        double tMiss = timeMs([&] { for (int k = 0; k < REPS; k++) for (auto &m : misses) ghost += t->lookup(m) != nullptr; }) / REPS;
        double missP = (double)t->stats.lookupProbes / t->stats.lookups; if (ghost) ok = false;
        allOk &= ok;
        fprintf(csv, "%s,%s,%.2f,%d,%zu,%.4f,%.4f,%llu,%.4f,%.4f,%.4f,%.4f,%llu,%.2f,%.2f,%llu,%llu,%llu,%llu,%llu,%llu,%llu,%d\n", hashName.c_str(), strategy_names[s], lf, tr, n,
                tIns, (double)probes / n, (unsigned long long)maxP, tHit, hitP, tMiss, missP, (unsigned long long)failed, (double)t->memoryBytes() / sz, (double)(h1 - h0) / sz,
                (unsigned long long)t->stats.maxLookupProbes, (unsigned long long)afterIns.collisions, (unsigned long long)afterIns.treeifications, (unsigned long long)afterIns.overflowInserts,
                (unsigned long long)t->stats.overflowLookups, (unsigned long long)afterIns.stashInserts, (unsigned long long)t->stats.stashLookups, ok ? 1 : 0);
    }
    fclose(csv); printf("sweep %s: %s\n", hashName.c_str(), allOk ? "all verification checks passed" : "VERIFICATION FAILURES");
    return allOk ? 0 : 2;
}

/* ============================ dist: probe-length distributions ============================ */
static int cmdDist(int argc, char **argv) {
    string out = argOf(argc, argv, "--out", "exp_dist.csv"); int trials = stoi(argOf(argc, argv, "--trials", "30"));
    FILE *csv = fopen(out.c_str(), "w"); fprintf(csv, "hash,strategy,load_factor,kind,probes,count\n");
    for (string hn : {"djb2", "fnv1a"}) for (double lf : {0.5, 0.9}) for (int s : {STRAT_LINEAR_PROBING, STRAT_ROBIN_HOOD, STRAT_DOUBLE_HASHING, STRAT_CHAINING}) {
        map<pair<string, u64>, u64> hist;
        for (int tr = 0; tr < trials; tr++) {
            size_t n = (size_t)(CAPACITY * lf); mt19937_64 rng(777 + tr);
            auto keys = uniqueRandom(n, rng); unordered_set<string> ks(keys.begin(), keys.end()); auto misses = uniqueRandom(n, rng, &ks);
            TableOptions o; o.capacity = CAPACITY; o.hash = hashByName(hn); o.auto_resize = false; auto t = symtab_create((Strategy)s, o);
            for (size_t i = 0; i < n; i++) t->insert(Symbol{keys[i], 0, 0, (int)i});
            for (auto &k : keys) { t->lookup(k); hist[{"hit", t->stats.lastProbes}]++; }
            for (auto &m : misses) { t->lookup(m); hist[{"miss", t->stats.lastProbes}]++; }
        }
        for (auto &kv : hist) fprintf(csv, "%s,%s,%.2f,%s,%llu,%llu\n", hn.c_str(), strategy_names[s], lf, kv.first.first.c_str(), (unsigned long long)kv.first.second, (unsigned long long)kv.second);
    }
    fclose(csv); return 0;
}

/* ============================ hybrid: make the special mechanisms fire ============================ */
struct Scn { string name; string hash; vector<string> keys; vector<string> misses; };
static int cmdHybrid(int argc, char **argv) {
    string out = argOf(argc, argv, "--out", "exp_hybrid.csv");
    FILE *csv = fopen(out.c_str(), "w");
    fprintf(csv, "scenario,hash,n_keys,strategy,failed,avg_insert_probes,max_insert_probes,hit_probes,miss_probes,max_lookup_probes,collisions,treeifications,overflow_inserts,overflow_lookups,stash_inserts,stash_lookups,table_size_after\n");
    vector<Scn> sc; mt19937_64 rng(4242);
    { Scn s{"random-djb2-a0.9", "djb2", uniqueRandom(9006, rng), {}}; sc.push_back(s); }
    { Scn s{"random-fnv1a-a0.9", "fnv1a", uniqueRandom(9006, rng), {}}; sc.push_back(s); }
    { Scn s{"random-sum-a0.9", "sum", uniqueRandom(9006, rng), {}}; sc.push_back(s); }
    { Scn s{"random-sum-a0.5", "sum", uniqueRandom(5003, rng), {}}; sc.push_back(s); }
    { Scn s{"collide-djb2-256", "djb2", adversarialDjb2(8), {}}; sc.push_back(s); }
    { Scn s{"collide-djb2-4096", "djb2", adversarialDjb2(12), {}}; sc.push_back(s); }
    for (auto &s : sc) {
        unordered_set<string> ks(s.keys.begin(), s.keys.end()); s.misses = uniqueRandom(min<size_t>(s.keys.size(), 4000), rng, &ks);
        for (int st = 0; st < STRAT_COUNT; st++) {
            TableOptions o; o.capacity = CAPACITY; o.hash = hashByName(s.hash); o.auto_resize = false; auto t = symtab_create((Strategy)st, o);
            u64 pr = 0, mx = 0, fl = 0;
            for (size_t i = 0; i < s.keys.size(); i++) { int r = t->insert(Symbol{s.keys[i], 0, 0, (int)i}); u64 p = t->stats.lastProbes; pr += p; mx = max(mx, p); if (r == INSERT_FAILED) fl++; }
            Stats a = t->stats; t->stats.lookups = t->stats.lookupProbes = 0; t->stats.overflowLookups = t->stats.stashLookups = 0;
            for (auto &k : s.keys) t->lookup(k);
            double hit = (double)t->stats.lookupProbes / t->stats.lookups; t->stats.lookups = t->stats.lookupProbes = 0;
            for (auto &m : s.misses) t->lookup(m);
            double miss = (double)t->stats.lookupProbes / t->stats.lookups;
            fprintf(csv, "%s,%s,%zu,%s,%llu,%.3f,%llu,%.3f,%.3f,%llu,%llu,%llu,%llu,%llu,%llu,%llu,%zu\n", s.name.c_str(), s.hash.c_str(), s.keys.size(), strategy_names[st], (unsigned long long)fl,
                    (double)pr / s.keys.size(), (unsigned long long)mx, hit, miss, (unsigned long long)t->stats.maxLookupProbes, (unsigned long long)a.collisions, (unsigned long long)a.treeifications,
                    (unsigned long long)a.overflowInserts, (unsigned long long)t->stats.overflowLookups, (unsigned long long)a.stashInserts, (unsigned long long)t->stats.stashLookups, t->size());
        }
    }
    fclose(csv); return 0;
}

/* ============================ scopes: two scope designs ============================ */
struct SEv { int type; int name; int id; };          // 0 enter, 1 exit, 2 declare, 3 resolve
static vector<SEv> genScopeProgram(int maxDepth, size_t blocks, size_t poolSize, uint64_t seed) {
    mt19937_64 r(seed); vector<SEv> ev; vector<vector<int>> vis; int nextId = 1;   // vis[d] = names declared at depth d (for 80 % hit rate)
    function<void(int)> block = [&](int depth) {
        ev.push_back({0, 0, 0}); vis.emplace_back();
        size_t k = 3 + r() % 8, m = 10 + r() % 20;
        for (size_t i = 0; i < k; i++) { int nm = (int)(r() % poolSize); vis.back().push_back(nm); ev.push_back({2, nm, nextId++}); }
        for (size_t i = 0; i < m; i++) {
            int nm;
            if (r() % 10 < 8) { size_t d = r() % vis.size(); while (vis[d].empty() && d > 0) d--; nm = vis[d].empty() ? (int)(r() % poolSize) : vis[d][r() % vis[d].size()]; }
            else nm = (int)(poolSize + r() % poolSize);                              // never declared -> unsuccessful resolve
            ev.push_back({3, nm, 0});
            if (depth < maxDepth && i == m / 2) block(depth + 1);          // nested block chain: every top-level block descends to maxDepth
        }
        ev.push_back({1, 0, 0}); vis.pop_back();
    };
    for (size_t b = 0; b < blocks; b++) { ev.push_back({0, 0, 0}); vis.emplace_back();       // one global scope that stays open
        for (size_t i = 0; i < 40; i++) { int nm = (int)(r() % poolSize); vis.back().push_back(nm); ev.push_back({2, nm, nextId++}); }
        block(1); ev.push_back({1, 0, 0}); vis.pop_back(); }
    return ev;
}
template <class ST> static double replayScoped(SymbolTable &t, const vector<SEv> &ev, const vector<string> &names, u64 &ops, u64 &resolves, vector<int> *res, u64 *rLook = nullptr, u64 *rProbe = nullptr) {
    ST st(t); ops = resolves = 0; if (res) res->clear();
    auto body = [&] {
        for (auto &e : ev) switch (e.type) {
            case 0: st.enter_scope(); break;
            case 1: st.exit_scope(); break;
            case 2: st.declare(names[e.name], e.id, 0); ops++; break;
            default: {
                u64 l0 = t.stats.lookups, p0 = t.stats.lookupProbes;
                const Symbol *s = st.resolve(names[e.name]); resolves++; ops++;
                if (rLook) { *rLook += t.stats.lookups - l0; *rProbe += t.stats.lookupProbes - p0; }
                if (res) res->push_back(s ? s->type * 100 + s->scope : -1);
            }
        }
    };
    return timeMs(body);
}
static int cmdScopes(int argc, char **argv) {
    string out = argOf(argc, argv, "--out", "exp_scopes.csv"); int reps = stoi(argOf(argc, argv, "--reps", "15"));
    FILE *csv = fopen(out.c_str(), "w");
    fprintf(csv, "hash,strategy,design,max_depth,rep,scope_ops,resolves,ns_per_scope_op,table_lookups_per_resolve,table_probes_per_resolve,ok\n");
    mt19937_64 nr(5); size_t pool = 600; vector<string> names = uniqueRandom(2 * pool, nr); bool allOk = true;
    for (int D : {1, 2, 4, 8, 16}) {
        auto ev = genScopeProgram(D, 150, pool, 31 + D);
        // reference model: vector of maps, names resolved inner -> outer
        vector<int> ref; { vector<unordered_map<int, int>> sc; for (auto &e : ev) { if (e.type == 0) sc.emplace_back(); else if (e.type == 1) sc.pop_back(); else if (e.type == 2) sc.back()[e.name] = e.id;
            else { int r = -1; for (int d = (int)sc.size() - 1; d >= 0; d--) { auto it = sc[d].find(e.name); if (it != sc[d].end()) { r = it->second * 100 + d; break; } } ref.push_back(r); } } }
        for (int st = 0; st < STRAT_COUNT; st++) for (int design = 0; design < 2; design++) {
            TableOptions o; o.capacity = 1031; o.hash = hash_djb2; o.auto_resize = true; o.max_load = 0.7;
            u64 ops, rs, rl = 0, rp = 0; vector<int> res; bool ok = true;       // counting + correctness pass (untimed): results must equal the reference model
            { auto t = symtab_create((Strategy)st, o);
              if (design == 0) replayScoped<ScopedSymbolTable>(*t, ev, names, ops, rs, &res, &rl, &rp); else replayScoped<ShadowScopedSymbolTable>(*t, ev, names, ops, rs, &res, &rl, &rp);
              ok = (res == ref); allOk &= ok; }
            for (int rep = 0; rep < reps; rep++) {
                auto t = symtab_create((Strategy)st, o);
                double ms = design == 0 ? replayScoped<ScopedSymbolTable>(*t, ev, names, ops, rs, nullptr) : replayScoped<ShadowScopedSymbolTable>(*t, ev, names, ops, rs, nullptr);
                fprintf(csv, "djb2,%s,%s,%d,%d,%llu,%llu,%.2f,%.3f,%.3f,%d\n", strategy_names[st], design == 0 ? "name@depth" : "shadow-chain", D, rep, (unsigned long long)ops, (unsigned long long)rs,
                        ms * 1e6 / ops, (double)rl / rs, (double)rp / rs, ok ? 1 : 0);
            }
        }
    }
    fclose(csv); printf("scopes: %s\n", allOk ? "both designs agree with the reference model" : "MISMATCH"); return allOk ? 0 : 2;
}

/* ============================ real source code: lexing ============================ */
static const set<string> KW = {"auto","break","case","char","const","continue","default","do","double","else","enum","extern","float","for","goto","if","inline","int","long","register",
    "restrict","return","short","signed","sizeof","static","struct","switch","typedef","union","unsigned","void","volatile","while","_Bool","_Complex"};
static const set<string> TYPEKW = {"char","const","double","enum","float","int","long","short","signed","struct","union","unsigned","void","volatile","_Bool","register","static","extern","auto"};
static string readFile(const string &p) { ifstream in(p, ios::binary); return string((istreambuf_iterator<char>(in)), istreambuf_iterator<char>()); }
// token stream of identifiers (keywords removed) in source order
static vector<string> identifierStream(const string &t) {
    vector<string> v; size_t i = 0, n = t.size(); bool bol = true;
    while (i < n) {
        char c = t[i];
        if (c == '\n') { bol = true; i++; continue; }
        if (c == ' ' || c == '\t' || c == '\r') { i++; continue; }
        if (c == '/' && i + 1 < n && t[i + 1] == '/') { while (i < n && t[i] != '\n') i++; continue; }
        if (c == '/' && i + 1 < n && t[i + 1] == '*') { i += 2; while (i + 1 < n && !(t[i] == '*' && t[i + 1] == '/')) i++; i += 2; continue; }
        if (c == '"' || c == '\'') { char q = c; i++; while (i < n && t[i] != q) { if (t[i] == '\\') i++; i++; } i++; bol = false; continue; }
        if (c == '#' && bol) { while (i < n && t[i] != '\n') { if (t[i] == '\\' && i + 1 < n) i++; i++; } continue; }   // directives skipped
        bol = false;
        if (isalpha((unsigned char)c) || c == '_') { size_t j = i; while (j < n && (isalnum((unsigned char)t[j]) || t[j] == '_')) j++; string id = t.substr(i, j - i); if (!KW.count(id)) v.push_back(id); i = j; continue; }
        if (isdigit((unsigned char)c)) { while (i < n && (isalnum((unsigned char)t[i]) || t[i] == '.')) i++; continue; }
        i++;
    }
    return v;
}
// block-scoped events with a lightweight declaration heuristic (no full parse). type: 0 enter,1 exit,2 declare,3 use
struct REv { int type; string name; };
static vector<REv> scopeEvents(const string &t) {
    vector<REv> ev; vector<string> pend; size_t i = 0, n = t.size(); bool bol = true; int paren = 0;
    vector<string> tok;   // previous significant tokens (identifiers, keywords, punctuation as 1-char strings)
    auto prev = [&](size_t k) -> string { return tok.size() >= k ? tok[tok.size() - k] : string(); };
    auto push = [&](const string &s) { tok.push_back(s); if (tok.size() > 6) tok.erase(tok.begin()); };
    while (i < n) {
        char c = t[i];
        if (c == '\n') { bol = true; i++; continue; }
        if (c == ' ' || c == '\t' || c == '\r') { i++; continue; }
        if (c == '/' && i + 1 < n && t[i + 1] == '/') { while (i < n && t[i] != '\n') i++; continue; }
        if (c == '/' && i + 1 < n && t[i + 1] == '*') { i += 2; while (i + 1 < n && !(t[i] == '*' && t[i + 1] == '/')) i++; i += 2; continue; }
        if (c == '"' || c == '\'') { char q = c; i++; while (i < n && t[i] != q) { if (t[i] == '\\') i++; i++; } i++; bol = false; push("lit"); continue; }
        if (c == '#' && bol) {
            size_t j = i + 1; while (j < n && (t[j] == ' ' || t[j] == '\t')) j++; size_t k = j; while (k < n && isalpha((unsigned char)t[k])) k++;
            string dir = t.substr(j, k - j);
            if (dir == "define") { while (k < n && (t[k] == ' ' || t[k] == '\t')) k++; size_t m = k; while (m < n && (isalnum((unsigned char)t[m]) || t[m] == '_')) m++; if (m > k) ev.push_back({2, t.substr(k, m - k)}); }
            while (i < n && t[i] != '\n') { if (t[i] == '\\' && i + 1 < n) i++; i++; } continue;
        }
        bol = false;
        if (isalpha((unsigned char)c) || c == '_') {
            size_t j = i; while (j < n && (isalnum((unsigned char)t[j]) || t[j] == '_')) j++; string id = t.substr(i, j - i); i = j;
            if (KW.count(id)) { push(id); continue; }
            // look ahead for the next non-space char
            size_t q = i; while (q < n && (t[q] == ' ' || t[q] == '\t' || t[q] == '\n' || t[q] == '\r')) q++; char nx = q < n ? t[q] : 0;
            string p1 = prev(1), p2 = prev(2);
            bool typeish = TYPEKW.count(p1) || (!p1.empty() && (isalpha((unsigned char)p1[0]) || p1[0] == '_') && !KW.count(p1) && p1 != "lit");
            bool starDecl = p1 == "*" && (TYPEKW.count(p2) || (!p2.empty() && (isalpha((unsigned char)p2[0]) || p2[0] == '_') && !KW.count(p2) && p2 != "lit" &&
                                          (prev(3).empty() || prev(3) == ";" || prev(3) == "{" || prev(3) == "}" || prev(3) == "(" || prev(3) == "," || TYPEKW.count(prev(3)))));
            bool nextOk = nx == ';' || nx == '=' || nx == ',' || nx == ')' || nx == '[' || nx == '(';
            if ((typeish || starDecl) && nextOk) {
                if (paren > 0) pend.push_back(id);            // parameter: belongs to the function body scope
                else ev.push_back({2, id});
            } else ev.push_back({3, id});
            push(id); continue;
        }
        if (isdigit((unsigned char)c)) { while (i < n && (isalnum((unsigned char)t[i]) || t[i] == '.')) i++; push("num"); continue; }
        if (c == '(') paren++; else if (c == ')' && paren > 0) paren--;
        if (c == '{') { ev.push_back({0, ""}); for (auto &p : pend) ev.push_back({2, p}); pend.clear(); }
        else if (c == '}') ev.push_back({1, ""});
        else if (c == ';') pend.clear();
        push(string(1, c)); i++;
    }
    // repair unbalanced braces (macros etc.): never exit more scopes than were entered, close leftovers
    vector<REv> fixed; int d = 0; for (auto &e : ev) { if (e.type == 0) d++; if (e.type == 1) { if (d == 0) continue; d--; } fixed.push_back(e); }
    while (d-- > 0) fixed.push_back({1, ""});
    return fixed;
}
static vector<string> listFiles(const string &cmd) { vector<string> v; FILE *p = popen(cmd.c_str(), "r"); char buf[4096]; while (fgets(buf, sizeof buf, p)) { string s = buf; while (!s.empty() && (s.back() == '\n')) s.pop_back(); v.push_back(s); } pclose(p); return v; }

/* ============================ extb: Experiment B ============================ */
struct Wl { string name; vector<string> keys; };
static vector<Wl> corpusWorkloads(const string &dir) {
    vector<Wl> w; struct C { string name, cmd; };
    vector<C> cs = {{"lua", "ls " + dir + "/lua/*.c"}, {"zlib", "ls " + dir + "/zlib/*.c"}, {"redis", "ls " + dir + "/redis/src/*.c"}, {"sqlite", "ls " + dir + "/sqlite/src/*.c"}};
    for (auto &c : cs) { auto files = listFiles(c.cmd + " 2>/dev/null"); if (files.empty()) continue; unordered_set<string> seen; vector<string> u;
        for (auto &f : files) for (auto &id : identifierStream(readFile(f))) if (seen.insert(id).second) u.push_back(id);
        if (u.size() >= 100) w.push_back({c.name + "-ids", u}); }
    return w;
}
static double runScopedA(SymbolTable &t, const vector<string> &pool, size_t rounds, u64 &opsOut) {      // as in benchmark.cpp
    ScopedSymbolTable st(t); mt19937_64 r(7); u64 ops = 0; st.enter_scope();
    size_t globals = min<size_t>(pool.size() / 10 + 1, 2000); for (size_t i = 0; i < globals; i++) st.declare(pool[i], 0, (int)i);
    function<void(int)> block = [&](int depth) {
        st.enter_scope(); size_t k = 5 + r() % 11, m = 10 + r() % 20;
        for (size_t i = 0; i < k; i++) st.declare(pool[r() % pool.size()], 0, (int)i);
        for (size_t i = 0; i < m; i++) st.resolve(pool[r() % pool.size()]);
        if (depth < 4 && r() % 3 == 0) block(depth + 1);
        st.exit_scope(); ops += 2 * k + m;
    };
    double ms = timeMs([&] { for (size_t i = 0; i < rounds; i++) block(1); }); opsOut = ops;
    return ms * 1e6 / (double)max<u64>(ops, 1);
}
static int cmdExtB(int argc, char **argv) {
    string out = argOf(argc, argv, "--out", "exp_b_reps.csv"), corp = argOf(argc, argv, "--corpora", "corpora"); size_t N = stoull(argOf(argc, argv, "--n", "30000"));
    int reps = stoi(argOf(argc, argv, "--reps", "5")), repsSum = stoi(argOf(argc, argv, "--reps-sum", "3")); size_t nSum = stoull(argOf(argc, argv, "--n-sum", "30000"));
    FILE *csv = fopen(out.c_str(), "w");
    fprintf(csv, "workload,hash,strategy,rep,n_keys,insert_ns,hit_ns,miss_ns,delete_ns,scope_ns_per_op,hit_probes,miss_probes,insert_probes,max_insert_probe,max_lookup_probe,collisions,resizes,failed,load_factor,model_bytes_per_entry,heap_bytes_per_entry,treeifications,overflow_inserts,stash_inserts,ok\n");
    mt19937_64 rng(1); vector<Wl> wls; wls.push_back({"random", uniqueRandom(N, rng)}); wls.push_back({"sequential", genSequential(N)}); wls.push_back({"code-like", genCodeLike(N, rng)});
    for (auto &c : corpusWorkloads(corp)) { printf("corpus %s: %zu unique identifiers\n", c.name.c_str(), c.keys.size()); wls.push_back(c); }
    bool allOk = true;
    for (auto &h : all_hashes()) for (auto &w : wls) {
        bool isSum = string(h.name) == "sum"; vector<string> keys = w.keys; if (isSum && keys.size() > nSum) keys.resize(nSum);
        mt19937_64 mr(99); auto misses = makeMisses(keys, mr); size_t Nn = keys.size(); int R = isSum ? repsSum : reps;
        for (int s = 0; s < STRAT_COUNT; s++) for (int rep = 0; rep < R; rep++) {
            TableOptions o; o.capacity = 1031; o.hash = h.fn; o.auto_resize = true; o.max_load = 0.7;
            vector<Symbol> syms; syms.reserve(Nn); for (size_t i = 0; i < Nn; i++) syms.push_back(Symbol{keys[i], 0, 0, (int)i});
            vector<size_t> order(Nn); iota(order.begin(), order.end(), 0); mt19937_64 sr(99 + rep); shuffle(order.begin(), order.end(), sr);
            size_t h0 = heapBytes(); auto t = symtab_create((Strategy)s, o); bool ok = true;
            double insNs = timeMs([&] { for (size_t i = 0; i < Nn; i++) t->insert(syms[i]); }) * 1e6 / Nn;
            size_t h1 = heapBytes(); Stats a = t->stats; double load = t->load_factor(); double bpe = (double)t->memoryBytes() / max<size_t>(t->size(), 1), hbpe = (double)(h1 - h0) / max<size_t>(t->size(), 1);
            double insPr = (double)a.insertProbes / max<u64>(a.inserts, 1); const int RP = 3; size_t found = 0;
            t->stats.lookups = t->stats.lookupProbes = 0;
            double hitNs = timeMs([&] { for (int k = 0; k < RP; k++) for (size_t i : order) found += t->lookup(keys[i]) != nullptr; }) * 1e6 / (Nn * RP);
            double hitPr = (double)t->stats.lookupProbes / t->stats.lookups; if (found != Nn * (size_t)RP) ok = false;
            t->stats.lookups = t->stats.lookupProbes = 0; found = 0;
            double missNs = timeMs([&] { for (int k = 0; k < RP; k++) for (auto &m : misses) found += t->lookup(m) != nullptr; }) * 1e6 / (misses.size() * RP);
            double missPr = (double)t->stats.lookupProbes / t->stats.lookups; if (found) ok = false;
            u64 mxL = t->stats.maxLookupProbes; size_t del = 0;
            double delNs = timeMs([&] { for (size_t j = 0; j < Nn; j += 2) del += t->erase(keys[order[j]]); }) * 1e6 / max<size_t>(Nn / 2, 1); if (del != (Nn + 1) / 2) ok = false;
            for (size_t j = 0; j < Nn && ok; j++) if ((t->lookup(keys[order[j]]) != nullptr) != (j % 2 == 1)) ok = false;
            auto t2 = symtab_create((Strategy)s, o); u64 sops; double scNs = runScopedA(*t2, keys, max<size_t>(500, Nn / 20), sops); allOk &= ok;
            fprintf(csv, "%s,%s,%s,%d,%zu,%.2f,%.2f,%.2f,%.2f,%.2f,%.3f,%.3f,%.3f,%llu,%llu,%llu,%llu,%llu,%.3f,%.1f,%.1f,%llu,%llu,%llu,%d\n", w.name.c_str(), h.name, strategy_names[s], rep, Nn, insNs, hitNs, missNs, delNs, scNs,
                    hitPr, missPr, insPr, (unsigned long long)a.maxInsertProbes, (unsigned long long)mxL, (unsigned long long)a.collisions, (unsigned long long)a.resizes, (unsigned long long)a.failed, load, bpe, hbpe,
                    (unsigned long long)a.treeifications, (unsigned long long)a.overflowInserts, (unsigned long long)a.stashInserts, ok ? 1 : 0);
        }
        fflush(csv); printf("done %s / %s (n=%zu)\n", w.name.c_str(), h.name, Nn); fflush(stdout);
    }
    fclose(csv); printf("%s\n", allOk ? "All correctness checks passed." : "CHECK FAILURES"); return allOk ? 0 : 2;
}

/* ============================ trace: replay of real source code ============================ */
static int cmdTrace(int argc, char **argv) {
    string out = argOf(argc, argv, "--out", "exp_trace.csv"), corp = argOf(argc, argv, "--corpora", "corpora"), stat = argOf(argc, argv, "--stats", "exp_trace_corpora.csv");
    int reps = stoi(argOf(argc, argv, "--reps", "5"));
    struct C { string name, cmd; }; vector<C> cs = {{"lua", "ls " + corp + "/lua/*.c"}, {"zlib", "ls " + corp + "/zlib/*.c"}, {"redis", "ls " + corp + "/redis/src/*.c"}, {"sqlite", "ls " + corp + "/sqlite/src/*.c"}};
    FILE *csv = fopen(out.c_str(), "w"), *cst = fopen(stat.c_str(), "w");
    fprintf(csv, "corpus,hash,strategy,mode,design,rep,files,accesses,unique_per_file_sum,hit_ratio,ns_per_access,probes_per_access,lookups_per_access,resizes,ok\n");
    fprintf(cst, "corpus,files,source_lines,identifier_tokens,unique_identifiers_global,mean_unique_per_file,max_unique_per_file,scope_events,decl_events,use_events,max_brace_depth,mean_use_hit_ratio_ref\n");
    bool allOk = true;
    for (auto &c : cs) {
        auto files = listFiles(c.cmd + " 2>/dev/null"); if (files.empty()) continue;
        vector<vector<string>> streams; vector<vector<REv>> evs; size_t lines = 0, toks = 0; unordered_set<string> glob; size_t maxU = 0, sumU = 0, scEv = 0, dEv = 0, uEv = 0; int maxD = 0;
        double hitRefSum = 0; size_t hitRefN = 0;
        for (auto &f : files) {
            string txt = readFile(f); lines += count(txt.begin(), txt.end(), '\n'); auto st = identifierStream(txt); toks += st.size();
            unordered_set<string> u(st.begin(), st.end()); for (auto &s : u) glob.insert(s); maxU = max(maxU, u.size()); sumU += u.size(); streams.push_back(move(st));
            auto ev = scopeEvents(txt); int d = 0; vector<unordered_set<string>> sc; size_t hits = 0, uses = 0;
            for (auto &e : ev) { if (e.type == 0) { scEv++; d++; maxD = max(maxD, d); sc.emplace_back(); } else if (e.type == 1) { d--; sc.pop_back(); } else if (e.type == 2) { dEv++; if (sc.empty()) sc.emplace_back(); sc.back().insert(e.name); }
                else { uEv++; uses++; for (auto &s : sc) if (s.count(e.name)) { hits++; break; } } }
            hitRefSum += uses ? (double)hits / uses : 0; hitRefN++; evs.push_back(move(ev));
        }
        fprintf(cst, "%s,%zu,%zu,%zu,%zu,%.1f,%zu,%zu,%zu,%zu,%d,%.3f\n", c.name.c_str(), files.size(), lines, toks, glob.size(), (double)sumU / files.size(), maxU, scEv, dEv, uEv, maxD, hitRefSum / hitRefN);
        for (string hn : {"djb2", "fnv1a"}) for (int s = 0; s < STRAT_COUNT; s++) for (int rep = 0; rep < reps; rep++) {
            TableOptions o; o.capacity = 211; o.hash = hashByName(hn); o.auto_resize = true; o.max_load = 0.7;
            // ---- flat replay: every identifier token is looked up; on a miss it is inserted (one table per source file) ----
            u64 acc = 0, hits = 0, probes = 0, lookups = 0, rs = 0, uniq = 0; double ms = 0; bool ok = true;
            for (auto &st : streams) { auto t = symtab_create((Strategy)s, o); unordered_set<string> ref; size_t good = 0;
                ms += timeMs([&] { for (auto &id : st) { const Symbol *p = t->lookup(id); acc++; if (p) hits++; else t->insert(Symbol{id, 0, 0, 0}); } });
                probes += t->stats.lookupProbes + t->stats.insertProbes; lookups += t->stats.lookups; rs += t->stats.resizes; uniq += t->size();
                if (rep == 0) { for (auto &id : st) ref.insert(id); good = ref.size() == t->size(); ok &= good; } }
            allOk &= ok;
            fprintf(csv, "%s,%s,%s,flat,single-table,%d,%zu,%llu,%llu,%.4f,%.2f,%.4f,%.4f,%llu,%d\n", c.name.c_str(), hn.c_str(), strategy_names[s], rep, files.size(), (unsigned long long)acc, (unsigned long long)uniq,
                    (double)hits / acc, ms * 1e6 / acc, (double)probes / acc, (double)lookups / acc, (unsigned long long)rs, ok ? 1 : 0);
            // ---- block-scoped replay with the declaration heuristic, both scope designs ----
            for (int design = 0; design < 2; design++) {
                u64 ops = 0, res = 0, pr = 0, lk = 0, uses = 0, found = 0; double ms2 = 0;
                for (auto &ev : evs) { auto t = symtab_create((Strategy)s, o);
                    auto run = [&](auto &st) { st.enter_scope(); for (auto &e : ev) { if (e.type == 0) st.enter_scope(); else if (e.type == 1) st.exit_scope(); else if (e.type == 2) { st.declare(e.name, 1, 0); ops++; } else { uses++; ops++; if (st.resolve(e.name)) found++; } } };
                    if (design == 0) { ScopedSymbolTable st(*t); ms2 += timeMs([&] { run(st); }); } else { ShadowScopedSymbolTable st(*t); ms2 += timeMs([&] { run(st); }); }
                    pr += t->stats.lookupProbes; lk += t->stats.lookups; res += t->stats.resizes; }
                fprintf(csv, "%s,%s,%s,scoped,%s,%d,%zu,%llu,%llu,%.4f,%.2f,%.4f,%.4f,%llu,1\n", c.name.c_str(), hn.c_str(), strategy_names[s], design == 0 ? "name@depth" : "shadow-chain", rep, files.size(), (unsigned long long)ops,
                        (unsigned long long)uses, uses ? (double)found / uses : 0.0, ms2 * 1e6 / max<u64>(ops, 1), uses ? (double)pr / uses : 0.0, uses ? (double)lk / uses : 0.0, (unsigned long long)res);
            }
        }
        printf("trace %s done\n", c.name.c_str()); fflush(stdout); fflush(csv); fflush(cst);
    }
    fclose(csv); fclose(cst); printf("%s\n", allOk ? "trace: unique-identifier counts verified" : "trace: CHECK FAILURES"); return allOk ? 0 : 2;
}

int main(int argc, char **argv) {
    if (argc < 2) { fprintf(stderr, "usage: %s sweep|dist|hybrid|scopes|extb|trace [options]\n", argv[0]); return 1; }
    string c = argv[1];
    if (c == "sweep") return cmdSweep(argc, argv);
    if (c == "dist") return cmdDist(argc, argv);
    if (c == "hybrid") return cmdHybrid(argc, argv);
    if (c == "scopes") return cmdScopes(argc, argv);
    if (c == "extb") return cmdExtB(argc, argv);
    if (c == "trace") return cmdTrace(argc, argv);
    fprintf(stderr, "unknown sub-command %s\n", c.c_str()); return 1;
}
