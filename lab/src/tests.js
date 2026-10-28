/* =============================================================================
   tests.js - "Tests" tab: prove in the browser that every strategy is correct
   ============================================================================= */
(function () {
'use strict';
const root = $('#pane-tests');
let ui = {}, running = false;

class Counter { constructor() { this.checks = 0; this.fails = []; } check(c, msg) { this.checks++; if (!c) this.fails.push(msg); } }
const sym = (n, line) => ({ name: n, type: 0, scope: 0, line: line || 0 });

/* ---------- 1. hash functions vs independent BigInt implementations ---------- */
function testHashes() {
  const c = new Counter(), M = (1n << 64n) - 1n, bytes = s => Array.from(s, ch => BigInt(ch.charCodeAt(0)));
  const ref = {
    djb2: s => { let x = 5381n; for (const b of bytes(s)) x = (x * 33n + b) & M; return x; },
    fnv1a: s => { let x = 0xcbf29ce484222325n; for (const b of bytes(s)) { x ^= b; x = (x * 0x100000001b3n) & M; } return x; },
    sdbm: s => { let x = 0n; for (const b of bytes(s)) x = (b + (x << 6n) + (x << 16n) - x) & M; return x; },
    pjw: s => { let x = 0n; for (const b of bytes(s)) { x = ((x << 4n) + b) & 0xffffffffn; const g = x & 0xF0000000n; if (g) x ^= g >> 24n; x &= ~g & 0xffffffffn; } return x; },
    sum: s => { let x = 0n; for (const b of bytes(s)) x += b; return x & M; },
  };
  const r = E.makeRng(99), ks = ['', 'a', 'abc', 'foobar', 'x'.repeat(40)]; for (let i = 0; i < 400; i++) ks.push(E.genIdent(r, 1, 45));
  for (const h of E.HASH_NAMES) for (const k of ks) {
    c.check(E.hashHex(h, k) === ref[h](k).toString(16).padStart(16, '0'), `${h}("${k}") differs from the BigInt reference`);
    c.check(E.hashMod(h, k, 10007) === Number(ref[h](k) % 10007n), `${h} mod 10007 of "${k}"`);
  }
  c.check(E.hashHex('fnv1a', 'a') === 'af63dc4c8601ec8c', 'FNV-1a 64-bit official test vector for "a"');
  c.check(E.hashHex('fnv1a', '') === 'cbf29ce484222325', 'FNV-1a 64-bit offset basis');
  c.check(E.hashHex('djb2', 'a') === (177670).toString(16).padStart(16, '0'), 'djb2("a") = 5381*33 + 97');
  c.check(E.hashHex('sum', 'abc') === E.hashHex('sum', 'cba'), 'sum hash is anagram-blind (intentionally weak)');
  return c;
}
/* ---------- 2. edge cases ---------- */
function testEdges(sid) {
  const c = new Counter(), name = E.STRATEGIES[sid].name;
  let t = E.createTable(sid, { capacity: 31, autoResize: true });
  c.check(t.lookup('x') === null, 'lookup in an empty table');
  c.check(t.erase('x') === false, 'erase in an empty table');
  c.check(t.insert(sym('alpha', 1)) === E.INSERT_OK, 'first insert');
  c.check(t.insert(sym('alpha', 2)) === E.INSERT_EXISTS, 'duplicate insert reports EXISTS');
  c.check(t.size() === 1, 'duplicate does not grow the table');
  const p = t.lookup('alpha'); c.check(p && p.line === 2, 'duplicate insert updates the stored symbol');
  c.check(t.erase('alpha') && !t.erase('alpha'), 'erase once, second erase fails');
  c.check(t.lookup('alpha') === null && t.size() === 0, 'deleted key is gone');
  c.check(t.insert(sym('alpha', 3)) === E.INSERT_OK && !!t.lookup('alpha'), 're-insert after delete');
  for (let i = 0; i < 2000; i++) t.insert(sym('id' + i));
  let all = true; for (let i = 0; i < 2000; i++) all = all && t.lookup('id' + i) !== null;
  c.check(all && t.size() === 2001, 'all keys survive repeated resizing (size = ' + t.size() + ')');
  c.check(t.stats.resizes > 0, 'the table resized at least once');
  c.check(t.loadFactor() <= 1.0, 'load factor stays ≤ 1 in auto-resize mode');
  t = E.createTable(sid, { capacity: 53, autoResize: false }); const cap = t.capacity(); let ok = 0, failed = 0; const placed = [];
  for (let i = 0; i < cap + 20; i++) { const k = 'v' + i, r = t.insert(sym(k)); if (r === E.INSERT_OK) { ok++; placed.push(k); } else if (r === E.INSERT_FAILED) failed++; }
  c.check(placed.every(k => t.lookup(k) !== null), 'fixed capacity: every accepted key is findable');
  c.check(t.size() === ok, `fixed capacity: size matches accepted inserts (${t.size()} vs ${ok})`);
  c.check(t.stats.failed === failed, 'fixed capacity: failed-insert counter is exact');
  c.check(t.stats.resizes === 0, 'fixed capacity never resizes');
  return c;
}
/* ---------- 3. scopes ---------- */
function testScopes(sid) {
  const c = new Counter(), t = E.createTable(sid, { capacity: 31 }), st = new E.ScopedSymbolTable(t);
  st.enterScope(); st.declare('x', 0, 1); st.declare('y', 0, 2); st.enterScope(); st.declare('x', 1, 10);
  let a = st.resolve('x'), b = st.resolve('y');
  c.check(a && a.line === 10 && a.type === 1, 'inner x shadows outer x'); c.check(b && b.line === 2, 'y resolves in the outer scope');
  st.exitScope(); a = st.resolve('x'); c.check(a && a.line === 1, 'after leaving the block the outer x is visible again');
  c.check(st.resolve('nope') === null, 'an undeclared name does not resolve');
  st.exitScope(); c.check(t.size() === 0, 'leaving the last scope erases every symbol');
  return c;
}
/* ---------- 4. differential fuzzing ---------- */
const VARIANTS = [
  { l: 'resize / tiny start', o: { capacity: 7, autoResize: true } }, { l: 'fixed / 211', o: { capacity: 211, autoResize: false } },
  { l: 'resize / max load 0.9', o: { capacity: 53, autoResize: true, maxLoad: 0.9 } },
  { l: 'extreme hybrid params', o: { capacity: 23, autoResize: true, treeify: 2, untreeify: 1, window: 1, bucket: 1, stash: 0, maxkick: 5 } },
  { l: 'small hybrid params, fixed', o: { capacity: 101, autoResize: false, treeify: 3, untreeify: 2, window: 2, bucket: 2, stash: 1, maxkick: 20 } },
  { l: 'large hybrid params', o: { capacity: 31, autoResize: true, treeify: 64, window: 64, bucket: 8, stash: 16, maxkick: 500 } },
];
async function testFuzz(sid, onOps) {
  const c = new Counter(); let ops = 0;
  for (const h of E.HASH_NAMES) {
    for (const v of VARIANTS) for (let seed = 0; seed < 2; seed++) {
      const o = { ...v.o, hash: h }, t = E.createTable(sid, o), ref = new Map(), r = E.makeRng(seed * 7919 + sid), fixed = !o.autoResize, space = fixed ? Math.floor(o.capacity * 0.7) : 800;
      for (let i = 0; i < 3000; i++) {
        const k = 'k' + (r() % space), op = r() % 10; ops++;
        if (op < 5) { const res = t.insert(sym(k, i)); if (res === E.INSERT_FAILED) { c.check(fixed, `${h}/${v.l}: INSERT_FAILED in auto-resize mode`); continue; } c.check((res === E.INSERT_EXISTS) === ref.has(k), `${h}/${v.l}: insert status of ${k}`); ref.set(k, i); }
        else if (op < 8) { const p = t.lookup(k); c.check((p !== null) === ref.has(k) && (!p || p.line === ref.get(k)), `${h}/${v.l}: lookup ${k}`); }
        else c.check(t.erase(k) === ref.delete(k), `${h}/${v.l}: erase ${k}`);
        if (t.size() !== ref.size) { c.check(false, `${h}/${v.l}: size ${t.size()} vs ${ref.size}`); break; }
      }
      for (const [k] of ref) if (!t.lookup(k)) { c.check(false, `${h}/${v.l}: lost key ${k}`); break; }
    }
    await tick();
  }
  onOps(ops); return c;
}
/* ---------- 5. equivalence with the compiled C++ ---------- */
async function testCpp() {
  const out = []; const all = E.STRATEGIES.map(s => s.id);
  const cases = [
    ['random keys, fixed capacity 2003, load 0.9', { capacity: 2003, hash: 'djb2', autoResize: false }, E.uniqueRandom(1800, E.makeRng(5))],
    ['code-like names, growing table, fnv1a', { capacity: 31, hash: 'fnv1a', autoResize: true }, E.genCodeLike(1500, E.makeRng(6))],
    ['sequential names, weak "sum" hash, small hybrid params', { capacity: 211, hash: 'sum', autoResize: false, treeify: 2, untreeify: 1, window: 2, bucket: 2, stash: 1, maxkick: 30 }, E.genSequential(180)],
    ['adversarial keys (one bucket), djb2', { capacity: 1031, hash: 'djb2', autoResize: false }, E.genColliding(150, E.makeRng(3), 'djb2', E.nextPrime(1031), 3e6).keys],
  ];
  for (const [label, o, keys] of cases) {
    const phases = E.buildBenchmarkPhases(keys, E.makeMisses(keys, E.makeRng(11)), { seed: 3, hitReps: 2, deleteFraction: 0.5 });
    const js = await jsRun(all, o, phases), cpp = await bridgeRun(E.scriptToText(all, o, phases)); const d = compareResults(js, cpp);
    out.push({ label, ...d });
  }
  return out;
}

/* ---------- UI ---------- */
async function runAll() {
  if (running) return; running = true; ui.btn.disabled = true; ui.out.innerHTML = '';
  const S = E.STRATEGIES, rows = { hash: null, edge: [], scope: [], fuzz: [] }; let totalChecks = 0, totalFails = 0, ops = 0;
  const prog = f => { ui.bar.style.width = (f * 100) + '%'; };
  try {
    prog(0.02); await tick(); rows.hash = testHashes(); prog(0.1); await tick();
    for (let i = 0; i < S.length; i++) { rows.edge.push(testEdges(i)); rows.scope.push(testScopes(i)); prog(0.1 + 0.1 * (i + 1) / S.length); await tick(); }
    for (let i = 0; i < S.length; i++) { rows.fuzz.push(await testFuzz(i, n => { ops += n; })); prog(0.2 + 0.7 * (i + 1) / S.length); }
    let cpp = null; if (App.bridge.ok) { prog(0.93); try { cpp = await testCpp(); } catch (e) { cpp = [{ label: 'bridge error: ' + e.message, diffs: 1, total: 1 }]; } }
    prog(1);
    const all = [rows.hash, ...rows.edge, ...rows.scope, ...rows.fuzz]; all.forEach(c => { totalChecks += c.checks; totalFails += c.fails.length; });
    if (cpp) cpp.forEach(c => { totalChecks += c.total; totalFails += c.diffs; });
    const cell = c => h('td', { title: c.fails.length ? c.fails.slice(0, 5).join('\n') : c.checks + ' checks passed' }, c.fails.length ? h('span', { class: 'badge bad' }, '✗ ' + c.fails.length) : h('span', { class: 'badge ok' }, '✓ ' + fmt(c.checks, 0)));
    const head = h('tr', null, h('th', { class: 'l' }, 'Test group'), S.map(s => h('th', { title: s.name }, s.short)));
    const body = [
      h('tr', null, h('td', { class: 'l' }, 'Hash functions vs BigInt reference (5 hashes × 400 keys)'), h('td', { colspan: S.length, style: { textAlign: 'center' } }, rows.hash.fails.length ? h('span', { class: 'badge bad' }, '✗ ' + rows.hash.fails.length + ' - ' + rows.hash.fails[0]) : h('span', { class: 'badge ok' }, '✓ ' + fmt(rows.hash.checks, 0) + ' checks'))),
      h('tr', null, h('td', { class: 'l' }, 'Edge cases (empty table, duplicates, re-insert, resizing, fixed capacity)'), rows.edge.map(cell)),
      h('tr', null, h('td', { class: 'l' }, 'Block scopes (shadowing, inner→outer resolution, erase on exit)'), rows.scope.map(cell)),
      h('tr', null, h('td', { class: 'l' }, 'Differential fuzzing vs a reference map (5 hashes × 6 configurations)'), rows.fuzz.map(cell)),
    ];
    ui.out.append(h('div', { class: 'banner ' + (totalFails ? 'bad' : 'ok') }, h('span', { class: 'badge ' + (totalFails ? 'bad' : 'ok') }, totalFails ? '✗ ' + totalFails + ' failures' : '✓ all passed'),
      `${fmt(totalChecks, 0)} checks · ${fmt(ops, 0)} random operations applied to ${S.length} strategies.`), h('div', { style: { height: '12px' } }),
      h('div', { class: 'card' }, h('div', { class: 'tablewrap', style: { maxHeight: 'none' } }, h('table', { class: 'data' }, h('thead', null, head), h('tbody', null, body)))));
    const failList = all.flatMap(c => c.fails).slice(0, 10); if (failList.length) ui.out.append(h('div', { class: 'card' }, h('h3', null, 'First failures'), h('pre', { class: 'src' }, failList.join('\n'))));
    if (cpp) ui.out.append(h('div', { class: 'card' }, h('h3', null, 'Equivalence with the compiled C++ library'),
      h('div', { class: 'small muted', style: { marginBottom: '8px' } }, 'Identical operation scripts are executed by the JavaScript port and by the C++ binary; every probe count, collision, resize, failure and memory figure must be identical.'),
      h('table', { class: 'data' }, h('tbody', null, cpp.map(c => h('tr', null, h('td', { class: 'l' }, c.label), h('td', null, c.diffs ? h('span', { class: 'badge bad' }, '✗ ' + c.diffs + ' of ' + fmt(c.total, 0) + ' differ') : h('span', { class: 'badge ok' }, '✓ ' + fmt(c.total, 0) + ' counters identical'))))))));
  } catch (e) { ui.out.append(h('div', { class: 'banner bad' }, 'Test run crashed: ' + e.message)); }
  running = false; ui.btn.disabled = false; ui.prog.classList.add('hidden');
}
function build() {
  ui.btn = h('button', { class: 'btn primary', onclick: () => { ui.prog.classList.remove('hidden'); runAll(); } }, '▶ Run all tests');
  ui.bar = h('i'); ui.prog = h('div', { class: 'progress hidden', style: { marginTop: '10px' } }, ui.bar); ui.out = h('div');
  root.append(h('div', { class: 'intro' }, h('h2', null, 'Correctness tests'), h('p', null, 'Collision resolution is easy to get subtly wrong (lost keys after a delete, probe sequences that never end, resizing bugs). These tests hammer every strategy with random insert / lookup / delete sequences, compare the result with an independent reference, and check edge cases, block scopes and the hash functions themselves.')),
    h('div', { class: 'card' }, h('div', { class: 'row' }, ui.btn, h('span', { class: 'muted small' }, 'about 10 seconds · hover a cell for details')), ui.prog), h('div', { style: { height: '14px' } }), ui.out);
}
build();
App.tests = { runAll };
})();
