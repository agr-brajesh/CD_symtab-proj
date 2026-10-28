// Node test-suite for lab/src/engine.js
//  1. hash functions vs independent BigInt reference implementations
//  2. JS engine vs the real C++ binary (symtab_cli) on identical operation scripts: every counter must match
//  3. engine-only correctness checks (differential fuzz vs Map)
'use strict';
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const E = require('../src/engine.js');
const ROOT = path.resolve(__dirname, '..', '..');
let fails = 0, checks = 0;
const check = (c, msg) => { checks++; if (!c) { fails++; if (fails <= 25) console.log('  FAIL:', msg); } };

/* ---------- 1. BigInt reference hashes ---------- */
const M = (1n << 64n) - 1n;
const ref = {
  djb2: s => { let h = 5381n; for (const c of Buffer.from(s)) h = (h * 33n + BigInt(c)) & M; return h; },
  fnv1a: s => { let h = 0xcbf29ce484222325n; for (const c of Buffer.from(s)) { h ^= BigInt(c); h = (h * 0x100000001b3n) & M; } return h; },
  sdbm: s => { let h = 0n; for (const c of Buffer.from(s)) h = (BigInt(c) + (h << 6n) + (h << 16n) - h) & M; return h; },
  pjw: s => { let h = 0n; for (const c of Buffer.from(s)) { h = ((h << 4n) + BigInt(c)) & 0xffffffffn; const g = h & 0xF0000000n; if (g) h ^= g >> 24n; h &= ~g & 0xffffffffn; } return h; },
  sum: s => { let h = 0n; for (const c of Buffer.from(s)) h += BigInt(c); return h & M; },
};
const refMix = x => { x = (x + 0x9e3779b97f4a7c15n) & M; x = ((x ^ (x >> 30n)) * 0xbf58476d1ce4e5b9n) & M; x = ((x ^ (x >> 27n)) * 0x94d049bb133111ebn) & M; return x ^ (x >> 31n); };
const refSeeded = (s, seed) => { let h = 0xcbf29ce484222325n ^ seed; for (const c of Buffer.from(s)) { h ^= BigInt(c); h = (h * 0x100000001b3n) & M; } return refMix(h); };
(function testHashes() {
  console.log('[1] hash functions vs BigInt reference');
  const r = E.makeRng(99);
  const keys = ['', 'a', 'abc', 'foobar', 'x'.repeat(40), 'Zz9_'.repeat(9)];
  for (let i = 0; i < 3000; i++) keys.push(E.genIdent(r, 1, 45));
  for (const h of E.HASH_NAMES) for (const k of keys) {
    const got = E.hashHex(h, k), want = ref[h](k).toString(16).padStart(16, '0');
    check(got === want, `${h}("${k}") ${got} != ${want}`);
    for (const m of [3, 31, 1031, 10007, 99991, 5000011]) check(E.hashMod(h, k, m) === Number(ref[h](k) % BigInt(m)), `${h} mod ${m} of ${k}`);
  }
  check(E.hashHex('fnv1a', 'a') === 'af63dc4c8601ec8c', 'FNV-1a-64 official test vector for "a"');
  const I = E._internals;
  for (const k of keys.slice(0, 500)) for (const seed of [0n, 12345n, 0xdeadbeefcafef00dn]) {
    I.fnvSeeded(k, Number(seed >> 32n), Number(seed & 0xffffffffn)); const [hi, lo] = I.reg();
    check((BigInt(hi) << 32n | BigInt(lo)) === refSeeded(k, seed), `fnvSeeded(${k}, ${seed})`);
  }
  let v = E.fnv32('hello'); check(v === 0x4f9f2cab, 'fnv32("hello") = ' + v.toString(16));
})();

/* ---------- 2. JS vs C++ ---------- */
const CLI = path.join(ROOT, 'symtab_cli');
function runCpp(sids, opts, phases) {
  const out = execFileSync(CLI, [], { input: E.scriptToText(sids, opts, phases), maxBuffer: 1 << 28 });
  return JSON.parse(out.toString());
}
const FIELDS = ['reps', 'ops', 'inserts', 'insertProbes', 'maxInsertProbes', 'lookups', 'lookupProbes', 'maxLookupProbes', 'found', 'failed', 'collisions', 'resizes', 'size', 'capacity', 'memory'];
let compared = 0;
function compare(label, sids, opts, phases) {
  const js = E.runScript(sids, opts, phases), cpp = runCpp(sids, opts, phases);
  check(js.results.length === cpp.results.length, label + ': result count');
  for (let i = 0; i < js.results.length; i++) {
    const a = js.results[i], b = cpp.results[i];
    for (let p = 0; p < a.phases.length; p++) for (const f of FIELDS) {
      compared++;
      if (a.phases[p][f] !== b.phases[p][f]) check(false, `${label} | ${a.name} | phase ${a.phases[p].name} | ${f}: js=${a.phases[p][f]} cpp=${b.phases[p][f]}`);
      else checks++;
    }
  }
}
function scopePhase(pool, r, rounds) {
  const pairs = [];
  let depth = 0;
  for (let i = 0; i < rounds; i++) {
    const act = r() % 10;
    if (act < 2 && depth < 6) { pairs.push([E.OP.SE]); depth++; }
    else if (act < 4 && depth > 0) { pairs.push([E.OP.SX]); depth--; }
    else if (act < 7) pairs.push([E.OP.SD, pool[r() % pool.length]]);
    else pairs.push([E.OP.SR, pool[r() % pool.length]]);
  }
  while (depth-- > 0) pairs.push([E.OP.SX]);
  return { name: 'scopes', reps: 1, ops: E.mkOps(pairs) };
}
(function testCpp() {
  if (!fs.existsSync(CLI)) { console.log('[2] SKIPPED - build symtab_cli first (make)'); return; }
  console.log('[2] JS engine vs C++ binary (identical scripts, all counters must match)');
  const all = [0, 1, 2, 3, 4, 5, 6, 7];
  const r = E.makeRng(2024);
  const wl = {
    random: n => E.uniqueRandom(n, E.makeRng(5)),
    sequential: n => E.genSequential(n),
    code: n => E.genCodeLike(n, E.makeRng(6)),
  };
  const cases = [];
  for (const h of E.HASH_NAMES) {
    cases.push({ l: `fixed lf0.6 ${h}`, o: { capacity: 2003, hash: h, autoResize: false }, w: 'random', n: 1200 });
    cases.push({ l: `fixed lf0.95 ${h}`, o: { capacity: 2003, hash: h, autoResize: false }, w: 'sequential', n: 1900 });
    cases.push({ l: `grow ${h}`, o: { capacity: 31, hash: h, autoResize: true, maxLoad: 0.7 }, w: 'code', n: 1500 });
  }
  cases.push({ l: 'grow maxload0.5', o: { capacity: 101, autoResize: true, maxLoad: 0.5 }, w: 'random', n: 2500 });
  cases.push({ l: 'grow maxload0.9', o: { capacity: 101, autoResize: true, maxLoad: 0.9 }, w: 'random', n: 2500 });
  cases.push({ l: 'fixed cap 7', o: { capacity: 7, autoResize: false }, w: 'random', n: 7 });
  cases.push({ l: 'hybrid treeify2', o: { capacity: 211, autoResize: false, treeify: 2, untreeify: 1, hash: 'sum' }, w: 'code', n: 400 });
  cases.push({ l: 'hybrid treeify16', o: { capacity: 211, autoResize: true, treeify: 16, untreeify: 8, hash: 'sum' }, w: 'sequential', n: 1500 });
  cases.push({ l: 'hybrid window1', o: { capacity: 503, autoResize: false, window: 1 }, w: 'random', n: 450 });
  cases.push({ l: 'hybrid window32', o: { capacity: 503, autoResize: false, window: 32, hash: 'sum' }, w: 'sequential', n: 450 });
  cases.push({ l: 'hybrid bucket1 stash0', o: { capacity: 503, autoResize: false, bucket: 1, stash: 0, maxkick: 10 }, w: 'random', n: 300 });
  cases.push({ l: 'hybrid bucket2 stash1', o: { capacity: 503, autoResize: false, bucket: 2, stash: 1, maxkick: 30 }, w: 'random', n: 430 });
  cases.push({ l: 'hybrid bucket8 stash8', o: { capacity: 503, autoResize: true, bucket: 8, stash: 8, maxkick: 500 }, w: 'code', n: 1200 });
  cases.push({ l: 'cuckoo grow tiny', o: { capacity: 3, autoResize: true, bucket: 1, stash: 0, maxkick: 8 }, w: 'random', n: 600 });
  for (const c of cases) {
    const keys = wl[c.w](c.n), misses = E.makeMisses(keys, E.makeRng(11));
    const phases = E.buildBenchmarkPhases(keys, misses, { seed: 3, hitReps: 2, missReps: 1, deleteFraction: 0.5 });
    phases.push(scopePhase(keys.slice(0, 300), r, 4000));
    compare(c.l, all, c.o, phases);
  }
  // colliding keys (adversarial)
  { const m = E.nextPrime(1031), g = E.genColliding(150, E.makeRng(3), 'djb2', m, 2e6);
    check(g.found === 150, 'colliding generator found ' + g.found);
    for (const k of g.keys) check(E.hashMod('djb2', k, m) === g.target, 'collides ' + k);
    const phases = E.buildBenchmarkPhases(g.keys, E.makeMisses(g.keys, E.makeRng(2)), { seed: 1, hitReps: 1 });
    compare('adversarial djb2', all, { capacity: 1031, autoResize: false, hash: 'djb2' }, phases);
    compare('adversarial djb2 resize', all, { capacity: 1031, autoResize: true, hash: 'djb2' }, phases); }
  console.log(`    ${compared} counters compared between JS and C++`);
})();

/* ---------- 3. engine-only fuzz vs Map (also with trace enabled) ---------- */
(function testFuzz() {
  console.log('[3] JS engine differential fuzz vs Map (trace on)');
  const r = E.makeRng(77);
  const optsList = [{ capacity: 7, autoResize: true }, { capacity: 211, autoResize: false },
    { capacity: 23, autoResize: true, treeify: 2, untreeify: 1, window: 1, bucket: 1, stash: 0, maxkick: 5 }];
  let ops = 0;
  for (let s = 0; s < 8; s++) for (const h of E.HASH_NAMES) for (const o0 of optsList) {
    const o = Object.assign({ hash: h }, o0), t = E.createTable(s, o); t.tr = []; const ref = new Map();
    const ks = o0.autoResize ? 700 : 140;
    for (let i = 0; i < 2500; i++) {
      t.tr.length = 0; const k = 'k' + (r() % ks), op = r() % 10; ops++;
      if (op < 5) { const res = t.insert({ name: k, type: 0, scope: 0, line: i }); if (res === E.INSERT_FAILED) { check(!o0.autoResize, 'FAILED in resize mode'); continue; } check((res === E.INSERT_EXISTS) === ref.has(k), `${s}/${h} insert status`); ref.set(k, i); }
      else if (op < 8) { const p = t.lookup(k); check((p !== null) === ref.has(k) && (!p || p.line === ref.get(k)), `${s}/${h} lookup ${k}`); }
      else { check(t.erase(k) === ref.delete(k), `${s}/${h} erase`); }
      if (t.size() !== ref.size) { check(false, `${s}/${h} size ${t.size()} vs ${ref.size}`); break; }
    }
    for (const [k] of ref) if (!t.lookup(k)) { check(false, `${s}/${h} lost ${k}`); break; }
    t.snapshot();
  }
  console.log(`    ${ops} random operations`);
})();

console.log(`\n${checks} checks, ${fails} failed -> ${fails ? 'FAILED' : 'ALL ENGINE TESTS PASSED'}`);
process.exit(fails ? 1 : 0);
