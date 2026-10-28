/* =============================================================================
   engine.js - JavaScript port of the C++ symbol-table library (source/symtab.cpp)

   * Same 8 strategies, same hash functions (64-bit arithmetic emulated on 32-bit halves),
     same probe-counting rules, same resize policies, same deterministic PRNG for cuckoo.
   * A script of operations (the format understood by source/symtab_cli.cpp) produces IDENTICAL
     probe/collision/resize/memory numbers in this engine and in the C++ binary; timing differs.
   * Works in the browser (global SymEngine) and in Node (module.exports) for the test-suite.
   ============================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SymEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const TWO32 = 4294967296;
const INSERT_FAILED = -1, INSERT_EXISTS = 0, INSERT_OK = 1;

/* ------------------------------------------------------------------ 64-bit helpers
   A u64 is held as two uint32 halves in the module registers HI / LO (no allocation). */
let HI = 0, LO = 0, MH = 0, ML = 0;

function umul32(a, b) {                       // 32x32 -> 64-bit product in (MH, ML)
  const a0 = a & 0xffff, a1 = a >>> 16, b0 = b & 0xffff, b1 = b >>> 16;
  const p00 = a0 * b0, p01 = a0 * b1, p10 = a1 * b0, p11 = a1 * b1;
  const mid = p01 + p10 + (p00 >>> 16);
  ML = (((mid & 0xffff) << 16) | (p00 & 0xffff)) >>> 0;
  MH = (p11 + Math.floor(mid / 65536)) >>> 0;
}
function mul64(hi, lo, chi, clo) {            // low 64 bits of (hi:lo) * (chi:clo) -> HI/LO
  umul32(lo, clo);
  HI = (MH + Math.imul(hi, clo) + Math.imul(lo, chi)) >>> 0; LO = ML;
}
function mix64(hi, lo) {                      // splitmix64 finalizer applied to (hi:lo) -> HI/LO
  let l = lo + 0x7f4a7c15; const c = l >= TWO32 ? 1 : 0;
  lo = l >>> 0; hi = (hi + 0x9e3779b9 + c) >>> 0;
  let sl = ((lo >>> 30) | (hi << 2)) >>> 0, sh = hi >>> 30;
  lo = (lo ^ sl) >>> 0; hi = (hi ^ sh) >>> 0;
  mul64(hi, lo, 0xbf58476d, 0x1ce4e5b9); hi = HI; lo = LO;
  sl = ((lo >>> 27) | (hi << 5)) >>> 0; sh = hi >>> 27;
  lo = (lo ^ sl) >>> 0; hi = (hi ^ sh) >>> 0;
  mul64(hi, lo, 0x94d049bb, 0x133111eb); hi = HI; lo = LO;
  sl = ((lo >>> 31) | (hi << 1)) >>> 0; sh = hi >>> 31;
  HI = (hi ^ sh) >>> 0; LO = (lo ^ sl) >>> 0;
}
function reduce(m) {                          // (HI:LO) mod m, exact for m < 9.4e7
  return ((HI % m) * (TWO32 % m) + (LO % m)) % m;
}

/* ------------------------------------------------------------------ hash functions */
function h_djb2(s) {                          // h = h*33 + c
  let hi = 0, lo = 5381;
  for (let i = 0; i < s.length; i++) {
    const nhi = ((hi << 5) | (lo >>> 27)) >>> 0, nlo = (lo << 5) >>> 0;
    const l = nlo + lo + s.charCodeAt(i);
    hi = (nhi + hi + Math.floor(l / TWO32)) >>> 0; lo = l >>> 0;
  }
  HI = hi; LO = lo;
}
function fnvCore(s, hi, lo) {                 // 64-bit FNV-1a loop, prime 0x100000001b3 = 2^40 + 0x1b3
  for (let i = 0; i < s.length; i++) {
    lo = (lo ^ (s.charCodeAt(i) & 255)) >>> 0;
    const x = lo * 435, carry = Math.floor(x / TWO32);
    hi = (hi * 435 + carry + ((lo << 8) >>> 0)) >>> 0;
    lo = x - carry * TWO32;
  }
  HI = hi; LO = lo;
}
function h_fnv1a(s) { fnvCore(s, 0xcbf29ce4, 0x84222325); }
function h_sdbm(s) {                          // h = c + (h<<6) + (h<<16) - h
  let hi = 0, lo = 0;
  for (let i = 0; i < s.length; i++) {
    const ahi = ((hi << 6) | (lo >>> 26)) >>> 0, alo = (lo << 6) >>> 0;
    const bhi = ((hi << 16) | (lo >>> 16)) >>> 0, blo = (lo << 16) >>> 0;
    const l = s.charCodeAt(i) + alo + blo - lo, carry = Math.floor(l / TWO32);
    hi = (ahi + bhi - hi + carry) >>> 0; lo = (l - carry * TWO32) >>> 0;
  }
  HI = hi; LO = lo;
}
function h_pjw(s) {                           // PJW / ELF, 32-bit
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 4) + s.charCodeAt(i)) >>> 0;
    const g = (h & 0xF0000000) >>> 0;
    if (g) h = (h ^ (g >>> 24)) >>> 0;
    h = (h & ~g) >>> 0;
  }
  HI = 0; LO = h;
}
function h_sum(s) { let h = 0; for (let i = 0; i < s.length; i++) h += s.charCodeAt(i); HI = Math.floor(h / TWO32); LO = h >>> 0; }

function fnv32(s) {                           // secondary hash for double hashing
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h = (h ^ (s.charCodeAt(i) & 255)) >>> 0; h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
function fnvSeeded(s, seedHi, seedLo) {       // independent hash for cuckoo's 2nd bucket
  fnvCore(s, (0xcbf29ce4 ^ seedHi) >>> 0, (0x84222325 ^ seedLo) >>> 0);
  mix64(HI, LO);
}

const HASHES = {
  djb2:  { name: 'djb2',  fn: h_djb2,  desc: 'h = h*33 + c (Bernstein)' },
  fnv1a: { name: 'fnv1a', fn: h_fnv1a, desc: '64-bit FNV-1a' },
  sdbm:  { name: 'sdbm',  fn: h_sdbm,  desc: 'h = c + (h<<6) + (h<<16) - h' },
  pjw:   { name: 'pjw',   fn: h_pjw,   desc: 'PJW / ELF hash (32-bit)' },
  sum:   { name: 'sum',   fn: h_sum,   desc: 'sum of characters (deliberately weak)' },
};
const HASH_NAMES = Object.keys(HASHES);
function hashMod(name, key, m) { HASHES[name].fn(key); return reduce(m); }
function hashHex(name, key) {                 // full 64-bit value as hex string (tests / UI)
  HASHES[name].fn(key);
  return (HI >>> 0).toString(16).padStart(8, '0') + (LO >>> 0).toString(16).padStart(8, '0');
}

function isPrime(n) { if (n < 2) return false; for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; }
function nextPrime(n) { if (n < 3) return 3; if (n % 2 === 0) n++; while (!isPrime(n)) n += 2; return n; }

/* ------------------------------------------------------------------ strategies metadata */
const STRATEGIES = [
  { id: 0, name: 'Separate Chaining',        short: 'Chaining',   kind: 'classic', color: '#1f77b4', desc: 'Every bucket is a linked list; colliding keys are pushed onto the list.' },
  { id: 1, name: 'Linear Probing',           short: 'Linear',     kind: 'classic', color: '#d62728', desc: 'On a collision try the next slot (+1). Simple and cache friendly, but forms primary clusters.' },
  { id: 2, name: 'Quadratic Probing',        short: 'Quadratic',  kind: 'classic', color: '#ff7f0e', desc: 'Probe index + i^2. Breaks primary clustering; may not reach every slot once the table is more than half full.' },
  { id: 3, name: 'Double Hashing',           short: 'Double',     kind: 'classic', color: '#2ca02c', desc: 'Step size comes from a second hash, so different keys follow different probe paths.' },
  { id: 4, name: 'Robin Hood Hashing',       short: 'Robin Hood', kind: 'hybrid',  color: '#9467bd', desc: 'Linear probing where a key that is further from home steals the slot of a richer one; lookups stop early.' },
  { id: 5, name: 'H1: Chaining + Tree',      short: 'H1 Chain+Tree', kind: 'hybrid', color: '#17becf', desc: 'Chaining, but a chain longer than the treeify threshold becomes a red-black tree (O(log n) worst case).' },
  { id: 6, name: 'H2: Open Addr + Overflow', short: 'H2 Open+Overflow', kind: 'hybrid', color: '#8c564b', desc: 'Linear probing inside a bounded window; when the window is full the key spills to an overflow chain.' },
  { id: 7, name: 'H3: Cuckoo + Stash',       short: 'H3 Cuckoo+Stash', kind: 'hybrid', color: '#e377c2', desc: 'Two hash functions and multi-slot buckets; displaced keys are kicked to their other bucket; a small stash absorbs failures.' },
];
const STRAT_COUNT = STRATEGIES.length;

/* ------------------------------------------------------------------ options */
function normOpts(o) {
  o = o || {};
  const num = (v, d) => (v === undefined || v === null || Number.isNaN(+v)) ? d : +v;
  const treeify = Math.max(1, Math.floor(num(o.treeify, 8)));
  return {
    capacity: Math.max(1, Math.floor(num(o.capacity, 1031))),
    hash: typeof o.hash === 'object' && o.hash ? o.hash : (HASHES[o.hash] || HASHES.djb2),
    autoResize: o.autoResize !== false,
    maxLoad: num(o.maxLoad, 0.7),
    treeify, untreeify: Math.min(Math.max(0, Math.floor(num(o.untreeify, 4))), treeify),
    window: Math.max(1, Math.floor(num(o.window, 8))),
    bucket: Math.max(1, Math.floor(num(o.bucket, 4))),
    stash: Math.max(0, Math.floor(num(o.stash, 4))),
    maxkick: Math.max(1, Math.floor(num(o.maxkick, 200))),
  };
}

/* sizeof() values of the C++ structures on a 64-bit GCC build - used for the memory model */
const SZ = { symbol: 48, ptr: 8, node: 56, slot: 56, bucketH1: 24, treeEntry: 112 };

/* ------------------------------------------------------------------ base class */
class SymbolTable {
  constructor(o) {
    this.o = o; this.hf = o.hash.fn; this.autoResize = o.autoResize; this.maxLoad = o.maxLoad;
    this.stats = { inserts: 0, insertProbes: 0, maxInsertProbes: 0, lookups: 0, lookupProbes: 0, maxLookupProbes: 0,
                   lastProbes: 0, collisions: 0, resizes: 0, failed: 0 };
    this.tr = null;                           // when an array: the visualiser collects trace events here
  }
  hm(s, m) { this.hf(s); return reduce(m); }
  recI(p) { const st = this.stats; st.insertProbes += p; st.lastProbes = p; if (p > st.maxInsertProbes) st.maxInsertProbes = p; }
  recL(p) { const st = this.stats; st.lookups++; st.lookupProbes += p; st.lastProbes = p; if (p > st.maxLookupProbes) st.maxLookupProbes = p; }
  loadFactor() { return this.size() / this.capacity(); }
  ev(e) { this.tr.push(e); }
}

/* ============================ 1. Separate chaining ============================ */
class ChainingTable extends SymbolTable {
  constructor(o) { super(o); this.b = new Array(nextPrime(o.capacity)).fill(null); this.n = 0; }
  _grow() {
    const nb = new Array(nextPrime(this.b.length * 2)).fill(null);
    if (this.tr) this.ev({ k: 'resize', from: this.b.length, to: nb.length });
    for (let h of this.b) while (h) { const nx = h.next; const i = this.hm(h.s.name, nb.length); h.next = nb[i]; nb[i] = h; h = nx; }
    this.b = nb; this.stats.resizes++;
  }
  insert(s) {
    const st = this.stats; st.inserts++;
    let i = this.hm(s.name, this.b.length), p = 0;
    if (this.tr && !this.b[i]) this.ev({ k: 'bucket', i, r: 'empty' });
    for (let x = this.b[i]; x; x = x.next) {
      p++; const m = x.s.name === s.name;
      if (this.tr) this.ev({ k: 'node', i, j: p - 1, r: m ? 'match' : 'diff' });
      if (m) { x.s = s; this.recI(p); return INSERT_EXISTS; }
    }
    if (this.autoResize && (this.n + 1) / this.b.length > this.maxLoad) { this._grow(); i = this.hm(s.name, this.b.length); }
    if (this.b[i]) st.collisions++;
    if (this.tr) this.ev({ k: 'place', i, j: 0, note: 'pushed at the head of the chain' });
    this.b[i] = { s, next: this.b[i] }; this.n++; this.recI(p + 1); return INSERT_OK;
  }
  lookup(nm) {
    let p = 0; const i = this.hm(nm, this.b.length);
    if (this.tr && !this.b[i]) this.ev({ k: 'bucket', i, r: 'empty' });
    for (let x = this.b[i]; x; x = x.next) {
      p++; const m = x.s.name === nm;
      if (this.tr) this.ev({ k: 'node', i, j: p - 1, r: m ? 'match' : 'diff' });
      if (m) { this.recL(p); return x.s; }
    }
    this.recL(p); return null;
  }
  erase(nm) {
    const i = this.hm(nm, this.b.length); let prev = null, j = 0;
    if (this.tr && !this.b[i]) this.ev({ k: 'bucket', i, r: 'empty' });
    for (let x = this.b[i]; x; prev = x, x = x.next, j++) {
      const m = x.s.name === nm;
      if (this.tr) this.ev({ k: 'node', i, j, r: m ? 'match' : 'diff' });
      if (m) { if (prev) prev.next = x.next; else this.b[i] = x.next; this.n--; return true; }
    }
    return false;
  }
  size() { return this.n; }
  capacity() { return this.b.length; }
  memoryBytes() { return this.b.length * SZ.ptr + this.n * SZ.node; }
  snapshot() { return { type: 'chain', buckets: this.b.map(h => { const a = []; for (let x = h; x; x = x.next) a.push({ name: x.s.name }); return a; }) }; }
}

/* ======================= 2-4. Open addressing (linear / quadratic / double) ======================= */
const LINEAR = 0, QUADRATIC = 1, DOUBLE = 2;
const EMPTY = 0, FULL = 1, DEL = 2;
class OpenAddrTable extends SymbolTable {
  constructor(mode, o) {
    super(o); this.mode = mode; const c = nextPrime(o.capacity);
    this.st = new Uint8Array(c); this.sy = new Array(c).fill(null); this.used = 0; this.tomb = 0;
    this.maxLoad = Math.min(this.maxLoad, 0.98); this.h0 = 0; this.step = 1; this.p = 0;
  }
  _start(nm, c) { this.h0 = this.hm(nm, c); this.step = this.mode === DOUBLE ? 1 + fnv32(nm) % (c - 1) : 1; }
  _at(i, c) {
    if (this.mode === LINEAR) return (this.h0 + i) % c;
    if (this.mode === QUADRATIC) return (this.h0 + i * i) % c;
    return (this.h0 + i * this.step) % c;
  }
  _limit() { const c = this.st.length; return Math.min(Math.floor(this.maxLoad * c), c - 1); }
  _find(nm) {
    const c = this.st.length; this._start(nm, c); let p = 0;
    for (let i = 0; i < c; i++) {
      const k = this._at(i, c); p++; const s = this.st[k];
      if (this.tr) this.ev({ k: 'slot', i: k, j: i, r: s === EMPTY ? 'empty' : s === DEL ? 'tomb' : (this.sy[k].name === nm ? 'match' : 'diff') });
      if (s === EMPTY) break;
      if (s === FULL && this.sy[k].name === nm) { this.p = p; return k; }
    }
    this.p = p; return -1;
  }
  _rebuild(cap) {
    const nst = new Uint8Array(cap), nsy = new Array(cap).fill(null);
    for (let q = 0; q < this.st.length; q++) if (this.st[q] === FULL) {
      const sym = this.sy[q]; this._start(sym.name, cap); let ok = false;
      for (let i = 0; i < cap; i++) { const k = this._at(i, cap); if (nst[k] === EMPTY) { nst[k] = FULL; nsy[k] = sym; ok = true; break; } }
      if (!ok) return false;
    }
    this.st = nst; this.sy = nsy; this.tomb = 0; return true;
  }
  _regrow(cap) {
    const from = this.st.length; cap = nextPrime(cap);
    while (!this._rebuild(cap)) cap = nextPrime(cap * 2);
    if (this.tr) this.ev({ k: 'resize', from, to: cap });
    this.stats.resizes++;
  }
  _put(d, s, p, coll) {
    if (this.st[d] === DEL) this.tomb--;
    this.st[d] = FULL; this.sy[d] = s; this.used++; this.recI(p); if (coll) this.stats.collisions++;
    if (this.tr) this.ev({ k: 'place', i: d, note: 'stored here' });
    return INSERT_OK;
  }
  insert(s) {
    const stt = this.stats; stt.inserts++;
    if (this.autoResize) { if (this.used + this.tomb + 1 > this._limit()) this._regrow((this.used + 1) * 2 > this._limit() ? this.st.length * 2 : this.st.length); }
    else if (this.used >= this.st.length) { this.recI(this.st.length); stt.failed++; return INSERT_FAILED; }
    const c = this.st.length; this._start(s.name, c); let del = -1, p = 0, coll = false;
    for (let i = 0; i < c; i++) {
      const k = this._at(i, c); p++; const sl = this.st[k];
      if (this.tr) this.ev({ k: 'slot', i: k, j: i, r: sl === EMPTY ? 'empty' : sl === DEL ? 'tomb' : (this.sy[k].name === s.name ? 'match' : 'diff') });
      if (i === 0 && sl === FULL) coll = true;
      if (sl === DEL) { if (del < 0) del = k; continue; }
      if (sl === EMPTY) return this._put(del >= 0 ? del : k, s, p, coll);
      if (this.sy[k].name === s.name) { this.sy[k] = s; this.recI(p); return INSERT_EXISTS; }
    }
    if (del >= 0) return this._put(del, s, p, coll);
    if (this.autoResize) { this._regrow(c * 2); stt.inserts--; return this.insert(s); }
    this.recI(p); stt.failed++; return INSERT_FAILED;
  }
  lookup(nm) { const k = this._find(nm); this.recL(this.p); return k >= 0 ? this.sy[k] : null; }
  erase(nm) {
    const k = this._find(nm); if (k < 0) return false;
    this.st[k] = DEL; this.sy[k] = null; this.used--; this.tomb++;
    if (this.tr) this.ev({ k: 'tomb', i: k }); return true;
  }
  size() { return this.used; }
  capacity() { return this.st.length; }
  memoryBytes() { return this.st.length * SZ.slot; }
  snapshot() { return { type: 'slots', slots: Array.from(this.st, (s, i) => ({ s, name: s === FULL ? this.sy[i].name : null })) }; }
}

/* ======================= 5. Robin Hood ======================= */
class RobinHoodTable extends SymbolTable {
  constructor(o) { super(o); const c = nextPrime(o.capacity); this.dist = new Int32Array(c).fill(-1); this.sy = new Array(c).fill(null); this.n = 0; this.maxLoad = Math.min(this.maxLoad, 0.98); this.p = 0; }
  _put(cur) {
    const c = this.dist.length; let k = this.hm(cur.name, c), d = 0;
    for (;;) {
      if (this.dist[k] < 0) { this.sy[k] = cur; this.dist[k] = d; return; }
      if (this.dist[k] < d) { const ts = this.sy[k]; this.sy[k] = cur; cur = ts; const td = this.dist[k]; this.dist[k] = d; d = td; }
      k = (k + 1) % c; d++;
    }
  }
  _regrow(cap) {
    const od = this.dist, os = this.sy; const nc = nextPrime(cap);
    if (this.tr) this.ev({ k: 'resize', from: od.length, to: nc });
    this.dist = new Int32Array(nc).fill(-1); this.sy = new Array(nc).fill(null);
    for (let i = 0; i < od.length; i++) if (od[i] >= 0) this._put(os[i]);
    this.stats.resizes++;
  }
  _find(nm) {
    const c = this.dist.length; let k = this.hm(nm, c), d = 0, p = 0;
    for (;;) {
      p++; const dk = this.dist[k];
      if (this.tr) this.ev({ k: 'slot', i: k, j: d, r: dk < 0 ? 'empty' : (this.sy[k].name === nm ? 'match' : 'diff'), dist: dk, myDist: d });
      if (dk < 0 || dk < d) { this.p = p; return -1; }
      if (this.sy[k].name === nm) { this.p = p; return k; }
      k = (k + 1) % c; d++; if (d > c) { this.p = p; return -1; }
    }
  }
  insert(s) {
    const stt = this.stats; stt.inserts++; let c = this.dist.length;
    if (this.autoResize) { if (this.n + 1 > Math.min(Math.floor(this.maxLoad * c), c - 1)) { this._regrow(c * 2); c = this.dist.length; } }
    else if (this.n >= c) { this.recI(c); stt.failed++; return INSERT_FAILED; }
    let cur = s, d = 0, k = this.hm(cur.name, c), p = 0, swapped = false; const coll = this.dist[k] >= 0;
    for (;;) {
      p++; const dk = this.dist[k];
      if (this.tr) this.ev({ k: 'slot', i: k, j: d, r: dk < 0 ? 'empty' : (this.sy[k].name === cur.name ? 'match' : 'diff'), dist: dk, myDist: d });
      if (dk < 0) { this.sy[k] = cur; this.dist[k] = d; if (this.tr) this.ev({ k: 'place', i: k, note: 'stored here (distance from home = ' + d + ')' }); break; }
      if (!swapped && dk === d && this.sy[k].name === cur.name) { this.sy[k] = s; this.recI(p); return INSERT_EXISTS; }
      if (dk < d) {
        if (this.tr) this.ev({ k: 'swap', i: k, name: this.sy[k].name, dist: dk, myDist: d });
        const ts = this.sy[k]; this.sy[k] = cur; cur = ts; this.dist[k] = d; d = dk; swapped = true;
      }
      k = (k + 1) % c; d++;
    }
    this.n++; this.recI(p); if (coll) stt.collisions++; return INSERT_OK;
  }
  lookup(nm) { const k = this._find(nm); this.recL(this.p); return k >= 0 ? this.sy[k] : null; }
  erase(nm) {
    const k = this._find(nm); if (k < 0) return false;
    const c = this.dist.length; let i = k;
    for (;;) {
      const nx = (i + 1) % c;
      if (this.dist[nx] <= 0) { this.dist[i] = -1; this.sy[i] = null; break; }
      this.sy[i] = this.sy[nx]; this.dist[i] = this.dist[nx] - 1; i = nx;
      if (this.tr) this.ev({ k: 'shift', i: nx });
    }
    this.n--; return true;
  }
  size() { return this.n; }
  capacity() { return this.dist.length; }
  memoryBytes() { return this.dist.length * SZ.slot; }
  snapshot() { return { type: 'slots', robin: true, slots: Array.from(this.dist, (d, i) => ({ s: d >= 0 ? FULL : EMPTY, name: d >= 0 ? this.sy[i].name : null, dist: d })) }; }
}

/* ======================= H1. Chaining + tree ======================= */
const cmpName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const treeCost = sz => (sz + 1 <= 1 ? 0 : 32 - Math.clz32(sz));     // ceil(log2(sz + 1)) for integers
class ChainTreeTable extends SymbolTable {
  constructor(o) {
    super(o); this.TREEIFY = o.treeify; this.UNTREEIFY = o.untreeify;
    this.b = Array.from({ length: nextPrime(o.capacity) }, () => ({ head: null, len: 0, tree: null })); this.n = 0;
  }
  _sorted(tree) { return Array.from(tree.values()).sort(cmpName); }
  _treeify(k, i) {
    k.tree = new Map(); for (let x = k.head; x; x = x.next) k.tree.set(x.s.name, x.s);
    k.head = null; k.len = 0; if (this.tr) this.ev({ k: 'treeify', i });
  }
  _untreeify(k, i) {
    for (const s of this._sorted(k.tree)) { k.head = { s, next: k.head }; k.len++; }
    k.tree = null; if (this.tr) this.ev({ k: 'untreeify', i });
  }
  _add(k, s, i) {
    if (k.tree) { if (!k.tree.has(s.name)) k.tree.set(s.name, s); return; }
    k.head = { s, next: k.head };
    if (++k.len > this.TREEIFY) this._treeify(k, i);
  }
  _grow() {
    const all = [];
    for (const k of this.b) { if (k.tree) for (const s of this._sorted(k.tree)) all.push(s); for (let x = k.head; x; x = x.next) all.push(x.s); }
    const nb = nextPrime(this.b.length * 2);
    if (this.tr) this.ev({ k: 'resize', from: this.b.length, to: nb });
    this.b = Array.from({ length: nb }, () => ({ head: null, len: 0, tree: null }));
    for (const s of all) { const i = this.hm(s.name, nb); this._add(this.b[i], s, i); }
    this.stats.resizes++;
  }
  insert(s) {
    const st = this.stats; st.inserts++; let p = 0;
    let i = this.hm(s.name, this.b.length), k = this.b[i];
    if (k.tree) {
      p = treeCost(k.tree.size);
      const e = k.tree.get(s.name);
      if (this.tr) this.ev({ k: 'tree', i, j: p, size: k.tree.size, r: e ? 'match' : 'diff' });
      if (e) { k.tree.set(s.name, s); this.recI(p); return INSERT_EXISTS; }
    } else {
      if (this.tr && !k.head) this.ev({ k: 'bucket', i, r: 'empty' });
      for (let x = k.head, j = 0; x; x = x.next, j++) {
        p++; const m = x.s.name === s.name;
        if (this.tr) this.ev({ k: 'node', i, j, r: m ? 'match' : 'diff' });
        if (m) { x.s = s; this.recI(p); return INSERT_EXISTS; }
      }
    }
    if (this.autoResize && (this.n + 1) / this.b.length > this.maxLoad) { this._grow(); i = this.hm(s.name, this.b.length); k = this.b[i]; }
    if (k.tree ? k.tree.size > 0 : k.head !== null) st.collisions++;
    if (this.tr) this.ev({ k: 'place', i, note: k.tree ? 'inserted into the red-black tree' : 'pushed at the head of the chain' });
    this._add(k, s, i); this.n++; this.recI(p + 1); return INSERT_OK;
  }
  lookup(nm) {
    const i = this.hm(nm, this.b.length), k = this.b[i]; let p = 0;
    if (k.tree) {
      p = treeCost(k.tree.size); this.recL(p); const e = k.tree.get(nm);
      if (this.tr) this.ev({ k: 'tree', i, j: p, size: k.tree.size, r: e ? 'match' : 'diff' });
      return e || null;
    }
    if (this.tr && !k.head) this.ev({ k: 'bucket', i, r: 'empty' });
    for (let x = k.head, j = 0; x; x = x.next, j++) {
      p++; const m = x.s.name === nm;
      if (this.tr) this.ev({ k: 'node', i, j, r: m ? 'match' : 'diff' });
      if (m) { this.recL(p); return x.s; }
    }
    this.recL(p); return null;
  }
  erase(nm) {
    const i = this.hm(nm, this.b.length), k = this.b[i];
    if (k.tree) {
      if (this.tr) this.ev({ k: 'tree', i, j: treeCost(k.tree.size), size: k.tree.size, r: k.tree.has(nm) ? 'match' : 'diff' });
      if (!k.tree.delete(nm)) return false; this.n--;
      if (k.tree.size <= this.UNTREEIFY) this._untreeify(k, i); return true;
    }
    let prev = null;
    for (let x = k.head, j = 0; x; prev = x, x = x.next, j++) {
      const m = x.s.name === nm; if (this.tr) this.ev({ k: 'node', i, j, r: m ? 'match' : 'diff' });
      if (m) { if (prev) prev.next = x.next; else k.head = x.next; k.len--; this.n--; return true; }
    }
    return false;
  }
  size() { return this.n; }
  capacity() { return this.b.length; }
  memoryBytes() { let m = this.b.length * SZ.bucketH1; for (const k of this.b) { m += k.len * SZ.node; if (k.tree) m += k.tree.size * SZ.treeEntry; } return m; }
  snapshot() {
    return { type: 'chaintree', treeify: this.TREEIFY, buckets: this.b.map(k => {
      if (k.tree) return { tree: true, names: this._sorted(k.tree).map(s => ({ name: s.name })) };
      const a = []; for (let x = k.head; x; x = x.next) a.push({ name: x.s.name }); return { tree: false, names: a }; }) };
  }
}

/* ======================= H2. Open addressing + overflow chain ======================= */
class OpenOverflowTable extends SymbolTable {
  constructor(o) { super(o); this.L = o.window; this.maxLoad = Math.min(this.maxLoad, 0.98); this._init(nextPrime(o.capacity)); }
  _init(cap) { this.st = new Uint8Array(cap); this.sy = new Array(cap).fill(null); this.ov = new Array(Math.floor(cap / 4) + 1).fill(null); this.used = 0; this.tomb = 0; this.ovN = 0; }
  _win() { return Math.min(this.L, this.st.length); }
  _rawAdd(s) {
    const c = this.st.length; this.hf(s.name); const h0 = reduce(c), oi = reduce(this.ov.length);
    for (let i = 0; i < this._win(); i++) { const k = (h0 + i) % c; if (this.st[k] === EMPTY) { this.st[k] = FULL; this.sy[k] = s; this.used++; return; } }
    this.ov[oi] = { s, next: this.ov[oi] }; this.ovN++;
  }
  _rebuild(cap) {
    const all = [];
    for (let q = 0; q < this.st.length; q++) if (this.st[q] === FULL) all.push(this.sy[q]);
    for (const h of this.ov) for (let x = h; x; x = x.next) all.push(x.s);
    const from = this.st.length; this._init(nextPrime(cap));
    if (this.tr) this.ev({ k: 'resize', from, to: this.st.length });
    for (const s of all) this._rawAdd(s);
    this.stats.resizes++;
  }
  insert(s) {
    const stt = this.stats; stt.inserts++; let c = this.st.length;
    if (this.autoResize) {
      const lim = Math.min(Math.floor(this.maxLoad * c), c - 1);
      if (this.used + this.tomb + this.ovN + 1 > lim) this._rebuild((this.used + this.ovN + 1) * 2 > lim ? c * 2 : c);
    }
    c = this.st.length; this.hf(s.name); const h0 = reduce(c), oi = reduce(this.ov.length);
    const w = this._win(); let del = -1, empty = -1, p = 0;
    for (let i = 0; i < w; i++) {
      const k = (h0 + i) % c; p++; const sl = this.st[k];
      if (this.tr) this.ev({ k: 'slot', i: k, j: i, r: sl === EMPTY ? 'empty' : sl === DEL ? 'tomb' : (this.sy[k].name === s.name ? 'match' : 'diff') });
      if (sl === EMPTY) { empty = k; break; }
      if (sl === DEL) { if (del < 0) del = k; continue; }
      if (this.sy[k].name === s.name) { this.sy[k] = s; this.recI(p); return INSERT_EXISTS; }
    }
    if (empty < 0) {
      let j = 0;
      for (let x = this.ov[oi]; x; x = x.next, j++) {
        p++; const m = x.s.name === s.name;
        if (this.tr) this.ev({ k: 'ov', i: oi, j, r: m ? 'match' : 'diff' });
        if (m) { x.s = s; this.recI(p); return INSERT_EXISTS; }
      }
    }
    const tgt = del >= 0 ? del : empty;
    if (tgt >= 0) {
      if (this.st[h0] === FULL) stt.collisions++;
      if (this.st[tgt] === DEL) this.tomb--;
      this.st[tgt] = FULL; this.sy[tgt] = s; this.used++;
      if (this.tr) this.ev({ k: 'place', i: tgt, note: 'stored inside the probe window' });
    } else {
      stt.collisions++; this.ov[oi] = { s, next: this.ov[oi] }; this.ovN++; p++;
      if (this.tr) this.ev({ k: 'spill', i: oi, note: 'probe window full - spilled to the overflow chain' });
    }
    this.recI(p); return INSERT_OK;
  }
  lookup(nm) {
    const c = this.st.length, w = this._win(); this.hf(nm); const h0 = reduce(c), oi = reduce(this.ov.length);
    let p = 0, full = true;
    for (let i = 0; i < w; i++) {
      const k = (h0 + i) % c; p++; const sl = this.st[k];
      if (this.tr) this.ev({ k: 'slot', i: k, j: i, r: sl === EMPTY ? 'empty' : sl === DEL ? 'tomb' : (this.sy[k].name === nm ? 'match' : 'diff') });
      if (sl === EMPTY) { full = false; break; }
      if (sl === FULL && this.sy[k].name === nm) { this.recL(p); return this.sy[k]; }
    }
    if (full) {
      let j = 0;
      for (let x = this.ov[oi]; x; x = x.next, j++) {
        p++; const m = x.s.name === nm;
        if (this.tr) this.ev({ k: 'ov', i: oi, j, r: m ? 'match' : 'diff' });
        if (m) { this.recL(p); return x.s; }
      }
    }
    this.recL(p); return null;
  }
  erase(nm) {
    const c = this.st.length, w = this._win(); this.hf(nm); const h0 = reduce(c), oi = reduce(this.ov.length); let full = true;
    for (let i = 0; i < w; i++) {
      const k = (h0 + i) % c; const sl = this.st[k];
      if (this.tr) this.ev({ k: 'slot', i: k, j: i, r: sl === EMPTY ? 'empty' : sl === DEL ? 'tomb' : (this.sy[k].name === nm ? 'match' : 'diff') });
      if (sl === EMPTY) { full = false; break; }
      if (sl === FULL && this.sy[k].name === nm) { this.st[k] = DEL; this.sy[k] = null; this.used--; this.tomb++; return true; }
    }
    if (full) {
      let prev = null, j = 0;
      for (let x = this.ov[oi]; x; prev = x, x = x.next, j++) {
        const m = x.s.name === nm; if (this.tr) this.ev({ k: 'ov', i: oi, j, r: m ? 'match' : 'diff' });
        if (m) { if (prev) prev.next = x.next; else this.ov[oi] = x.next; this.ovN--; return true; }
      }
    }
    return false;
  }
  size() { return this.used + this.ovN; }
  capacity() { return this.st.length; }
  memoryBytes() { return this.st.length * SZ.slot + this.ov.length * SZ.ptr + this.ovN * SZ.node; }
  snapshot() {
    return { type: 'slots+ov', window: this.L,
      slots: Array.from(this.st, (s, i) => ({ s, name: s === FULL ? this.sy[i].name : null })),
      overflow: this.ov.map(h => { const a = []; for (let x = h; x; x = x.next) a.push({ name: x.s.name }); return a; }) };
  }
}

/* ======================= H3. Bucketized cuckoo + stash ======================= */
class CuckooStashTable extends SymbolTable {
  constructor(o) {
    super(o); this.B = o.bucket; this.STASH = o.stash; this.MAXKICK = o.maxkick;
    this.nb = Math.max(3, nextPrime(Math.floor(o.capacity / this.B)));
    this.used = new Uint8Array(this.nb * this.B); this.sy = new Array(this.nb * this.B).fill(null);
    this.stash = []; this.n = 0; this.seedHi = 0; this.seedLo = 12345; this.rsHi = 0; this.rsLo = 42;
    this.counting = true; this.placeProbes = 0; this.trail = []; this.fi = -1; this.fs = -1; this.p = 0;
  }
  _rnd() {                                    // splitmix64: output = mix64(state); state += golden gamma
    mix64(this.rsHi, this.rsLo); const oh = HI, ol = LO;
    const l = this.rsLo + 0x7f4a7c15; const c = l >= TWO32 ? 1 : 0;
    this.rsLo = l >>> 0; this.rsHi = (this.rsHi + 0x9e3779b9 + c) >>> 0; HI = oh; LO = ol;
  }
  _b1(s) { return this.hm(s, this.nb); }
  _b2(s) {
    fnvSeeded(s, this.seedHi, this.seedLo); let x = reduce(this.nb);
    const y = this.hm(s, this.nb); if (x === y) x = (x + 1) % this.nb; return x;
  }
  _place(cur) {                               // returns null when placed, else the homeless symbol
    this.trail.length = 0; const B = this.B;
    for (let kick = 0; kick < this.MAXKICK; kick++) {
      const x = this._b1(cur.name), y = this._b2(cur.name);
      for (let q = 0; q < 2; q++) {
        const bk = q === 0 ? x : y;
        for (let j = 0; j < B; j++) {
          this.placeProbes++; const idx = bk * B + j;
          if (this.tr && this.counting) this.ev({ k: 'cslot', i: bk, j, r: this.used[idx] ? 'diff' : 'empty' });
          if (!this.used[idx]) { this.used[idx] = 1; this.sy[idx] = cur; if (this.tr && this.counting) this.ev({ k: 'place', i: bk, j }); return null; }
        }
      }
      this._rnd(); const pickX = (LO & 1) !== 0;
      this._rnd(); const j = reduce(B);
      const idx = (pickX ? x : y) * B + j;
      this.trail.push(idx); const t = this.sy[idx]; this.sy[idx] = cur;
      if (this.tr && this.counting) this.ev({ k: 'kick', i: Math.floor(idx / B), j, name: t.name, by: cur.name });
      cur = t; this.placeProbes++;
      if (this.counting) this.stats.collisions++;
    }
    return cur;
  }
  _undo(cur) {
    for (let i = this.trail.length; i-- > 0;) { const idx = this.trail[i]; const t = this.sy[idx]; this.sy[idx] = cur; cur = t; }
    this.trail.length = 0; return cur;
  }
  _collect() {
    const all = [];
    for (let i = 0; i < this.used.length; i++) if (this.used[i]) all.push(this.sy[i]);
    for (const s of this.stash) all.push(s);
    return all;
  }
  _rebuild(all, newnb) {
    const saved = this.counting; this.counting = false; let tries = 0; const from = this.nb;
    for (;;) {
      this.nb = newnb; this.used = new Uint8Array(this.nb * this.B); this.sy = new Array(this.nb * this.B).fill(null);
      this.stash = []; this._rnd(); this.seedHi = HI; this.seedLo = LO; let ok = true;
      for (const s of all) {
        const left = this._place(s);
        if (left) { if (this.stash.length < this.STASH) this.stash.push(left); else { ok = false; break; } }
      }
      if (ok) break;
      if (++tries % 3 === 0) newnb = this.nb * 2;
    }
    this.counting = saved; this.stats.resizes++;
    if (this.tr) this.ev({ k: 'resize', from: from * this.B, to: this.nb * this.B });
  }
  _findp(nm) {
    let p = 0; const B = this.B, x = this._b1(nm), y = this._b2(nm); this.fi = -1; this.fs = -1;
    for (let q = 0; q < 2; q++) {
      const bk = q === 0 ? x : y;
      for (let j = 0; j < B; j++) {
        p++; const idx = bk * B + j; const hit = this.used[idx] && this.sy[idx].name === nm;
        if (this.tr) this.ev({ k: 'cslot', i: bk, j, r: !this.used[idx] ? 'empty' : hit ? 'match' : 'diff' });
        if (hit) { this.fi = idx; this.p = p; return; }
      }
    }
    for (let i = 0; i < this.stash.length; i++) {
      p++; const hit = this.stash[i].name === nm;
      if (this.tr) this.ev({ k: 'stash', i, r: hit ? 'match' : 'diff' });
      if (hit) { this.fs = i; this.p = p; return; }
    }
    this.p = p;
  }
  insert(s) {
    const st = this.stats; st.inserts++; this._findp(s.name); const p = this.p;
    if (this.fi >= 0) { this.sy[this.fi] = s; this.recI(p); return INSERT_EXISTS; }
    if (this.fs >= 0) { this.stash[this.fs] = s; this.recI(p); return INSERT_EXISTS; }
    if (this.autoResize && (this.n + 1) > this.maxLoad * this.nb * this.B) this._rebuild(this._collect(), this.nb * 2);
    this.placeProbes = 0; let c = this._place(s); const pp = this.placeProbes;
    if (c) {
      if (this.stash.length < this.STASH) { this.stash.push(c); if (this.tr) this.ev({ k: 'stash-add', i: this.stash.length - 1, name: c.name }); }
      else if (this.autoResize) { const all = this._collect(); all.push(c); this._rebuild(all, this.nb * 2); }
      else { this._undo(c); this.recI(p + pp); st.failed++; return INSERT_FAILED; }
    }
    this.n++; this.recI(p + pp); return INSERT_OK;
  }
  lookup(nm) { this._findp(nm); this.recL(this.p); return this.fi >= 0 ? this.sy[this.fi] : this.fs >= 0 ? this.stash[this.fs] : null; }
  erase(nm) {
    const B = this.B, x = this._b1(nm), y = this._b2(nm);
    for (let q = 0; q < 2; q++) {
      const bk = q === 0 ? x : y;
      for (let j = 0; j < B; j++) {
        const idx = bk * B + j; const hit = this.used[idx] && this.sy[idx].name === nm;
        if (this.tr) this.ev({ k: 'cslot', i: bk, j, r: !this.used[idx] ? 'empty' : hit ? 'match' : 'diff' });
        if (hit) { this.used[idx] = 0; this.sy[idx] = null; this.n--; return true; }
      }
    }
    for (let i = 0; i < this.stash.length; i++) if (this.stash[i].name === nm) { this.stash.splice(i, 1); this.n--; return true; }
    return false;
  }
  size() { return this.n; }
  capacity() { return this.nb * this.B; }
  memoryBytes() { return this.used.length * SZ.slot + this.STASH * SZ.symbol; }
  snapshot() {
    const buckets = [];
    for (let b = 0; b < this.nb; b++) { const a = []; for (let j = 0; j < this.B; j++) { const i = b * this.B + j; a.push(this.used[i] ? { name: this.sy[i].name } : null); } buckets.push(a); }
    return { type: 'cuckoo', B: this.B, stashCap: this.STASH, buckets, stash: this.stash.map(s => ({ name: s.name })) };
  }
}

function createTable(sid, opts) {
  const o = normOpts(opts);
  switch (sid) {
    case 0: return new ChainingTable(o);
    case 1: return new OpenAddrTable(LINEAR, o);
    case 2: return new OpenAddrTable(QUADRATIC, o);
    case 3: return new OpenAddrTable(DOUBLE, o);
    case 4: return new RobinHoodTable(o);
    case 5: return new ChainTreeTable(o);
    case 6: return new OpenOverflowTable(o);
    case 7: return new CuckooStashTable(o);
    default: throw new Error('unknown strategy ' + sid);
  }
}

/* ------------------------------------------------------------------ block scopes (same as C++) */
class ScopedSymbolTable {
  constructor(t) { this.t = t; this.scopes = []; }
  depth() { return this.scopes.length - 1; }
  enterScope() { this.scopes.push([]); }
  exitScope() { const sc = this.scopes.pop(); for (const k of sc) this.t.erase(k); }
  declare(name, type, line) { const key = name + '@' + this.depth(); this.t.insert({ name: key, type, scope: this.depth(), line }); this.scopes[this.scopes.length - 1].push(key); }
  resolve(name) { for (let d = this.depth(); d >= 0; d--) { const s = this.t.lookup(name + '@' + d); if (s) return s; } return null; }
}

/* ------------------------------------------------------------------ script runner
   ops of a phase:  { t: Uint8Array of opcodes, k: Array of key-strings | indices }
   opcodes (same order as the C++ enum): I=0 LI=1 DI=2 L=3 D=4 SE=5 SX=6 SD=7 SR=8              */
const OP = { I: 0, LI: 1, DI: 2, L: 3, D: 4, SE: 5, SX: 6, SD: 7, SR: 8 };
const OP_NAMES = ['I', 'LI', 'DI', 'L', 'D', 'SE', 'SX', 'SD', 'SR'];
const now = (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => Date.now();

function runStrategy(sid, opts, phases) {
  const t = createTable(sid, opts), sc = new ScopedSymbolTable(t); sc.enterScope();
  const ins = []; let declLine = 0; const out = [];
  for (const ph of phases) {
    const st = t.stats, c0 = st.collisions, r0 = st.resizes, f0 = st.failed;
    st.inserts = st.insertProbes = st.maxInsertProbes = 0; st.lookups = st.lookupProbes = st.maxLookupProbes = 0;
    let ops = 0, found = 0; const T = ph.ops.t, K = ph.ops.k, n = T.length, reps = ph.reps || 1;
    const t0 = now();
    for (let rep = 0; rep < reps; rep++) {
      for (let q = 0; q < n; q++) {
        switch (T[q]) {
          case 0: { const r = t.insert({ name: K[q], type: 0, scope: 0, line: ins.length }); ins.push({ key: K[q], ok: r !== INSERT_FAILED }); if (r === INSERT_OK) found++; ops++; break; }
          case 1: { const e = ins[K[q]]; if (e && e.ok) { if (t.lookup(e.key)) found++; ops++; } break; }
          case 2: { const e = ins[K[q]]; if (e && e.ok) { if (t.erase(e.key)) found++; ops++; } break; }
          case 3: if (t.lookup(K[q])) found++; ops++; break;
          case 4: if (t.erase(K[q])) found++; ops++; break;
          case 5: sc.enterScope(); ops++; break;
          case 6: if (sc.depth() > 0) sc.exitScope(); ops++; break;
          case 7: sc.declare(K[q], 0, declLine++); found++; ops++; break;
          case 8: if (sc.resolve(K[q])) found++; ops++; break;
        }
      }
    }
    const ms = now() - t0;
    out.push({ name: ph.name, reps, ops, ms, inserts: st.inserts, insertProbes: st.insertProbes, maxInsertProbes: st.maxInsertProbes,
      lookups: st.lookups, lookupProbes: st.lookupProbes, maxLookupProbes: st.maxLookupProbes, found, failed: st.failed - f0,
      collisions: st.collisions - c0, resizes: st.resizes - r0, size: t.size(), capacity: t.capacity(), memory: t.memoryBytes() });
  }
  const S = STRATEGIES[sid];
  return { strategy: sid, name: S.name, kind: S.kind, phases: out };
}
function runScript(sids, opts, phases) { return { engine: 'js', results: sids.map(s => runStrategy(s, opts, phases)) }; }

/* serialise a script in the text format understood by symtab_cli (for the C++ bridge) */
function scriptToText(sids, opts, phases) {
  const o = normOpts(opts);
  const L = ['CFG strategies=' + sids.join(',') + ' hash=' + o.hash.name + ' capacity=' + o.capacity + ' resize=' + (o.autoResize ? 1 : 0) +
    ' maxload=' + o.maxLoad + ' treeify=' + o.treeify + ' untreeify=' + o.untreeify + ' window=' + o.window + ' bucket=' + o.bucket +
    ' stash=' + o.stash + ' maxkick=' + o.maxkick];
  for (const ph of phases) {
    L.push('PHASE ' + ph.name + ' ' + (ph.reps || 1));
    const T = ph.ops.t, K = ph.ops.k;
    for (let q = 0; q < T.length; q++) { const c = OP_NAMES[T[q]]; L.push(T[q] === 5 || T[q] === 6 ? c : c + ' ' + K[q]); }
  }
  return L.join('\n') + '\n';
}
function mkOps(pairs) { const t = new Uint8Array(pairs.length), k = new Array(pairs.length); pairs.forEach((p, i) => { t[i] = p[0]; k[i] = p[1]; }); return { t, k }; }

/* ------------------------------------------------------------------ random keys / workloads */
function makeRng(seed) {                      // mulberry32 -> uint32
  let a = seed >>> 0;
  const f = function () { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0); };
  f.float = () => f() / TWO32;
  return f;
}
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', ALNUM = LETTERS + '0123456789_';
function genIdent(r, minLen = 3, maxLen = 15) {
  const len = minLen + r() % (maxLen - minLen + 1); let s = LETTERS[r() % 52];
  for (let i = 1; i < len; i++) s += ALNUM[r() % 63]; return s;
}
function uniqueRandom(n, r, avoid) { const seen = new Set(), v = []; while (v.length < n) { const s = genIdent(r); if (avoid && avoid.has(s)) continue; if (!seen.has(s)) { seen.add(s); v.push(s); } } return v; }
function genSequential(n) { const v = []; for (let i = 0; i < n; i++) v.push('var' + i); return v; }
const CODE_WORDS = ['buf','len','count','index','tmp','result','node','next','prev','head','tail','size','value','key','data','ptr','flag','state','error','name','type','scope','table','offset'];
function genCodeLike(n, r) {
  const seen = new Set(), v = [];
  // the space of distinct names is finite (24 + 576 + 13824 words x 1000 suffixes x prefix) - stop gracefully
  let guard = n * 50 + 1000;
  while (v.length < n && guard-- > 0) {
    let s = CODE_WORDS[r() % 24]; const parts = r() % 3;
    for (let p = 0; p < parts; p++) s += '_' + CODE_WORDS[r() % 24];
    if (r() % 2) s += (r() % 1000);
    if (r() % 5 === 0) s = 'm_' + s;
    if (!seen.has(s)) { seen.add(s); v.push(s); }
  }
  return v;
}
function makeMisses(keys, r) {                // near-miss "typos", guaranteed absent from keys
  const inn = new Set(keys), seen = new Set(), m = []; let guard = keys.length * 50 + 1000;
  while (m.length < keys.length && guard-- > 0) {
    let s = keys[r() % keys.length]; const pos = r() % s.length;
    s = s.slice(0, pos) + ALNUM[r() % 63] + s.slice(pos + 1);
    if (r() % 3 === 0) s += ALNUM[r() % 63];
    if (!inn.has(s) && !seen.has(s)) { seen.add(s); m.push(s); }
  }
  return m;
}
function shuffled(n, r) { const a = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = r() % (i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
/* keys that all hash to the SAME bucket (mod m) - an adversarial / worst-case input.
   returns { keys, tries, found }; gives up after `budget` hash evaluations. */
function genColliding(n, r, hashName, m, budget) {
  const fn = HASHES[hashName].fn; const target = hashMod(hashName, genIdent(r), m); const out = [], seen = new Set(); let tries = 0;
  budget = budget || 3e6;
  while (out.length < n && tries < budget) { const k = genIdent(r); tries++; fn(k); if (reduce(m) === target && !seen.has(k)) { seen.add(k); out.push(k); } }
  return { keys: out, tries, found: out.length, target };
}

/* ------------------------------------------------------------------ benchmark scripts */
/* cfg: {n, hitReps, missReps, deleteFraction, seed}; keys / misses are arrays of strings */
function buildBenchmarkPhases(keys, misses, cfg) {
  const n = keys.length, r = makeRng((cfg.seed || 1) * 7919 + 13), order = shuffled(n, r);
  const hitReps = cfg.hitReps || 1, missReps = cfg.missReps || 1;
  const nDel = Math.min(n, Math.round(n * (cfg.deleteFraction === undefined ? 0.5 : cfg.deleteFraction)));
  const phases = [
    { name: 'insert', reps: 1, ops: mkOps(keys.map(k => [OP.I, k])) },
    { name: 'hit', reps: hitReps, ops: mkOps(order.map(i => [OP.LI, i])) },
    { name: 'miss', reps: missReps, ops: mkOps(misses.map(k => [OP.L, k])) },
  ];
  if (nDel > 0) {
    phases.push({ name: 'delete', reps: 1, ops: mkOps(order.slice(0, nDel).map(i => [OP.DI, i])) });
    phases.push({ name: 'verify', reps: 1, ops: mkOps(Array.from({ length: n }, (_, i) => [OP.LI, i])) });
    // lookups after the deletions: tombstones / backward-shift / chain unlinking leave different footprints
    if (nDel < n) phases.push({ name: 'hit_after', reps: hitReps, ops: mkOps(order.slice(nDel).map(i => [OP.LI, i])) });
    phases.push({ name: 'miss_after', reps: missReps, ops: mkOps(misses.map(k => [OP.L, k])) });
  }
  return phases;
}

/* turn the raw phase results of ONE strategy into the metrics shown in the UI (+ correctness flag) */
function summarize(res, cfg) {
  const ph = {}; for (const p of res.phases) ph[p.name] = p;
  const ins = ph.insert, hit = ph.hit, miss = ph.miss, del = ph.delete, ver = ph.verify, hitA = ph.hit_after, missA = ph.miss_after;
  const per = (a, b) => (b > 0 ? a / b : 0);
  const okInserts = ins.found; let ok = true;
  if (hit && hit.found !== hit.ops) ok = false;                              // every accepted key must be found
  if (miss && miss.found !== 0) ok = false;                                  // absent keys must never be found
  if (del && ver && ver.found !== okInserts - del.found) ok = false;          // after deleting, the rest is intact
  if (hitA && hitA.found !== hitA.ops) ok = false;
  if (missA && missA.found !== 0) ok = false;
  const m = {
    strategy: res.strategy, name: res.name, kind: res.kind,
    avgInsertProbes: per(ins.insertProbes, ins.inserts), maxInsertProbes: ins.maxInsertProbes,
    avgHitProbes: hit ? per(hit.lookupProbes, hit.lookups) : 0, avgMissProbes: miss ? per(miss.lookupProbes, miss.lookups) : 0,
    maxLookupProbes: Math.max(hit ? hit.maxLookupProbes : 0, miss ? miss.maxLookupProbes : 0),
    collisions: ins.collisions, resizes: ins.resizes, failed: ins.failed,
    loadFactor: ins.size / ins.capacity, size: ins.size, capacity: ins.capacity, bytesPerEntry: per(ins.memory, ins.size),
    insertNs: per(ins.ms * 1e6, ins.ops), hitNs: hit ? per(hit.ms * 1e6, hit.ops) : 0, missNs: miss ? per(miss.ms * 1e6, miss.ops) : 0,
    deleteNs: del ? per(del.ms * 1e6, del.ops) : 0, ok,
    avgHitAfterDel: hitA ? per(hitA.lookupProbes, hitA.lookups) : 0, avgMissAfterDel: missA ? per(missA.lookupProbes, missA.lookups) : 0,
  };
  return m;
}

/* ------------------------------------------------------------------ theory (Knuth) */
const Theory = {
  // expected probes at load factor a; "probe" = slot / node examined, same convention as the engine
  chaining:  { hit: a => 1 + a / 2, miss: a => a },
  linear:    { hit: a => 0.5 * (1 + 1 / (1 - a)), miss: a => 0.5 * (1 + 1 / ((1 - a) * (1 - a))) },
  uniform:   { hit: a => (1 / a) * Math.log(1 / (1 - a)), miss: a => 1 / (1 - a) },       // ideal open addressing / double hashing
  insert(kind, a) { return this[kind].hit(a); },                            // average insert cost while filling up to a == successful-search cost
  poisson(lambda, k) { let lg = -lambda + k * Math.log(lambda); for (let i = 2; i <= k; i++) lg -= Math.log(i); return Math.exp(lg); },
};

/* ------------------------------------------------------------------ hash-distribution analysis */
function analyzeHash(hashName, keys, m) {
  const fn = HASHES[hashName].fn, counts = new Uint32Array(m);
  for (const k of keys) { fn(k); counts[reduce(m)]++; }
  let empty = 0, max = 0, sumsq = 0; const hist = [];
  for (let i = 0; i < m; i++) { const c = counts[i]; if (c === 0) empty++; if (c > max) max = c; hist[c] = (hist[c] || 0) + 1; sumsq += c * c; }
  const n = keys.length, lambda = n / m;
  let chi = 0; for (let i = 0; i < m; i++) chi += (counts[i] - lambda) * (counts[i] - lambda) / (lambda || 1);
  for (let c = 0; c <= max; c++) if (hist[c] === undefined) hist[c] = 0;
  const variance = sumsq / m - lambda * lambda;
  // keys sharing a bucket with at least one other key
  let colliding = 0; for (let i = 0; i < m; i++) if (counts[i] > 1) colliding += counts[i];
  return { hash: hashName, m, n, lambda, counts, hist, empty, emptyPct: empty / m, expectedEmptyPct: Math.exp(-lambda), max, variance, expectedVariance: lambda,
           chi2: chi, chi2Expected: m - 1, chi2Ratio: chi / (m - 1), collidingKeys: colliding };
}

return {
  INSERT_FAILED, INSERT_EXISTS, INSERT_OK, STRATEGIES, STRAT_COUNT, HASHES, HASH_NAMES, OP, OP_NAMES, SZ,
  normOpts, createTable, ScopedSymbolTable, nextPrime, hashMod, hashHex, fnv32, treeCost,
  runStrategy, runScript, scriptToText, mkOps, summarize, buildBenchmarkPhases,
  makeRng, genIdent, uniqueRandom, genSequential, genCodeLike, makeMisses, shuffled, genColliding,
  Theory, analyzeHash,
  _internals: { mix64, mul64, fnvSeeded, h_djb2, h_fnv1a, h_sdbm, h_pjw, h_sum, reg: () => [HI, LO], reduce },
};
});
