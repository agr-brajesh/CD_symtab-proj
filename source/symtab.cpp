#include "symtab.h"

#include <algorithm>
#include <cmath>
#include <map>
#include <random>

using namespace std;

const char *strategy_names[STRAT_COUNT] = {
    "Separate Chaining", "Linear Probing", "Quadratic Probing", "Double Hashing",
    "Robin Hood Hashing", "H1: Chaining + Tree", "H2: Open Addr + Overflow", "H3: Cuckoo + Stash"};
const char *strategy_kind[STRAT_COUNT] = {"classic", "classic", "classic", "classic", "hybrid", "hybrid", "hybrid", "hybrid"};

/* =============================== hash functions =============================== */
u64 hash_djb2(const string &s) { u64 h = 5381; for (unsigned char c : s) h = ((h << 5) + h) + c; return h; }          // h*33 + c
u64 hash_fnv1a(const string &s) { u64 h = 14695981039346656037ULL; for (unsigned char c : s) { h ^= c; h *= 1099511628211ULL; } return h; }
u64 hash_sdbm(const string &s) { u64 h = 0; for (unsigned char c : s) h = c + (h << 6) + (h << 16) - h; return h; }
u64 hash_sum(const string &s) { u64 h = 0; for (unsigned char c : s) h += c; return h; }
u64 hash_pjw(const string &s) {
    uint32_t h = 0, g;
    for (unsigned char c : s) { h = (h << 4) + c; if ((g = h & 0xF0000000u)) h ^= g >> 24; h &= ~g; }
    return h;
}
const vector<HashInfo> &all_hashes() {
    static const vector<HashInfo> v = {{"djb2", hash_djb2}, {"fnv1a", hash_fnv1a}, {"sdbm", hash_sdbm}, {"pjw", hash_pjw}, {"sum", hash_sum}};
    return v;
}

static u64 mix64(u64 x) {   // splitmix64 finalizer
    x += 0x9e3779b97f4a7c15ULL; x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9ULL;
    x = (x ^ (x >> 27)) * 0x94d049bb133111ebULL; return x ^ (x >> 31);
}
struct SplitMix {                                // tiny deterministic PRNG (same sequence in the C++ and JS engines)
    u64 s; explicit SplitMix(u64 seed) : s(seed) {}
    u64 next() { u64 r = mix64(s); s += 0x9e3779b97f4a7c15ULL; return r; }
};
static u64 fnv32(const string &s) {            // secondary hash for double hashing (same as the model project)
    uint32_t h = 2166136261u; for (unsigned char c : s) { h ^= c; h *= 16777619u; } return h;
}
static u64 fnvSeeded(const string &s, u64 seed) {   // independent hash for cuckoo's 2nd bucket
    u64 h = 14695981039346656037ULL ^ seed; for (unsigned char c : s) { h ^= c; h *= 1099511628211ULL; } return mix64(h);
}
static bool isPrime(size_t n) { if (n < 2) return false; for (size_t i = 2; i * i <= n; i++) if (n % i == 0) return false; return true; }
static size_t nextPrime(size_t n) { if (n < 3) return 3; if (n % 2 == 0) n++; while (!isPrime(n)) n += 2; return n; }

/* ============================ 1. Separate chaining ============================ */
class ChainingTable : public SymbolTable {
    struct Node { Symbol s; Node *next; };
    vector<Node *> b; size_t n = 0;
    void grow() {
        vector<Node *> nb(nextPrime(b.size() * 2), nullptr);
        for (Node *h : b) while (h) { Node *nx = h->next; size_t i = H(h->s.name) % nb.size(); h->next = nb[i]; nb[i] = h; h = nx; }
        b.swap(nb); stats.resizes++;
    }
public:
    explicit ChainingTable(const TableOptions &o) : SymbolTable(o), b(nextPrime(o.capacity), nullptr) {}
    ~ChainingTable() { for (Node *h : b) while (h) { Node *nx = h->next; delete h; h = nx; } }
    int insert(const Symbol &s) override {
        stats.inserts++;
        size_t i = H(s.name) % b.size(); u64 p = 0;
        for (Node *x = b[i]; x; x = x->next) { p++; if (x->s.name == s.name) { x->s = s; recI(p); return INSERT_EXISTS; } }
        if (autoResize && (double)(n + 1) / b.size() > maxLoad) { grow(); i = H(s.name) % b.size(); }
        if (b[i]) stats.collisions++;
        b[i] = new Node{s, b[i]}; n++; recI(p + 1); return INSERT_OK;       // +1 = creating the node
    }
    const Symbol *lookup(const string &nm) override {
        u64 p = 0;
        for (Node *x = b[H(nm) % b.size()]; x; x = x->next) { p++; if (x->s.name == nm) { recL(p); return &x->s; } }
        recL(p); return nullptr;
    }
    bool erase(const string &nm) override {
        for (Node **pp = &b[H(nm) % b.size()]; *pp; pp = &(*pp)->next)
            if ((*pp)->s.name == nm) { Node *d = *pp; *pp = d->next; delete d; n--; return true; }
        return false;
    }
    size_t size() const override { return n; }
    size_t capacity() const override { return b.size(); }
    size_t memoryBytes() const override { return b.size() * sizeof(Node *) + n * sizeof(Node); }
};

/* ============ 2-4. Open addressing: linear / quadratic / double hashing ============ */
class OpenAddrTable : public SymbolTable {
public:
    enum Mode { LINEAR, QUADRATIC, DOUBLE };
private:
    enum St : uint8_t { EMPTY, FULL, DEL };
    struct Slot { St st = EMPTY; Symbol s; };
    struct Probe { u64 h0, step; };
    vector<Slot> t; size_t used = 0, tomb = 0; Mode mode;

    Probe start(const string &nm, size_t c) const { return {H(nm) % c, mode == DOUBLE ? 1 + fnv32(nm) % (c - 1) : 1}; }
    size_t at(const Probe &p, size_t i, size_t c) const {
        switch (mode) {
            case LINEAR:    return (p.h0 + i) % c;
            case QUADRATIC: return (p.h0 + (u64)i * i) % c;           // index + i^2
            default:        return (p.h0 + (u64)i * p.step) % c;       // index + i*h2(key)
        }
    }
    size_t limit() const { size_t c = t.size(); return min((size_t)(maxLoad * c), c - 1); }
    long find(const string &nm, u64 &p) {
        size_t c = t.size(); Probe pr = start(nm, c); p = 0;
        for (size_t i = 0; i < c; i++) {
            size_t k = at(pr, i, c); p++; Slot &sl = t[k];
            if (sl.st == EMPTY) break;
            if (sl.st == FULL && sl.s.name == nm) return (long)k;
        }
        return -1;
    }
    bool rebuild(size_t cap) {
        vector<Slot> nt(cap);
        for (auto &sl : t) if (sl.st == FULL) {
            Probe pr = start(sl.s.name, cap); bool ok = false;
            for (size_t i = 0; i < cap; i++) { size_t k = at(pr, i, cap); if (nt[k].st == EMPTY) { nt[k].st = FULL; nt[k].s = sl.s; ok = true; break; } }
            if (!ok) return false;
        }
        t.swap(nt); tomb = 0; return true;
    }
    void regrow(size_t cap) { cap = nextPrime(cap); while (!rebuild(cap)) cap = nextPrime(cap * 2); stats.resizes++; }
public:
    OpenAddrTable(Mode m, const TableOptions &o) : SymbolTable(o), t(nextPrime(o.capacity)), mode(m) { maxLoad = min(maxLoad, 0.98); }
    int insert(const Symbol &s) override {
        stats.inserts++;
        if (autoResize) { if (used + tomb + 1 > limit()) regrow((used + 1) * 2 > limit() ? t.size() * 2 : t.size()); }
        else if (used >= t.size()) { recI(t.size()); stats.failed++; return INSERT_FAILED; }
        size_t c = t.size(); Probe pr = start(s.name, c); long del = -1; u64 p = 0; bool coll = false;
        auto put = [&](size_t d) {
            if (t[d].st == DEL) tomb--;
            t[d].st = FULL; t[d].s = s; used++; recI(p); if (coll) stats.collisions++; return INSERT_OK;
        };
        for (size_t i = 0; i < c; i++) {
            size_t k = at(pr, i, c); p++; Slot &sl = t[k];
            if (i == 0 && sl.st == FULL) coll = true;
            if (sl.st == DEL) { if (del < 0) del = (long)k; continue; }
            if (sl.st == EMPTY) return put(del >= 0 ? (size_t)del : k);
            if (sl.s.name == s.name) { sl.s = s; recI(p); return INSERT_EXISTS; }
        }
        if (del >= 0) return put((size_t)del);
        if (autoResize) { regrow(c * 2); stats.inserts--; return insert(s); }      // probe sequence exhausted
        recI(p); stats.failed++; return INSERT_FAILED;                              // e.g. quadratic probing cannot reach a free slot
    }
    const Symbol *lookup(const string &nm) override { u64 p; long k = find(nm, p); recL(p); return k >= 0 ? &t[k].s : nullptr; }
    bool erase(const string &nm) override { u64 p; long k = find(nm, p); if (k < 0) return false; t[k].st = DEL; used--; tomb++; return true; }
    size_t size() const override { return used; }
    size_t capacity() const override { return t.size(); }
    size_t memoryBytes() const override { return t.size() * sizeof(Slot); }
};

/* ========= 5. Robin Hood (linear probing + displacement balancing) =========
   Single-pass insert: if a resident is closer to home (smaller PSL) than the key being
   placed, they swap ("steal from the rich"). Lookup stops as soon as psl > resident's psl. */
class RobinHoodTable : public SymbolTable {
    struct Slot { int dist = -1; Symbol s; };
    vector<Slot> t; size_t n = 0;
    void put(Symbol cur) {
        size_t c = t.size(), k = H(cur.name) % c; int d = 0;
        for (;;) {
            Slot &sl = t[k];
            if (sl.dist < 0) { sl.s = std::move(cur); sl.dist = d; return; }
            if (sl.dist < d) { swap(sl.s, cur); swap(sl.dist, d); }
            k = (k + 1) % c; d++;
        }
    }
    void regrow(size_t cap) {
        vector<Slot> old; old.swap(t); t.assign(nextPrime(cap), Slot());
        for (auto &sl : old) if (sl.dist >= 0) put(std::move(sl.s));
        stats.resizes++;
    }
    long find(const string &nm, u64 &p) {
        size_t c = t.size(), k = H(nm) % c; int d = 0; p = 0;
        for (;;) {
            p++; Slot &sl = t[k];
            if (sl.dist < 0 || sl.dist < d) return -1;           // early exit: key would have displaced this resident
            if (sl.s.name == nm) return (long)k;
            k = (k + 1) % c; d++; if ((size_t)d > c) return -1;
        }
    }
public:
    explicit RobinHoodTable(const TableOptions &o) : SymbolTable(o), t(nextPrime(o.capacity)) { maxLoad = min(maxLoad, 0.98); }
    int insert(const Symbol &s) override {
        stats.inserts++;
        size_t c = t.size();
        if (autoResize) { if (n + 1 > min((size_t)(maxLoad * c), c - 1)) { regrow(c * 2); c = t.size(); } }
        else if (n >= c) { recI(c); stats.failed++; return INSERT_FAILED; }
        Symbol cur = s; int d = 0; size_t k = H(cur.name) % c; u64 p = 0; bool swapped = false, coll = t[k].dist >= 0;
        for (;;) {
            p++; Slot &sl = t[k];
            if (sl.dist < 0) { sl.s = std::move(cur); sl.dist = d; break; }
            if (!swapped && sl.dist == d && sl.s.name == cur.name) { sl.s = s; recI(p); return INSERT_EXISTS; }
            if (sl.dist < d) { swap(sl.s, cur); swap(sl.dist, d); swapped = true; }
            k = (k + 1) % c; d++;
        }
        n++; recI(p); if (coll) stats.collisions++; return INSERT_OK;
    }
    const Symbol *lookup(const string &nm) override { u64 p; long k = find(nm, p); recL(p); return k >= 0 ? &t[k].s : nullptr; }
    bool erase(const string &nm) override {
        u64 p; long k = find(nm, p); if (k < 0) return false;
        size_t c = t.size(), i = k;
        for (;;) {                                                           // backward-shift deletion (no tombstones)
            size_t nx = (i + 1) % c;
            if (t[nx].dist <= 0) { t[i].dist = -1; t[i].s = Symbol(); break; }
            t[i].s = std::move(t[nx].s); t[i].dist = t[nx].dist - 1; i = nx;
        }
        n--; return true;
    }
    size_t size() const override { return n; }
    size_t capacity() const override { return t.size(); }
    size_t memoryBytes() const override { return t.size() * sizeof(Slot); }
};

/* =================== H1. HYBRID: Chaining + Tree ===================
   Chains longer than TREEIFY become a std::map (red-black tree): worst case O(log n)
   instead of O(n). Chains shrinking below UNTREEIFY revert to lists. */
class ChainTreeTable : public SymbolTable {
    struct Node { Symbol s; Node *next; };
    struct Bucket { Node *head = nullptr; uint32_t len = 0; map<string, Symbol> *tree = nullptr; };
    const uint32_t TREEIFY, UNTREEIFY;
    vector<Bucket> b; size_t n = 0;
    static u64 treeCost(size_t sz) { return (u64)ceil(log2((double)sz + 1)); }     // comparisons ~ tree depth
    void treeify(Bucket &k) {
        k.tree = new map<string, Symbol>();
        for (Node *x = k.head; x;) { Node *nx = x->next; k.tree->emplace(x->s.name, x->s); delete x; x = nx; }
        k.head = nullptr; k.len = 0; stats.treeifications++;
    }
    void untreeify(Bucket &k) {
        stats.untreeifications++;
        for (auto &kv : *k.tree) { k.head = new Node{kv.second, k.head}; k.len++; }
        delete k.tree; k.tree = nullptr;
    }
    void add(Bucket &k, const Symbol &s) {
        if (k.tree) { k.tree->emplace(s.name, s); return; }
        k.head = new Node{s, k.head};
        if (++k.len > TREEIFY) treeify(k);
    }
    static void freeAll(vector<Bucket> &v) {
        for (auto &k : v) { for (Node *x = k.head; x;) { Node *nx = x->next; delete x; x = nx; } delete k.tree; k.head = nullptr; k.tree = nullptr; }
    }
    void grow() {
        vector<Symbol> all; all.reserve(n);
        for (auto &k : b) { if (k.tree) for (auto &kv : *k.tree) all.push_back(kv.second); for (Node *x = k.head; x; x = x->next) all.push_back(x->s); }
        freeAll(b); b.assign(nextPrime(b.size() * 2), Bucket());
        for (auto &s : all) add(b[H(s.name) % b.size()], s);
        stats.resizes++;
    }
public:
    explicit ChainTreeTable(const TableOptions &o) : SymbolTable(o), TREEIFY(max<uint32_t>(o.treeify, 1)),
        UNTREEIFY(min<uint32_t>(o.untreeify, max<uint32_t>(o.treeify, 1))), b(nextPrime(o.capacity)) {}
    ~ChainTreeTable() { freeAll(b); }
    int insert(const Symbol &s) override {
        stats.inserts++; u64 p = 0;
        Bucket *k = &b[H(s.name) % b.size()];
        if (k->tree) { p = treeCost(k->tree->size()); auto it = k->tree->find(s.name); if (it != k->tree->end()) { it->second = s; recI(p); return INSERT_EXISTS; } }
        else for (Node *x = k->head; x; x = x->next) { p++; if (x->s.name == s.name) { x->s = s; recI(p); return INSERT_EXISTS; } }
        if (autoResize && (double)(n + 1) / b.size() > maxLoad) { grow(); k = &b[H(s.name) % b.size()]; }
        if (k->tree ? !k->tree->empty() : k->head != nullptr) stats.collisions++;
        add(*k, s); n++; recI(p + 1); return INSERT_OK;
    }
    const Symbol *lookup(const string &nm) override {
        Bucket &k = b[H(nm) % b.size()]; u64 p = 0;
        if (k.tree) { p = treeCost(k.tree->size()); recL(p); auto it = k.tree->find(nm); return it == k.tree->end() ? nullptr : &it->second; }
        for (Node *x = k.head; x; x = x->next) { p++; if (x->s.name == nm) { recL(p); return &x->s; } }
        recL(p); return nullptr;
    }
    bool erase(const string &nm) override {
        Bucket &k = b[H(nm) % b.size()];
        if (k.tree) { if (!k.tree->erase(nm)) return false; n--; if (k.tree->size() <= UNTREEIFY) untreeify(k); return true; }
        for (Node **pp = &k.head; *pp; pp = &(*pp)->next)
            if ((*pp)->s.name == nm) { Node *d = *pp; *pp = d->next; delete d; k.len--; n--; return true; }
        return false;
    }
    size_t size() const override { return n; }
    size_t capacity() const override { return b.size(); }
    size_t memoryBytes() const override {
        size_t m = b.size() * sizeof(Bucket);
        for (auto &k : b) { m += k.len * sizeof(Node); if (k.tree) m += k.tree->size() * (sizeof(string) + sizeof(Symbol) + 32); }
        return m;
    }
};

/* ============== H2. HYBRID: Open Addressing + Overflow Chain ==============
   Linear probing limited to a window of L slots (cache friendly, bounded probe length).
   If the window is full the symbol spills into a small chained overflow area. Slots never
   return to EMPTY (only tombstones), so "EMPTY inside the window" proves the key is NOT in
   the overflow area -> unsuccessful searches usually stop inside the window. */
class OpenOverflowTable : public SymbolTable {
    enum St : uint8_t { EMPTY, FULL, DEL };
    struct Slot { St st = EMPTY; Symbol s; };
    struct ONode { Symbol s; ONode *next; };
    const size_t L;
    vector<Slot> t; vector<ONode *> ov; size_t used = 0, tomb = 0, ovN = 0;
    size_t win() const { return min(L, t.size()); }
    size_t ovIdx(u64 h) const { return h % ov.size(); }
    void freeOv() { for (auto h : ov) while (h) { auto nx = h->next; delete h; h = nx; } }
    void init(size_t cap) { t.assign(cap, Slot()); ov.assign(cap / 4 + 1, nullptr); used = tomb = ovN = 0; }
    void rawAdd(const Symbol &s) {
        u64 h = H(s.name); size_t c = t.size();
        for (size_t i = 0; i < win(); i++) { size_t k = (h % c + i) % c; if (t[k].st == EMPTY) { t[k].st = FULL; t[k].s = s; used++; return; } }
        size_t o = ovIdx(h); ov[o] = new ONode{s, ov[o]}; ovN++;
    }
    void rebuild(size_t cap) {
        vector<Symbol> all; all.reserve(used + ovN);
        for (auto &sl : t) if (sl.st == FULL) all.push_back(std::move(sl.s));
        for (auto h : ov) for (auto x = h; x; x = x->next) all.push_back(x->s);
        freeOv(); init(nextPrime(cap));
        for (auto &s : all) rawAdd(s);
        stats.resizes++;
    }
public:
    explicit OpenOverflowTable(const TableOptions &o) : SymbolTable(o), L(max<size_t>(o.window, 1)) { maxLoad = min(maxLoad, 0.98); init(nextPrime(o.capacity)); }
    ~OpenOverflowTable() { freeOv(); }
    int insert(const Symbol &s) override {
        stats.inserts++;
        size_t c = t.size();
        if (autoResize) { size_t lim = min((size_t)(maxLoad * c), c - 1); if (used + tomb + ovN + 1 > lim) rebuild((used + ovN + 1) * 2 > lim ? c * 2 : c); }
        c = t.size(); u64 h = H(s.name); size_t w = win(); long del = -1, empty = -1; u64 p = 0;
        for (size_t i = 0; i < w; i++) {
            size_t k = (h % c + i) % c; p++; Slot &sl = t[k];
            if (sl.st == EMPTY) { empty = (long)k; break; }
            if (sl.st == DEL) { if (del < 0) del = (long)k; continue; }
            if (sl.s.name == s.name) { sl.s = s; recI(p); return INSERT_EXISTS; }
        }
        if (empty < 0)
            for (ONode *x = ov[ovIdx(h)]; x; x = x->next) { p++; if (x->s.name == s.name) { x->s = s; recI(p); return INSERT_EXISTS; } }
        long tgt = del >= 0 ? del : empty;
        if (tgt >= 0) {
            if (t[h % c].st == FULL) stats.collisions++;
            if (t[tgt].st == DEL) tomb--;
            t[tgt].st = FULL; t[tgt].s = s; used++;
        } else { stats.collisions++; stats.overflowInserts++; size_t o = ovIdx(h); ov[o] = new ONode{s, ov[o]}; ovN++; p++; }
        recI(p); return INSERT_OK;                                           // never fails: overflow area is unbounded
    }
    const Symbol *lookup(const string &nm) override {
        u64 h = H(nm); size_t c = t.size(), w = win(); u64 p = 0; bool full = true;
        for (size_t i = 0; i < w; i++) {
            size_t k = (h % c + i) % c; p++; Slot &sl = t[k];
            if (sl.st == EMPTY) { full = false; break; }
            if (sl.st == FULL && sl.s.name == nm) { recL(p); return &sl.s; }
        }
        if (full) { stats.overflowLookups++; for (ONode *x = ov[ovIdx(h)]; x; x = x->next) { p++; if (x->s.name == nm) { recL(p); return &x->s; } } }
        recL(p); return nullptr;
    }
    bool erase(const string &nm) override {
        u64 h = H(nm); size_t c = t.size(), w = win(); bool full = true;
        for (size_t i = 0; i < w; i++) {
            size_t k = (h % c + i) % c; Slot &sl = t[k];
            if (sl.st == EMPTY) { full = false; break; }
            if (sl.st == FULL && sl.s.name == nm) { sl.st = DEL; used--; tomb++; return true; }
        }
        if (full) for (ONode **pp = &ov[ovIdx(h)]; *pp; pp = &(*pp)->next)
            if ((*pp)->s.name == nm) { ONode *d = *pp; *pp = d->next; delete d; ovN--; return true; }
        return false;
    }
    size_t size() const override { return used + ovN; }
    size_t capacity() const override { return t.size(); }
    size_t memoryBytes() const override { return t.size() * sizeof(Slot) + ov.size() * sizeof(ONode *) + ovN * sizeof(ONode); }
};

/* ================= H3. HYBRID: Bucketized Cuckoo + Stash =================
   Two hash functions, 4-slot buckets (a lookup touches at most 2 buckets), and a tiny stash
   that absorbs failed kick chains. A failed insert is rolled back exactly (fixed-capacity mode)
   or triggers a rebuild with a fresh seed / bigger table (auto-resize mode). */
class CuckooStashTable : public SymbolTable {
    const int B; const size_t STASH; const int MAXKICK;
    struct Slot { bool used = false; Symbol s; };
    vector<Slot> t; size_t nb; vector<Symbol> stash; size_t n = 0; u64 seed = 12345; SplitMix rng{42};
    bool counting = true; u64 placeProbes = 0; vector<size_t> trail;
    size_t b1(const string &s) const { return H(s) % nb; }
    size_t b2(const string &s) const { size_t x = fnvSeeded(s, seed) % nb, y = H(s) % nb; if (x == y) x = (x + 1) % nb; return x; }
    bool place(Symbol &cur) {
        trail.clear();
        for (int kick = 0; kick < MAXKICK; kick++) {
            size_t x = b1(cur.name), y = b2(cur.name);
            for (size_t bk : {x, y}) for (int j = 0; j < B; j++) {
                placeProbes++; Slot &sl = t[bk * B + j];
                if (!sl.used) { sl.used = true; sl.s = std::move(cur); return true; }
            }
            bool pickX = (rng.next() & 1) != 0;                                  // two separate, sequenced draws (the
            size_t idx = (pickX ? x : y) * B + (size_t)(rng.next() % (u64)B);    // original had both in one expression)
            trail.push_back(idx); swap(cur, t[idx].s); placeProbes++;
            if (counting) stats.collisions++;                                // a kick = a collision resolved by relocation
        }
        return false;                                                        // cur now holds the homeless symbol
    }
    void undo(Symbol &cur) { for (size_t i = trail.size(); i-- > 0;) swap(cur, t[trail[i]].s); trail.clear(); }
    vector<Symbol> collect() const {
        vector<Symbol> all; all.reserve(n + 1);
        for (auto &sl : t) if (sl.used) all.push_back(sl.s);
        for (auto &s : stash) all.push_back(s);
        return all;
    }
    void rebuild(const vector<Symbol> &all, size_t newnb) {
        bool saved = counting; counting = false; int tries = 0;
        for (;;) {
            nb = newnb; t.assign(nb * B, Slot()); stash.clear(); seed = rng.next(); bool ok = true;
            for (auto &s : all) { Symbol c = s; if (!place(c)) { if (stash.size() < STASH) stash.push_back(c); else { ok = false; break; } } }
            if (ok) break;
            if (++tries % 3 == 0) newnb = nb * 2;                            // 2 retries with fresh seeds, then grow
        }
        counting = saved; stats.resizes++;
    }
    Symbol *findp(const string &nm, u64 &p) {
        p = 0; size_t x = b1(nm), y = b2(nm);
        for (size_t bk : {x, y}) for (int j = 0; j < B; j++) { p++; Slot &sl = t[bk * B + j]; if (sl.used && sl.s.name == nm) return &sl.s; }
        if (!stash.empty()) stats.stashLookups++;
        for (auto &s : stash) { p++; if (s.name == nm) return &s; }
        return nullptr;
    }
public:
    explicit CuckooStashTable(const TableOptions &o) : SymbolTable(o), B(max(o.bucket, 1)), STASH(o.stash), MAXKICK(max(o.maxkick, 1)),
        nb(max<size_t>(3, nextPrime(o.capacity / (size_t)max(o.bucket, 1)))) { t.assign(nb * B, Slot()); }
    int insert(const Symbol &s) override {
        stats.inserts++; u64 p; Symbol *e = findp(s.name, p);
        if (e) { *e = s; recI(p); return INSERT_EXISTS; }
        if (autoResize && (double)(n + 1) > maxLoad * nb * B) rebuild(collect(), nb * 2);
        Symbol c = s; placeProbes = 0;
        bool ok = place(c); u64 pp = placeProbes;
        if (!ok) {
            if (stash.size() < STASH) { stash.push_back(c); stats.stashInserts++; }
            else if (autoResize) { auto all = collect(); all.push_back(c); rebuild(all, nb * 2); }
            else { undo(c); recI(p + pp); stats.failed++; return INSERT_FAILED; }
        }
        n++; recI(p + pp); return INSERT_OK;
    }
    const Symbol *lookup(const string &nm) override { u64 p; Symbol *e = findp(nm, p); recL(p); return e; }
    bool erase(const string &nm) override {
        size_t x = b1(nm), y = b2(nm);
        for (size_t bk : {x, y}) for (int j = 0; j < B; j++) { Slot &sl = t[bk * B + j]; if (sl.used && sl.s.name == nm) { sl.used = false; sl.s = Symbol(); n--; return true; } }
        for (size_t i = 0; i < stash.size(); i++) if (stash[i].name == nm) { stash.erase(stash.begin() + i); n--; return true; }
        return false;
    }
    size_t size() const override { return n; }
    size_t capacity() const override { return nb * B; }
    size_t memoryBytes() const override { return t.size() * sizeof(Slot) + STASH * sizeof(Symbol); }
};

/* ================================== factory ================================== */
unique_ptr<SymbolTable> symtab_create(Strategy strat, const TableOptions &o) {
    switch (strat) {
        case STRAT_CHAINING:           return unique_ptr<SymbolTable>(new ChainingTable(o));
        case STRAT_LINEAR_PROBING:     return unique_ptr<SymbolTable>(new OpenAddrTable(OpenAddrTable::LINEAR, o));
        case STRAT_QUADRATIC_PROBING:  return unique_ptr<SymbolTable>(new OpenAddrTable(OpenAddrTable::QUADRATIC, o));
        case STRAT_DOUBLE_HASHING:     return unique_ptr<SymbolTable>(new OpenAddrTable(OpenAddrTable::DOUBLE, o));
        case STRAT_ROBIN_HOOD:         return unique_ptr<SymbolTable>(new RobinHoodTable(o));
        case STRAT_CHAIN_TREE:         return unique_ptr<SymbolTable>(new ChainTreeTable(o));
        case STRAT_OPEN_OVERFLOW:      return unique_ptr<SymbolTable>(new OpenOverflowTable(o));
        case STRAT_CUCKOO_STASH:       return unique_ptr<SymbolTable>(new CuckooStashTable(o));
        default:                       return nullptr;
    }
}

/* ============================ scope manager ============================ */
static string mangle(const string &name, int depth) { string k = name; k += '@'; k += to_string(depth); return k; }

void ScopedSymbolTable::declare(const string &name, int type, int line) {
    string key = mangle(name, depth());
    t.insert(Symbol{key, type, depth(), line});
    scopes.back().push_back(key);
}
const Symbol *ScopedSymbolTable::resolve(const string &name) {
    for (int d = depth(); d >= 0; d--) if (const Symbol *s = t.lookup(mangle(name, d))) return s;
    return nullptr;
}
void ScopedSymbolTable::exit_scope() {
    for (auto &k : scopes.back()) t.erase(k);
    scopes.pop_back();
}

/* ======================= shadow-chain scope manager (conventional design) ======================= */
void ShadowScopedSymbolTable::declare(const string &name, int type, int line) {
    int d = depth(); const Symbol *cur = t.lookup(name);
    if (cur && cur->scope == d) {                                  // redeclaration in the same scope: update in place
        int idx = cur->line_declared; decls[idx].s = Symbol{name, type, d, line};
        t.insert(Symbol{name, type, d, idx}); return;
    }
    int prev = cur ? cur->line_declared : -1;                      // the declaration being shadowed (if any)
    decls.push_back({Symbol{name, type, d, line}, prev});
    t.insert(Symbol{name, type, d, (int)decls.size() - 1});         // adds the name, or overwrites the shadowed entry
}
void ShadowScopedSymbolTable::exit_scope() {
    size_t st = starts.back();
    for (size_t i = decls.size(); i-- > st;) {
        Decl &dl = decls[i];
        if (dl.prev >= 0) { Symbol r = decls[dl.prev].s; r.line_declared = dl.prev; t.insert(r); }   // restore shadowed declaration
        else t.erase(dl.s.name);
    }
    decls.resize(st); starts.pop_back();
}
