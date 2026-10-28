// =============================================================================
//  symtab_cli.cpp  -  scriptable experiment runner for the symbol-table library
//
//  The web lab (lab/index.html) builds an *operation script* describing an experiment and,
//  when the optional local bridge (lab/server.py) is running, sends it to this program so the
//  experiment is executed by the real C++ implementation. The same script can be replayed by the
//  JavaScript engine in the browser; both engines must (and do) report identical probe counts.
//
//  Build :  g++ -O2 -std=c++17 -o symtab_cli symtab.cpp symtab_cli.cpp
//  Usage :  symtab_cli --version            (prints engine info as JSON)
//           symtab_cli < script.txt          (runs a script, prints JSON on stdout)
//
//  Script format (one command per line, whitespace separated, keys contain no spaces):
//      CFG strategies=0,1,2 hash=djb2 capacity=1031 resize=1 maxload=0.7
//          treeify=8 untreeify=4 window=8 bucket=4 stash=4 maxkick=200
//      PHASE <name> <reps>          start a measured phase; its operations are replayed <reps> times
//      I  <key>                     insert (remembered as insert #0, #1, ... for LI / DI)
//      LI <k>                       look up the key of insert #k (skipped if that insert failed)
//      DI <k>                       erase  the key of insert #k (skipped if that insert failed)
//      L  <key>                     look up an arbitrary key          D <key>   erase an arbitrary key
//      SE / SX                      enter / exit a block scope        SD <key>  declare in scope
//      SR <key>                     resolve a name through the scope chain (inner -> outer)
//
//  Every phase reports its own counters (the statistics are reset at the start of a phase), so the
//  caller can derive average / maximum probes and ns per operation for inserts, hits, misses, deletes.
// =============================================================================
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

#include "symtab.h"
using namespace std;

enum OpType { OP_I, OP_LI, OP_DI, OP_L, OP_D, OP_SE, OP_SX, OP_SD, OP_SR };
struct Op { OpType t; string key; long idx; };
struct PhaseDef { string name; int reps; vector<Op> ops; };

struct PhaseOut {
    string name; int reps = 1; u64 ops = 0; double ms = 0;
    u64 inserts = 0, insertProbes = 0, maxInsertProbes = 0, lookups = 0, lookupProbes = 0, maxLookupProbes = 0;
    u64 found = 0, failed = 0, collisions = 0, resizes = 0, size = 0, capacity = 0, memory = 0;
};

static vector<string> split(const string &s, char d) {
    vector<string> v; string cur; stringstream ss(s);
    while (getline(ss, cur, d)) v.push_back(cur);
    return v;
}

static bool parseOp(const string &line, Op &op) {
    istringstream is(line); string c, k; is >> c; if (c.empty()) return false;
    if (c == "SE") { op = {OP_SE, "", 0}; return true; }
    if (c == "SX") { op = {OP_SX, "", 0}; return true; }
    if (!(is >> k)) return false;
    if (c == "I") op = {OP_I, k, 0};
    else if (c == "L") op = {OP_L, k, 0};
    else if (c == "D") op = {OP_D, k, 0};
    else if (c == "SD") op = {OP_SD, k, 0};
    else if (c == "SR") op = {OP_SR, k, 0};
    else if (c == "LI") op = {OP_LI, "", atol(k.c_str())};
    else if (c == "DI") op = {OP_DI, "", atol(k.c_str())};
    else return false;
    return true;
}

static void runStrategy(Strategy sid, const TableOptions &opt, const vector<PhaseDef> &phases, string &json) {
    auto table = symtab_create(sid, opt);
    SymbolTable &t = *table;
    ScopedSymbolTable scopes(t);
    scopes.enter_scope();                                   // global scope (depth 0) always exists
    struct Ins { string key; bool ok; };
    vector<Ins> ins; int declLine = 0;
    vector<PhaseOut> outs;

    for (const PhaseDef &ph : phases) {
        PhaseOut po; po.name = ph.name; po.reps = ph.reps;
        u64 coll0 = t.stats.collisions, res0 = t.stats.resizes, fail0 = t.stats.failed;
        t.stats.inserts = t.stats.insertProbes = t.stats.maxInsertProbes = 0;
        t.stats.lookups = t.stats.lookupProbes = t.stats.maxLookupProbes = 0;
        auto t0 = chrono::steady_clock::now();
        for (int rep = 0; rep < ph.reps; rep++) {
            for (const Op &op : ph.ops) {
                switch (op.t) {
                    case OP_I: { int r = t.insert(Symbol{op.key, 0, 0, (int)ins.size()}); ins.push_back({op.key, r != INSERT_FAILED}); if (r == INSERT_OK) po.found++; po.ops++; break; }
                    case OP_LI: if (op.idx >= 0 && (size_t)op.idx < ins.size() && ins[op.idx].ok) { if (t.lookup(ins[op.idx].key)) po.found++; po.ops++; } break;
                    case OP_DI: if (op.idx >= 0 && (size_t)op.idx < ins.size() && ins[op.idx].ok) { if (t.erase(ins[op.idx].key)) po.found++; po.ops++; } break;
                    case OP_L: if (t.lookup(op.key)) po.found++; po.ops++; break;
                    case OP_D: if (t.erase(op.key)) po.found++; po.ops++; break;
                    case OP_SE: scopes.enter_scope(); po.ops++; break;
                    case OP_SX: if (scopes.depth() > 0) scopes.exit_scope(); po.ops++; break;
                    case OP_SD: scopes.declare(op.key, 0, declLine++); po.found++; po.ops++; break;
                    case OP_SR: if (scopes.resolve(op.key)) po.found++; po.ops++; break;
                }
            }
        }
        auto t1 = chrono::steady_clock::now();
        po.ms = chrono::duration<double, milli>(t1 - t0).count();
        po.inserts = t.stats.inserts; po.insertProbes = t.stats.insertProbes; po.maxInsertProbes = t.stats.maxInsertProbes;
        po.lookups = t.stats.lookups; po.lookupProbes = t.stats.lookupProbes; po.maxLookupProbes = t.stats.maxLookupProbes;
        po.collisions = t.stats.collisions - coll0; po.resizes = t.stats.resizes - res0; po.failed = t.stats.failed - fail0;
        po.size = t.size(); po.capacity = t.capacity(); po.memory = t.memoryBytes();
        outs.push_back(po);
    }

    char buf[640];
    json += "{\"strategy\":" + to_string((int)sid) + ",\"name\":\"" + strategy_names[sid] + "\",\"kind\":\"" + strategy_kind[sid] + "\",\"phases\":[";
    for (size_t i = 0; i < outs.size(); i++) {
        const PhaseOut &p = outs[i];
        snprintf(buf, sizeof buf,
                 "%s{\"name\":\"%s\",\"reps\":%d,\"ops\":%llu,\"ms\":%.6f,\"inserts\":%llu,\"insertProbes\":%llu,\"maxInsertProbes\":%llu,"
                 "\"lookups\":%llu,\"lookupProbes\":%llu,\"maxLookupProbes\":%llu,\"found\":%llu,\"failed\":%llu,\"collisions\":%llu,"
                 "\"resizes\":%llu,\"size\":%llu,\"capacity\":%llu,\"memory\":%llu}",
                 i ? "," : "", p.name.c_str(), p.reps, (unsigned long long)p.ops, p.ms, (unsigned long long)p.inserts, (unsigned long long)p.insertProbes,
                 (unsigned long long)p.maxInsertProbes, (unsigned long long)p.lookups, (unsigned long long)p.lookupProbes, (unsigned long long)p.maxLookupProbes,
                 (unsigned long long)p.found, (unsigned long long)p.failed, (unsigned long long)p.collisions, (unsigned long long)p.resizes,
                 (unsigned long long)p.size, (unsigned long long)p.capacity, (unsigned long long)p.memory);
        json += buf;
    }
    json += "]}";
}

int main(int argc, char **argv) {
    if (argc > 1 && string(argv[1]) == "--version") {
        printf("{\"engine\":\"cpp\",\"standard\":%ld,\"sizeof_symbol\":%zu,\"strategies\":[", (long)__cplusplus, sizeof(Symbol));
        for (int i = 0; i < STRAT_COUNT; i++) printf("%s\"%s\"", i ? "," : "", strategy_names[i]);
        printf("]}\n"); return 0;
    }
    ios::sync_with_stdio(false);
    vector<int> sids; TableOptions opt; vector<PhaseDef> phases; string line; bool haveCfg = false;
    while (getline(cin, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.empty()) continue;
        if (line.compare(0, 4, "CFG ") == 0) {
            haveCfg = true; opt.auto_resize = true;
            for (const string &kv : split(line.substr(4), ' ')) {
                size_t e = kv.find('='); if (e == string::npos) continue;
                string k = kv.substr(0, e), v = kv.substr(e + 1);
                if (k == "strategies") { for (const string &x : split(v, ',')) { int id = atoi(x.c_str()); if (id >= 0 && id < STRAT_COUNT) sids.push_back(id); } }
                else if (k == "hash") { bool ok = false; for (auto &h : all_hashes()) if (v == h.name) { opt.hash = h.fn; ok = true; } if (!ok) { fprintf(stderr, "unknown hash %s\n", v.c_str()); return 1; } }
                else if (k == "capacity") opt.capacity = (size_t)strtoull(v.c_str(), nullptr, 10);
                else if (k == "resize") opt.auto_resize = v != "0";
                else if (k == "maxload") opt.max_load = atof(v.c_str());
                else if (k == "treeify") opt.treeify = (uint32_t)atoi(v.c_str());
                else if (k == "untreeify") opt.untreeify = (uint32_t)atoi(v.c_str());
                else if (k == "window") opt.window = (size_t)atol(v.c_str());
                else if (k == "bucket") opt.bucket = atoi(v.c_str());
                else if (k == "stash") opt.stash = (size_t)atol(v.c_str());
                else if (k == "maxkick") opt.maxkick = atoi(v.c_str());
            }
        } else if (line.compare(0, 6, "PHASE ") == 0) {
            istringstream is(line.substr(6)); PhaseDef p; p.reps = 1; is >> p.name >> p.reps; if (p.reps < 1) p.reps = 1; phases.push_back(p);
        } else {
            Op op; if (!phases.empty() && parseOp(line, op)) phases.back().ops.push_back(op);
        }
    }
    if (!haveCfg || sids.empty()) { fprintf(stderr, "script needs a CFG line with strategies=...\n"); return 1; }
    if (opt.capacity < 3) opt.capacity = 3;
    string json = "{\"engine\":\"cpp\",\"results\":[";
    for (size_t i = 0; i < sids.size(); i++) { if (i) json += ","; runStrategy((Strategy)sids[i], opt, phases, json); }
    json += "]}\n";
    fputs(json.c_str(), stdout);
    return 0;
}
