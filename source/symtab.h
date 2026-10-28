#ifndef SYMTAB_H
#define SYMTAB_H
// =============================================================================
//  symtab.h  -  Compiler symbol table with 8 collision-resolution strategies
//
//  Classic : Separate Chaining, Linear / Quadratic probing, Double hashing
//  Hybrid  : Robin Hood (open addressing + displacement balancing)   [from the model project]
//            H1  Chaining + Tree         (list -> red-black tree when a chain gets long)
//            H2  Open Addressing + Overflow chain (bounded probe window)
//            H3  Bucketized Cuckoo + Stash
// =============================================================================
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

typedef uint64_t u64;
typedef u64 (*HashFn)(const std::string &);

/* ---------- hash functions ---------- */
u64 hash_djb2(const std::string &s);    // primary hash used by the model project
u64 hash_fnv1a(const std::string &s);
u64 hash_sdbm(const std::string &s);
u64 hash_pjw(const std::string &s);     // PJW / ELF
u64 hash_sum(const std::string &s);     // deliberately weak (sum of characters)
struct HashInfo { const char *name; HashFn fn; };
const std::vector<HashInfo> &all_hashes();

/* ---------- symbol ---------- */
struct Symbol {
    std::string name;
    int type = 0;            // e.g. 0=int,1=float,2=func...
    int scope = 0;
    int line_declared = 0;
};

typedef enum {
    STRAT_CHAINING = 0,
    STRAT_LINEAR_PROBING,
    STRAT_QUADRATIC_PROBING,
    STRAT_DOUBLE_HASHING,
    STRAT_ROBIN_HOOD,
    STRAT_CHAIN_TREE,        // H1
    STRAT_OPEN_OVERFLOW,     // H2
    STRAT_CUCKOO_STASH,      // H3
    STRAT_COUNT
} Strategy;

extern const char *strategy_names[STRAT_COUNT];
extern const char *strategy_kind[STRAT_COUNT];     // "classic" or "hybrid"

/* ---------- statistics (reset freely from the benchmark) ---------- */
struct Stats {
    u64 inserts = 0, insertProbes = 0, maxInsertProbes = 0;
    u64 lookups = 0, lookupProbes = 0, maxLookupProbes = 0;
    u64 lastProbes = 0;        // probes (slots / nodes / tree levels examined) of the most recent operation
    u64 collisions = 0;        // inserts whose first-choice location was occupied (cuckoo: kicks)
    u64 resizes = 0;
    u64 failed = 0;            // inserts rejected because the table could not place the key
    // ---- counters of the hybrid mechanisms (added for the revised evaluation; 0 for the other strategies) ----
    u64 treeifications = 0;    // H1: list -> red-black-tree conversions (including those caused by a resize re-insert)
    u64 untreeifications = 0;  // H1: tree -> list reversions after deletions
    u64 overflowInserts = 0;   // H2: keys that did not fit in their probe window and went to the overflow chain (live inserts)
    u64 overflowLookups = 0;   // H2: lookups that had to walk the overflow chain (window completely full)
    u64 stashInserts = 0;      // H3: keys placed in the stash because the kick chain failed
    u64 stashLookups = 0;      // H3: lookups that scanned a non-empty stash
};

enum InsertResult { INSERT_FAILED = -1, INSERT_EXISTS = 0, INSERT_OK = 1 };

struct TableOptions {
    size_t capacity = 1031;    // slots / buckets (rounded up to a prime)
    HashFn hash = hash_djb2;
    bool auto_resize = true;   // false = fixed capacity (model-project methodology)
    double max_load = 0.7;     // resize threshold when auto_resize is true
    // ---- tuning parameters of the hybrid schemes (defaults = the values used in the report) ----
    uint32_t treeify = 8;      // H1: a chain longer than this becomes a red-black tree
    uint32_t untreeify = 4;    // H1: a tree that shrinks to this size or less reverts to a list
    size_t   window = 8;       // H2: linear-probe window before a key spills to the overflow chain
    int      bucket = 4;       // H3: slots per cuckoo bucket
    size_t   stash = 4;        // H3: stash capacity
    int      maxkick = 200;    // H3: longest displacement chain tried before using the stash
};

class SymbolTable {
protected:
    HashFn H; bool autoResize; double maxLoad;
    void recI(u64 p) { stats.insertProbes += p; stats.lastProbes = p; if (p > stats.maxInsertProbes) stats.maxInsertProbes = p; }
    void recL(u64 p) { stats.lookups++; stats.lookupProbes += p; stats.lastProbes = p; if (p > stats.maxLookupProbes) stats.maxLookupProbes = p; }
public:
    Stats stats;
    explicit SymbolTable(const TableOptions &o) : H(o.hash), autoResize(o.auto_resize), maxLoad(o.max_load) {}
    virtual ~SymbolTable() {}
    virtual int insert(const Symbol &s) = 0;                 // INSERT_OK / INSERT_EXISTS (updated) / INSERT_FAILED
    virtual const Symbol *lookup(const std::string &name) = 0;
    virtual bool erase(const std::string &name) = 0;
    virtual size_t size() const = 0;
    virtual size_t capacity() const = 0;
    virtual size_t memoryBytes() const = 0;                  // table structure only (key-string heap is identical for all)
    double load_factor() const { return (double)size() / (double)capacity(); }
};

std::unique_ptr<SymbolTable> symtab_create(Strategy strat, const TableOptions &opt);

/* ---------- block-structured scopes on top of ANY strategy ----------
   Keys are mangled as name@depth; resolve() walks scopes inner -> outer;
   exit_scope() erases every name declared in the scope (exercises deletion). */
class ScopedSymbolTable {
    SymbolTable &t; std::vector<std::vector<std::string>> scopes;
public:
    explicit ScopedSymbolTable(SymbolTable &tb) : t(tb) {}
    int depth() const { return (int)scopes.size() - 1; }
    void enter_scope() { scopes.emplace_back(); }
    void exit_scope();
    void declare(const std::string &name, int type, int line);
    const Symbol *resolve(const std::string &name);
};

/* ---------- alternative scope design: ONE entry per plain name + a shadow chain ----------
   The conventional compiler design: the hash table is keyed by the plain name and holds the innermost visible
   declaration; each declaration remembers the declaration it shadows (prev). resolve() is ONE table lookup;
   exit_scope() pops the scope's declarations and restores the shadowed ones (or erases the name). */
class ShadowScopedSymbolTable {
    SymbolTable &t;
    struct Decl { Symbol s; int prev; };
    std::vector<Decl> decls; std::vector<size_t> starts;
public:
    explicit ShadowScopedSymbolTable(SymbolTable &tb) : t(tb) {}
    int depth() const { return (int)starts.size() - 1; }
    void enter_scope() { starts.push_back(decls.size()); }
    void exit_scope();
    void declare(const std::string &name, int type, int line);
    const Symbol *resolve(const std::string &name) { return t.lookup(name); }
};

#endif
