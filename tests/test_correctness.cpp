// =============================================================================
//  test_correctness.cpp  -  verifies every collision-resolution strategy
//
//   1. hash-function test vectors (would have caught a wrong FNV constant)
//   2. targeted edge cases (duplicates, missing keys, re-insert after delete, fixed-capacity limits)
//   3. block-scope manager (shadowing, resolve inner -> outer, exit_scope erases)
//   4. differential fuzzing: random insert / lookup / erase sequences are applied to every strategy
//      and to std::unordered_map; any difference in result, size or stored value is a failure.
//      Runs for all 5 hash functions, fixed-capacity and auto-resize mode, and several
//      hybrid-parameter settings (tiny tree threshold, window of 1, 1-slot buckets, no stash ...).
//
//  Build & run:  make test        (or: g++ -O1 -g -fsanitize=address,undefined -std=c++17 -I../source
//                                       test_correctness.cpp ../source/symtab.cpp -o test && ./test)
// =============================================================================
#include <cstdio>
#include <random>
#include <string>
#include <unordered_map>

#include "symtab.h"
using namespace std;

static int g_fail = 0, g_checks = 0;
#define CHECK(cond, ...) do { g_checks++; if (!(cond)) { g_fail++; if (g_fail <= 40) { printf("  FAIL line %d: ", __LINE__); printf(__VA_ARGS__); printf("\n"); } } } while (0)

static Symbol sym(const string &n, int line = 0) { return Symbol{n, 0, 0, line}; }

/* --------------------------- 1. hash test vectors --------------------------- */
static void testHashes() {
    puts("[1] hash-function test vectors");
    CHECK(hash_djb2("") == 5381ULL, "djb2 empty");
    CHECK(hash_djb2("a") == 177670ULL, "djb2 a");                       // 5381*33 + 97
    CHECK(hash_fnv1a("") == 0xcbf29ce484222325ULL, "fnv1a-64 offset basis");
    CHECK(hash_fnv1a("a") == 0xaf63dc4c8601ec8cULL, "fnv1a-64('a') = %llx", (unsigned long long)hash_fnv1a("a"));
    CHECK(hash_fnv1a("foobar") == 0x85944171f73967e8ULL, "fnv1a-64('foobar')");
    CHECK(hash_sdbm("a") == 97ULL, "sdbm a");
    CHECK(hash_sdbm("ab") == 97ULL * 65599ULL + 98ULL, "sdbm ab");
    CHECK(hash_pjw("a") == 97ULL, "pjw a");
    CHECK(hash_sum("abc") == 97ULL + 98 + 99, "sum abc");
    CHECK(hash_sum("abc") == hash_sum("cba"), "sum is anagram-blind (intentionally weak)");
}

/* --------------------------- 2. targeted edge cases --------------------------- */
static void testEdgeCases() {
    puts("[2] edge cases for every strategy");
    for (int s = 0; s < STRAT_COUNT; s++) {
        TableOptions o; o.capacity = 31; o.auto_resize = true;
        auto t = symtab_create((Strategy)s, o); const char *nm = strategy_names[s];
        CHECK(t->lookup("x") == nullptr, "%s: lookup in empty table", nm);
        CHECK(!t->erase("x"), "%s: erase in empty table", nm);
        CHECK(t->insert(sym("alpha", 1)) == INSERT_OK, "%s: first insert", nm);
        CHECK(t->insert(sym("alpha", 2)) == INSERT_EXISTS, "%s: duplicate insert reports EXISTS", nm);
        CHECK(t->size() == 1, "%s: duplicate does not grow the table", nm);
        const Symbol *p = t->lookup("alpha");
        CHECK(p && p->line_declared == 2, "%s: duplicate insert updates the stored symbol", nm);
        CHECK(t->erase("alpha") && !t->erase("alpha"), "%s: erase once, second erase fails", nm);
        CHECK(t->lookup("alpha") == nullptr && t->size() == 0, "%s: deleted key is gone", nm);
        CHECK(t->insert(sym("alpha", 3)) == INSERT_OK && t->lookup("alpha"), "%s: re-insert after delete", nm);
        for (int i = 0; i < 2000; i++) t->insert(sym("id" + to_string(i)));         // forces several resizes
        bool all = true; for (int i = 0; i < 2000; i++) all &= t->lookup("id" + to_string(i)) != nullptr;
        CHECK(all && t->size() == 2001, "%s: all keys survive resizing (size=%zu)", nm, t->size());
        CHECK(t->stats.resizes > 0, "%s: resized at least once", nm);
        CHECK(t->load_factor() <= 1.0, "%s: load factor <= 1 in auto-resize mode", nm);
    }
    // fixed capacity: no resizing, nothing may be lost, FAILED inserts must not corrupt the table
    for (int s = 0; s < STRAT_COUNT; s++) {
        TableOptions o; o.capacity = 53; o.auto_resize = false;
        auto t = symtab_create((Strategy)s, o); size_t cap = t->capacity(); size_t ok = 0, failed = 0; vector<string> placed;
        for (size_t i = 0; i < cap + 20; i++) { string k = "v" + to_string(i); int r = t->insert(sym(k)); if (r == INSERT_OK) { ok++; placed.push_back(k); } else if (r == INSERT_FAILED) failed++; }
        bool all = true; for (auto &k : placed) all &= t->lookup(k) != nullptr;
        CHECK(all, "%s: fixed capacity - every accepted key is findable", strategy_names[s]);
        CHECK(t->size() == ok, "%s: fixed capacity - size matches accepted inserts (%zu vs %zu)", strategy_names[s], t->size(), ok);
        CHECK(t->stats.failed == failed, "%s: failed-insert counter (%llu vs %zu)", strategy_names[s], (unsigned long long)t->stats.failed, failed);
        CHECK(t->stats.resizes == 0, "%s: fixed capacity never resizes", strategy_names[s]);
    }
}

/* --------------------------- 3. scope manager --------------------------- */
static void testScopes() {
    puts("[3] block scopes on every strategy");
    for (int s = 0; s < STRAT_COUNT; s++) {
        TableOptions o; o.capacity = 31; auto t = symtab_create((Strategy)s, o); ScopedSymbolTable st(*t); const char *nm = strategy_names[s];
        st.enter_scope(); st.declare("x", 0, 1); st.declare("y", 0, 2);
        st.enter_scope(); st.declare("x", 1, 10);
        const Symbol *a = st.resolve("x"), *b = st.resolve("y");
        CHECK(a && a->line_declared == 10 && a->type == 1, "%s: inner x shadows outer x", nm);
        CHECK(b && b->line_declared == 2, "%s: y resolves to the outer scope", nm);
        st.exit_scope();
        a = st.resolve("x");
        CHECK(a && a->line_declared == 1, "%s: after exit the outer x is visible again", nm);
        CHECK(st.resolve("nope") == nullptr, "%s: undeclared name does not resolve", nm);
        st.exit_scope();
        CHECK(t->size() == 0, "%s: leaving the last scope erases every symbol (size=%zu)", nm, t->size());
    }
}

/* --------------------------- 4. differential fuzzing --------------------------- */
struct Variant { const char *label; TableOptions o; };

static void fuzzOne(Strategy s, const HashInfo &hs, Variant v, int seed, long &ops) {
    TableOptions o = v.o; o.hash = hs.fn;
    auto t = symtab_create(s, o); unordered_map<string, int> ref; mt19937 r(seed * 7919 + (int)s);
    const bool fixed = !o.auto_resize; const int keySpace = fixed ? (int)(o.capacity * 0.7) : 800;
    for (int i = 0; i < 3000; i++) {
        string k = "k" + to_string(r() % keySpace); int op = r() % 10; ops++;
        if (op < 5) {
            int res = t->insert(sym(k, i));
            if (res == INSERT_FAILED) { CHECK(fixed, "%s/%s/%s: INSERT_FAILED in auto-resize mode", strategy_names[s], hs.name, v.label); continue; }
            bool had = ref.count(k) > 0;
            CHECK((res == INSERT_EXISTS) == had, "%s/%s/%s: insert status for %s", strategy_names[s], hs.name, v.label, k.c_str());
            ref[k] = i;
        } else if (op < 8) {
            const Symbol *p = t->lookup(k); auto it = ref.find(k);
            CHECK((p != nullptr) == (it != ref.end()) && (!p || p->line_declared == it->second), "%s/%s/%s: lookup %s", strategy_names[s], hs.name, v.label, k.c_str());
        } else {
            bool e = t->erase(k); bool had = ref.erase(k) > 0;
            CHECK(e == had, "%s/%s/%s: erase %s", strategy_names[s], hs.name, v.label, k.c_str());
        }
        if (t->size() != ref.size()) { CHECK(false, "%s/%s/%s: size %zu vs %zu", strategy_names[s], hs.name, v.label, t->size(), ref.size()); return; }
    }
    for (auto &kv : ref) if (!t->lookup(kv.first)) { CHECK(false, "%s/%s/%s: lost key %s", strategy_names[s], hs.name, v.label, kv.first.c_str()); return; }
}

static void testFuzz() {
    puts("[4] differential fuzzing vs std::unordered_map");
    vector<Variant> vs;
    { TableOptions o; o.capacity = 7;   o.auto_resize = true;  vs.push_back({"resize/tiny", o}); }
    { TableOptions o; o.capacity = 211; o.auto_resize = false; vs.push_back({"fixed/211", o}); }
    { TableOptions o; o.capacity = 53;  o.auto_resize = true; o.max_load = 0.9; vs.push_back({"resize/maxload0.9", o}); }
    { TableOptions o; o.capacity = 23;  o.auto_resize = true; o.treeify = 2; o.untreeify = 1; o.window = 1; o.bucket = 1; o.stash = 0; o.maxkick = 5; vs.push_back({"resize/extreme-hybrid", o}); }
    { TableOptions o; o.capacity = 101; o.auto_resize = false; o.treeify = 3; o.untreeify = 2; o.window = 2; o.bucket = 2; o.stash = 1; o.maxkick = 20; vs.push_back({"fixed/small-hybrid", o}); }
    { TableOptions o; o.capacity = 31;  o.auto_resize = true; o.treeify = 64; o.window = 64; o.bucket = 8; o.stash = 16; o.maxkick = 500; vs.push_back({"resize/large-hybrid", o}); }
    long ops = 0;
    for (int s = 0; s < STRAT_COUNT; s++) for (auto &hs : all_hashes()) for (auto &v : vs) for (int seed = 0; seed < 2; seed++) fuzzOne((Strategy)s, hs, v, seed, ops);
    printf("    %ld random operations applied to %d strategies x %zu hashes x %zu configurations\n", ops, (int)STRAT_COUNT, all_hashes().size(), vs.size());
}

int main() {
    testHashes(); testEdgeCases(); testScopes(); testFuzz();
    printf("\n%d checks, %d failed -> %s\n", g_checks, g_fail, g_fail ? "FAILED" : "ALL TESTS PASSED");
    return g_fail ? 1 : 0;
}
