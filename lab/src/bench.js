/* =============================================================================
   bench.js - "Benchmark" tab: configurable collision-resolution experiments
   ============================================================================= */
(function () {
'use strict';
const root = $('#pane-bench');

/* ---------------------------------------------------------------- catalogues */
const METRICS = [
  { k: 'avgInsertProbes', label: 'Avg probes / insert', short: 'insert probes', d: 3, theory: 'hit' },
  { k: 'avgHitProbes', label: 'Avg probes / successful search', short: 'hit probes', d: 3, theory: 'hit' },
  { k: 'avgMissProbes', label: 'Avg probes / unsuccessful search', short: 'miss probes', d: 3, theory: 'miss' },
  { k: 'maxInsertProbes', label: 'Max probes (insert)', short: 'max insert', d: 1 },
  { k: 'maxLookupProbes', label: 'Max probes (search)', short: 'max search', d: 1 },
  { k: 'collisions', label: 'Collisions during inserts', short: 'collisions', d: 0 },
  { k: 'insertNs', label: 'Insert time (ns / op)', short: 'insert ns', d: 1 },
  { k: 'hitNs', label: 'Successful search time (ns / op)', short: 'hit ns', d: 1 },
  { k: 'missNs', label: 'Unsuccessful search time (ns / op)', short: 'miss ns', d: 1 },
  { k: 'deleteNs', label: 'Delete time (ns / op)', short: 'delete ns', d: 1 },
  { k: 'avgHitAfterDel', label: 'Avg probes / hit after deletions', short: 'hit after del', d: 3 },
  { k: 'avgMissAfterDel', label: 'Avg probes / miss after deletions', short: 'miss after del', d: 3 },
  { k: 'bytesPerEntry', label: 'Memory (bytes / stored key)', short: 'bytes/entry', d: 1 },
  { k: 'failed', label: 'Failed inserts', short: 'failed', d: 1 },
  { k: 'resizes', label: 'Table resizes', short: 'resizes', d: 1 },
  { k: 'loadFactor', label: 'Final load factor', short: 'load', d: 3 },
];
const METRIC = Object.fromEntries(METRICS.map(m => [m.k, m]));
const TABLE_COLS = ['avgInsertProbes', 'avgHitProbes', 'avgMissProbes', 'maxInsertProbes', 'maxLookupProbes', 'collisions', 'resizes', 'failed', 'loadFactor', 'bytesPerEntry', 'insertNs', 'hitNs', 'missNs', 'deleteNs', 'avgHitAfterDel', 'avgMissAfterDel'];

const SWEEPS = {
  lf:         { label: 'Load factor', num: true, def: '0.1:0.9:0.1,0.95', apply: (c, v) => ({ ...c, sizing: 'lf', lf: v }) },
  n:          { label: 'Number of identifiers (n)', num: true, def: '1000,2000,5000,10000,20000,50000', apply: (c, v) => ({ ...c, sizing: 'n', n: v }) },
  capacity:   { label: 'Table capacity', num: true, def: '1031,2003,5003,10007,20011', apply: (c, v) => ({ ...c, capacity: v }) },
  maxLoad:    { label: 'Max load (resize threshold)', num: true, def: '0.4:0.9:0.1', apply: (c, v) => ({ ...c, maxLoad: v }) },
  collidePct: { label: 'Colliding keys (%)', num: true, def: '0,10,25,50,75,100', apply: (c, v) => ({ ...c, collidePct: v }) },
  delFrac:    { label: 'Deleted fraction', num: true, def: '0,0.1,0.25,0.5,0.75,0.9', apply: (c, v) => ({ ...c, delFrac: v }) },
  treeify:    { label: 'H1 treeify threshold', num: true, def: '2,4,6,8,12,16', apply: (c, v) => ({ ...c, treeify: v, untreeify: Math.min(c.untreeify, v) }) },
  window:     { label: 'H2 probe window', num: true, def: '1,2,4,8,16,32', apply: (c, v) => ({ ...c, window: v }) },
  bucket:     { label: 'H3 bucket size', num: true, def: '1,2,3,4,6,8', apply: (c, v) => ({ ...c, bucket: v }) },
  stash:      { label: 'H3 stash size', num: true, def: '0,1,2,4,8,16', apply: (c, v) => ({ ...c, stash: v }) },
  hash:       { label: 'Hash function', cat: true, def: E.HASH_NAMES.join(','), apply: (c, v) => ({ ...c, hash: v }) },
  workload:   { label: 'Workload', cat: true, def: 'random,sequential,code', apply: (c, v) => ({ ...c, workload: v }) },
  none:       { label: '(none - single measurement)', single: true, def: '', apply: c => c },
};
const BASE = { workload: 'random', hash: 'djb2', capacity: 10007, sizing: 'lf', lf: 0.7, n: 5000, mode: 'fixed', maxLoad: 0.7, collidePct: 0, trials: 3, reps: 0, delFrac: 0.5, seed: 1,
               treeify: 8, untreeify: 4, window: 8, bucket: 4, stash: 4, maxkick: 200 };
const PRESETS = [
  { id: 'lf', name: 'Load-factor sweep', sub: 'fixed table, fill 10% → 95%', cfg: { sweep: 'lf' } },
  { id: 'growth', name: 'Growth (auto-resize)', sub: 'start tiny, insert n identifiers', cfg: { sweep: 'n', mode: 'auto', capacity: 31, maxLoad: 0.7, delFrac: 0.5 } },
  { id: 'hash', name: 'Hash functions', sub: 'same keys, 5 hash functions', cfg: { sweep: 'hash', workload: 'sequential', lf: 0.7 } },
  { id: 'workload', name: 'Workloads', sub: 'random vs sequential vs code-like', cfg: { sweep: 'workload', lf: 0.7 } },
  { id: 'stress', name: 'Collision stress', sub: 'adversarial keys → one bucket', cfg: { sweep: 'collidePct', capacity: 1031, lf: 0.3, trials: 2 } },
  { id: 'delete', name: 'Deletion aftermath', sub: 'tombstones vs shifting vs unlinking', cfg: { sweep: 'delFrac', capacity: 10007, lf: 0.7 } },
  { id: 'maxload', name: 'Resize threshold', sub: 'max load vs probes vs resizes', cfg: { sweep: 'maxLoad', mode: 'auto', capacity: 31, sizing: 'n', n: 20000 } },
  { id: 'single', name: 'Single measurement', sub: 'one table, all numbers', cfg: { sweep: 'none', lf: 0.8 } },
];

let C = { ...BASE, sweep: 'lf', sweepValues: SWEEPS.lf.def, custom: '' };         // current configuration (mirrors the form)
let R = null;                                                                       // current result set
let ui = {}, chart = null, running = false, cancel = false, sortKey = null, sortDir = 1;

/* ---------------------------------------------------------------- key generation */
function sizeN(c) { return c.sizing === 'lf' ? Math.max(1, Math.floor(E.nextPrime(c.capacity) * c.lf)) : Math.max(1, Math.floor(c.n)); }
function customKeys() { return [...new Set(C.custom.split(/[\s,;]+/).filter(k => /^[\x21-\x7e]{1,40}$/.test(k)))]; }
function makeKeys(c, trial, xi, notes) {
  const rng = E.makeRng(c.seed * 100003 + trial * 7919 + xi * 31 + 1), n = sizeN(c); let keys;
  switch (c.workload) {
    case 'sequential': keys = E.genSequential(n); break;
    case 'code': keys = E.genCodeLike(n, rng); if (keys.length < n) notes.add(`code-like workload can only produce ${keys.length} distinct names (asked for ${n})`); break;
    case 'custom': keys = customKeys().slice(0, n); if (keys.length < n) notes.add(`custom list has only ${keys.length} distinct identifiers (asked for ${n})`); break;
    default: keys = E.uniqueRandom(n, rng);
  }
  const nc = Math.round(keys.length * (c.collidePct || 0) / 100);
  if (nc > 0) {
    const m = E.nextPrime(c.capacity), g = E.genColliding(nc, rng, c.hash, m, 6e6);
    if (g.found < nc) notes.add(`only ${g.found} of ${nc} colliding keys could be generated for hash ${c.hash} mod ${m} (search budget exhausted)`);
    const seen = new Set(g.keys), rest = keys.filter(k => !seen.has(k)).slice(0, keys.length - g.found);
    keys = g.keys.concat(rest); const ord = E.shuffled(keys.length, rng); keys = ord.map(i => keys[i]);
  }
  if (!keys.length) throw new Error('the workload produced no identifiers');
  return { keys, misses: E.makeMisses(keys, rng) };
}
const optsOf = c => ({ capacity: c.capacity, hash: c.hash, autoResize: c.mode === 'auto', maxLoad: c.maxLoad, treeify: c.treeify, untreeify: c.untreeify, window: c.window, bucket: c.bucket, stash: c.stash, maxkick: c.maxkick });

/* ---------------------------------------------------------------- run */
function readValues(c) {
  const sw = SWEEPS[c.sweep];
  if (sw.single) return [null];
  if (sw.num) { const v = parseNumList(c.sweepValues); if (!v.length) throw new Error('enter at least one sweep value'); if (v.length > 60) throw new Error('at most 60 sweep values'); return v; }
  const v = c.sweepValues.split(/[\s,;]+/).filter(Boolean);
  const allowed = c.sweep === 'hash' ? E.HASH_NAMES : ['random', 'sequential', 'code', 'custom'];
  for (const x of v) if (!allowed.includes(x)) throw new Error(`"${x}" is not valid here. Use: ${allowed.join(', ')}`);
  if (!v.length) throw new Error('enter at least one value');
  return v;
}
function validate(c, xs) {
  if (!(c.capacity >= 3)) throw new Error('capacity must be at least 3');
  if (c.capacity > 3e6) throw new Error('capacity is limited to 3,000,000 in the browser');
  if (c.workload === 'custom' && !customKeys().length && c.sweep !== 'workload') throw new Error('the custom workload is empty - paste identifiers or use the Compiler tab');
  const maxN = Math.max(...xs.map((x, i) => sizeN(SWEEPS[c.sweep].apply(c, x))));
  if (maxN > 1.5e6) throw new Error('n is limited to 1,500,000 keys per run');
  if (c.mode === 'fixed' && c.sizing === 'lf' && xs.some(x => c.sweep === 'lf' && x > 5)) throw new Error('in fixed-capacity mode the load factor is limited to 5');
  if (c.trials < 1 || c.trials > 50) throw new Error('trials must be between 1 and 50');
}
async function run() {
  if (running) return;
  const errBox = ui.err; errBox.classList.add('hidden');
  let xs, sids;
  try {
    syncConfig(); sids = ui.strat.get(); if (!sids.length) throw new Error('select at least one strategy');
    xs = readValues(C); validate(C, xs);
  } catch (e) { errBox.textContent = e.message; errBox.classList.remove('hidden'); return; }
  running = true; cancel = false; setRunning(true);
  const cross = ui.cross.checked && App.bridge.ok, notes = new Set(), t0 = performance.now(), rows = []; let crossDiffs = 0, crossTotal = 0, cells = 0;
  const total = xs.length * C.trials;
  try {
    for (let xi = 0; xi < xs.length && !cancel; xi++) {
      const c = SWEEPS[C.sweep].apply(C, xs[xi]), acc = new Map();
      for (let tr = 0; tr < C.trials && !cancel; tr++) {
        const { keys, misses } = makeKeys(c, tr, xi, notes);
        const reps = c.reps > 0 ? c.reps : Math.min(25, Math.max(1, Math.ceil(100000 / keys.length)));
        const phases = E.buildBenchmarkPhases(keys, misses, { seed: c.seed + tr, hitReps: reps, missReps: reps, deleteFraction: c.delFrac });
        const res = await runScript(sids, optsOf(c), phases, { crosscheck: cross });
        if (res.cross) { crossDiffs += res.cross.diffs; crossTotal += res.cross.total; }
        for (const r of res.results) {
          const m = E.summarize(r, c); let a = acc.get(r.strategy);
          if (!a) { a = { n: 0, sum: {}, ok: true, meta: m }; acc.set(r.strategy, a); }
          a.n++; a.ok = a.ok && m.ok;
          for (const k in m) if (typeof m[k] === 'number') a.sum[k] = (a.sum[k] || 0) + m[k];
        }
        cells++; setProgress(cells / total, `${xi + 1}/${xs.length} · trial ${tr + 1}/${C.trials}`);
        await tick();
      }
      for (const [sid, a] of acc) { const m = { ...a.meta }; for (const k in a.sum) m[k] = a.sum[k] / a.n; m.ok = a.ok; m.x = xs[xi]; m.sid = sid; m.nKeys = sizeN(c); rows.push(m); }
    }
  } catch (e) { errBox.textContent = 'Run failed: ' + e.message; errBox.classList.remove('hidden'); running = false; setRunning(false); return; }
  running = false; setRunning(false);
  if (!rows.length) { toast('Cancelled'); return; }
  R = { rows, xs, sweep: C.sweep, cfg: { ...C }, engine: cross ? 'both' : App.engine, ms: performance.now() - t0, notes: [...notes], cross: cross ? { diffs: crossDiffs, total: crossTotal } : null, partial: cancel, source: 'run' };
  R.metric = R.metric || 'avgHitProbes'; autoLog(); renderResults();
}
function setRunning(b) { ui.runBtn.classList.toggle('hidden', b); ui.cancelBtn.classList.toggle('hidden', !b); ui.progress.classList.toggle('hidden', !b); if (!b) setProgress(0, ''); }
function setProgress(f, txt) { ui.bar.style.width = (f * 100).toFixed(1) + '%'; ui.progTxt.textContent = txt; }

/* ---------------------------------------------------------------- results */
let metricKey = 'avgHitProbes', logScale = false, showTheory = true, logTouched = false;
function autoLog() {
  if (logTouched) return; const vals = R.rows.map(r => r[metricKey]).filter(v => v > 0); logScale = vals.length > 1 && Math.max(...vals) / Math.min(...vals) > 40; ui.logCb && (ui.logCb.checked = logScale);
}
const xLabel = x => (x === null ? '' : typeof x === 'number' ? fmt(x, 4) : String(x));
function theorySeries(rows, xs, mk) {
  const T = E.Theory, kind = METRIC[mk].theory; if (!kind) return [];
  const f = (obj, a) => (a > 0 && a < 1 ? obj[kind](a) : null);
  const lines = [['theory: chaining', T.chaining, '#5b6b84'], ['theory: linear probing', T.linear, '#a44a4a'], ['theory: uniform hashing (≈ double hashing)', T.uniform, '#4a8a5a']];
  return lines.map(([label, obj, color]) => ({ label, data: xs.map(a => f(obj, a)), color, dashed: true, noPoints: true, bold: false }));
}
function chartSpec() {
  const m = METRIC[metricKey], strategies = [...new Set(R.rows.map(r => r.sid))].sort((a, b) => a - b);
  const cat = !R.xs.every(x => typeof x === 'number'), single = R.xs.length === 1;
  const ylab = m.label;
  if (single) {
    const rs = strategies.map(s => R.rows.find(r => r.sid === s));
    return { type: 'bar', labels: rs.map(r => E.STRATEGIES[r.sid].short), datasets: [{ label: m.label, data: rs.map(r => r[metricKey]), color: rs.map(r => E.STRATEGIES[r.sid].color) }], yTitle: ylab, legend: false, log: logScale };
  }
  const labels = R.xs.map(xLabel);
  const datasets = strategies.map(s => { const S = E.STRATEGIES[s];
    return { label: S.short, kind: S.kind, color: S.color, dashed: S.kind === 'hybrid' && !cat, data: R.xs.map(x => { const r = R.rows.find(q => q.sid === s && q.x === x); return r ? r[metricKey] : null; }) }; });
  const bar = cat;
  if (!bar && showTheory && R.sweep === 'lf' && R.cfg.mode === 'fixed' && R.cfg.workload === 'random' && R.cfg.collidePct === 0 && R.source === 'run') datasets.push(...theorySeries(R.rows, R.xs, metricKey));
  return { type: bar ? 'bar' : 'line', labels, datasets, xTitle: SWEEPS[R.sweep].label, yTitle: ylab, log: logScale };
}
function renderResults() {
  const box = ui.results; box.innerHTML = ''; if (chart) { chart.destroy(); chart = null; }
  if (!R) { box.append(emptyState()); return; }
  const bad = R.rows.filter(r => !r.ok), engineTxt = R.engine === 'both' ? 'JS + C++ (cross-checked)' : R.engine === 'cpp' ? 'C++ (native)' : R.engine === 'file' ? 'imported C++ benchmark data' : 'JavaScript engine';
  const banners = h('div', { class: 'stack', style: { marginBottom: '12px' } });
  if (R.source === 'run') {
    banners.append(h('div', { class: 'banner ' + (bad.length ? 'bad' : 'ok') }, h('span', { class: 'badge ' + (bad.length ? 'bad' : 'ok') }, bad.length ? '✗ verification failed' : '✓ verified'),
      bad.length ? 'Some runs returned wrong lookups: ' + [...new Set(bad.map(b => b.name))].join(', ')
                 : 'Every run was checked: all stored keys were found, absent keys were never found, and deleted keys were gone while the rest stayed intact.',
      h('span', { class: 'muted small', style: { marginLeft: 'auto' } }, `${engineTxt} · ${R.rows.length} data points · ${fmt(R.ms / 1000, 1)} s${R.partial ? ' · cancelled early' : ''}`)));
    if (R.cross) banners.append(h('div', { class: 'banner ' + (R.cross.diffs ? 'bad' : 'ok') }, h('span', { class: 'badge ' + (R.cross.diffs ? 'bad' : 'ok') }, R.cross.diffs ? '✗ engines differ' : '✓ engines agree'),
      R.cross.diffs ? `${R.cross.diffs} of ${fmt(R.cross.total, 0)} counters differ between the JavaScript port and the C++ binary.` : `The JavaScript port and the compiled C++ binary produced identical counters (${fmt(R.cross.total, 0)} compared: probes, collisions, resizes, failures, memory).`));
    R.notes.forEach(n => banners.append(h('div', { class: 'banner warn' }, '⚠ ' + n)));
  } else banners.append(h('div', { class: 'banner' }, h('span', { class: 'badge info' }, 'C++ data'), R.label));
  box.append(banners);
  // metric chips
  const chips = h('div', { class: 'chips' });
  METRICS.forEach(m => chips.append(h('span', { class: 'chip' + (m.k === metricKey ? ' on' : ''), onclick: () => { metricKey = m.k; if (!logTouched) autoLog(); renderResults(); } }, m.short)));
  const chartCard = h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, METRIC[metricKey].label),
    h('div', { class: 'row' },
      h('label', { class: 'check' }, ui.logCb = h('input', { type: 'checkbox', checked: logScale, onchange: e => { logScale = e.target.checked; logTouched = true; chart.update(chartSpec()); } }), 'log scale'),
      R.sweep === 'lf' && R.source === 'run' && R.cfg.mode === 'fixed' && R.cfg.workload === 'random' && METRIC[metricKey].theory ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: showTheory, onchange: e => { showTheory = e.target.checked; chart.update(chartSpec()); } }), 'theory curves') : null,
      h('button', { class: 'btn small', onclick: () => download('chart_' + metricKey + '.png', chart.png()) }, '⬇ PNG'))),
    h('div', { class: 'metrics', style: { marginBottom: '10px' } }, chips), h('div', { class: 'chart-box' }, ui.canvas = h('canvas')));
  box.append(chartCard);
  chart = makeChart(ui.canvas, chartSpec());
  box.append(leaderboard());
  box.append(tableCard());
}
function leaderboard() {
  const mk = metricKey, by = new Map();
  R.rows.forEach(r => { const v = r[mk]; if (Number.isFinite(v)) { const a = by.get(r.sid) || { s: 0, n: 0 }; a.s += v; a.n++; by.set(r.sid, a); } });
  const list = [...by.entries()].map(([sid, a]) => ({ sid, v: a.s / a.n })).sort((a, b) => a.v - b.v), max = Math.max(...list.map(l => l.v), 1e-12);
  const body = h('div', { class: 'col', style: { gap: '6px' } });
  if (list.length > 1) { const b = list[0], w = list[list.length - 1], ratio = b.v > 1e-9 ? w.v / b.v : Infinity;
    if (ratio >= 1.05) body.append(h('div', { class: 'headline' }, h('b', null, E.STRATEGIES[w.sid].name), ' needs ', h('b', null, Number.isFinite(ratio) ? fix(ratio, ratio < 10 ? 1 : 0) + '×' : 'far'), ' more (' + METRIC[mk].short + ') than ', h('b', null, E.STRATEGIES[b.sid].name), ' - the best here.')); }
  list.forEach((l, i) => { const S = E.STRATEGIES[l.sid];
    body.append(h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('span', { class: 'mono faint', style: { width: '18px' } }, i + 1), h('span', { class: 'sw', style: { background: S.color } }),
      h('span', { style: { width: '190px', flex: 'none' } }, S.name), h('div', { style: { flex: 1, background: 'var(--surface2)', borderRadius: '99px', height: '10px', overflow: 'hidden' } }, h('i', { style: { display: 'block', height: '100%', width: Math.max(1.5, l.v / max * 100) + '%', background: S.color } })),
      h('span', { class: 'mono', style: { width: '80px', textAlign: 'right' } }, fmt(l.v, METRIC[mk].d)))); });
  return h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, 'Ranking - ' + METRIC[mk].label), h('span', { class: 'muted small' }, R.xs.length > 1 ? 'mean over all sweep values · lower is better' : 'lower is better')), body);
}
function tableCard() {
  const cols = TABLE_COLS, strategies = [...new Set(R.rows.map(r => r.sid))];
  const multi = R.xs.length > 1;
  let rows = R.rows.slice();
  rows.sort((a, b) => { if (sortKey) { const va = sortKey === 'name' ? a.name : a[sortKey], vb = sortKey === 'name' ? b.name : b[sortKey]; return (va < vb ? -1 : va > vb ? 1 : 0) * sortDir; }
    return (R.xs.indexOf(a.x) - R.xs.indexOf(b.x)) || (a.sid - b.sid); });
  // heat: rank inside each x group, lower = greener
  const heat = {}; const groups = new Map(); R.rows.forEach(r => { const g = groups.get(r.x) || []; g.push(r); groups.set(r.x, g); });
  for (const [, g] of groups) for (const k of cols) { const vals = g.map(r => r[k]).filter(Number.isFinite); const lo = Math.min(...vals), hi = Math.max(...vals); g.forEach(r => { heat[r.x + '|' + r.sid + '|' + k] = hi - lo < 1e-12 ? '' : (() => { const f = (r[k] - lo) / (hi - lo); return f < 0.1 ? 'h0' : f < 0.3 ? 'h1' : f > 0.9 ? 'h4' : f > 0.7 ? 'h3' : ''; })(); }); }
  const th = (k, label, cls) => h('th', { class: cls || '', onclick: () => { sortDir = sortKey === k ? -sortDir : 1; sortKey = k; renderResults(); }, title: 'click to sort' }, label + (sortKey === k ? (sortDir > 0 ? ' ▲' : ' ▼') : ''));
  const head = h('tr', null, multi || R.xs[0] !== null ? th('x', SWEEPS[R.sweep].label, 'l') : null, th('name', 'Strategy', 'l'), cols.map(k => th(k, METRIC[k].short)), h('th', null, 'ok'));
  const body = rows.map((r, i) => h('tr', { class: i > 0 && rows[i - 1].x !== r.x && !sortKey ? 'grp' : '' },
    multi || R.xs[0] !== null ? h('td', { class: 'l' }, xLabel(r.x)) : null,
    h('td', { class: 'l' }, h('span', { class: 'sw', style: { background: E.STRATEGIES[r.sid].color, marginRight: '7px' } }), E.STRATEGIES[r.sid].name),
    cols.map(k => h('td', { class: heat[r.x + '|' + r.sid + '|' + k] || '' }, fmt(r[k], METRIC[k].d))), h('td', null, r.ok ? '✓' : '✗')));
  return h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, 'All results'),
    h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: exportCsv }, '⬇ CSV'), h('button', { class: 'btn small', onclick: () => copyText(markdown()) }, 'Copy as Markdown'),
      h('button', { class: 'btn small', onclick: () => download('experiment_config.json', JSON.stringify({ config: R.cfg, strategies, engine: R.engine }, null, 2), 'application/json') }, '⬇ Config'))),
    h('div', { class: 'small muted', style: { marginBottom: '8px' } }, 'Green = best, red = worst within each row group. “Probe” = one slot, list node or tree level examined. Timings are averages over all trials.'),
    h('div', { class: 'tablewrap' }, h('table', { class: 'data' }, h('thead', null, head), h('tbody', null, body))));
}
function exportCsv() {
  const cols = ['x', 'strategy', 'kind', ...METRICS.map(m => m.k), 'verified'];
  const lines = [cols.join(',')];
  R.rows.forEach(r => lines.push([xLabel(r.x), r.name, r.kind, ...METRICS.map(m => r[m.k]), r.ok ? 1 : 0].map(csvEscape).join(',')));
  download('symbol_table_results.csv', lines.join('\n') + '\n', 'text/csv');
}
function markdown() {
  const ks = ['avgInsertProbes', 'avgHitProbes', 'avgMissProbes', 'maxInsertProbes', 'collisions', 'bytesPerEntry'];
  const lines = ['| ' + [R.xs.length > 1 ? SWEEPS[R.sweep].label : null, 'Strategy', ...ks.map(k => METRIC[k].short)].filter(Boolean).join(' | ') + ' |', '|' + (R.xs.length > 1 ? '---|' : '') + '---|' + ks.map(() => '---:|').join('')];
  R.rows.slice().sort((a, b) => (R.xs.indexOf(a.x) - R.xs.indexOf(b.x)) || (a.sid - b.sid)).forEach(r => lines.push('| ' + [R.xs.length > 1 ? xLabel(r.x) : null, r.name, ...ks.map(k => fmt(r[k], METRIC[k].d))].filter(v => v !== null).join(' | ') + ' |'));
  return lines.join('\n');
}
function emptyState() {
  return h('div', { class: 'empty' }, h('h3', { style: { marginBottom: '6px', color: 'var(--text)' } }, 'No results yet'),
    h('p', null, 'Choose an experiment on the left (or change any value) and press ', h('b', null, 'Run experiment'), '.'),
    h('div', { class: 'row', style: { justifyContent: 'center' } }, h('button', { class: 'btn primary', onclick: run }, '▶ Run experiment'),
      h('button', { class: 'btn', onclick: loadReference }, 'Show the C++ reference results')));
}

/* ---------------------------------------------------------------- C++ benchmark CSV import */
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/), head = lines.shift().split(','); const out = [];
  for (const ln of lines) { const parts = ln.split(','); const o = {}; head.forEach((k, i) => { o[k.trim()] = parts[i]; }); out.push(o); }
  return out;
}
function importSweep(text, label) {
  const recs = parseCsv(text); if (!recs.length || recs[0].avg_insert_probes === undefined) throw new Error('not a results.csv produced by benchmark (load-factor sweep)');
  const byName = Object.fromEntries(E.STRATEGIES.map(s => [s.name, s.id]));
  const rows = recs.filter(r => byName[r.strategy] !== undefined).map(r => { const n = +r.n_items || 1, sid = byName[r.strategy];
    return { sid, strategy: sid, name: r.strategy, kind: E.STRATEGIES[sid].kind, x: +r.load_factor, avgInsertProbes: +r.avg_insert_probes, maxInsertProbes: +r.max_insert_probes, avgHitProbes: +r.avg_search_probes_hit, avgMissProbes: +r.avg_search_probes_miss,
      maxLookupProbes: NaN, collisions: NaN, resizes: 0, failed: +r.failed_inserts, loadFactor: +r.load_factor, bytesPerEntry: +r.bytes_per_entry, insertNs: +r.insert_time_ms * 1e6 / n, hitNs: +r.search_hit_time_ms * 1e6 / n, missNs: +r.search_miss_time_ms * 1e6 / n,
      deleteNs: NaN, avgHitAfterDel: NaN, avgMissAfterDel: NaN, ok: true }; });
  const xs = [...new Set(rows.map(r => r.x))].sort((a, b) => a - b);
  R = { rows, xs, sweep: 'lf', cfg: { ...BASE, mode: 'fixed' }, engine: 'file', ms: 0, notes: [], cross: null, source: 'file', label };
  metricKey = 'avgMissProbes'; autoLog(); renderResults();
}
function loadReference() {
  const el = $('#cppResultsCsv'); if (!el) { toast('no embedded data'); return; }
  importSweep(el.textContent, 'Results of source/benchmark.cpp (compiled C++): fixed capacity 10,007, load factor 0.1 → 0.95, 5 trials, identical keys for every strategy. Probe counts are exact; times were measured on the author\'s machine.');
}

/* ---------------------------------------------------------------- configuration form */
function syncConfig() {
  const g = k => ui[k];
  C.workload = g('workload').value; C.hash = g('hash').value; C.capacity = +g('capacity').value; C.sizing = g('sizing').value; C.lf = +g('lf').value; C.n = +g('n').value;
  C.mode = g('mode').value; C.maxLoad = +g('maxLoad').value; C.collidePct = +g('collide').value; C.trials = +g('trials').value; C.reps = +g('reps').value; C.delFrac = +g('delFrac').value; C.seed = +g('seed').value;
  C.sweep = g('sweep').value; C.sweepValues = g('sweepValues').value; C.custom = g('custom').value; Object.assign(C, ui.params.get());
}
function applyToForm() {
  const set = (k, v) => { ui[k].value = v; };
  set('workload', C.workload); set('hash', C.hash); set('capacity', C.capacity); set('sizing', C.sizing); set('lf', C.lf); set('n', C.n); set('mode', C.mode); set('maxLoad', C.maxLoad);
  set('collide', C.collidePct); set('trials', C.trials); set('reps', C.reps); set('delFrac', C.delFrac); set('seed', C.seed); set('sweep', C.sweep); set('sweepValues', C.sweepValues);
  ui.params.set(C); refreshVisibility();
}
function refreshVisibility() {
  const sw = SWEEPS[ui.sweep.value];
  ui.sweepValuesField.classList.toggle('hidden', !!sw.single);
  ui.sweepHint.textContent = sw.single ? '' : sw.num ? 'Comma-separated numbers or ranges start:end:step, e.g. 0.1:0.9:0.1,0.95' : 'Comma-separated: ' + (ui.sweep.value === 'hash' ? E.HASH_NAMES.join(', ') : 'random, sequential, code, custom');
  ui.lfField.classList.toggle('hidden', ui.sizing.value !== 'lf' || ui.sweep.value === 'lf'); ui.nField.classList.toggle('hidden', ui.sizing.value !== 'n' || ui.sweep.value === 'n');
  ui.sizingField.classList.toggle('hidden', ui.sweep.value === 'lf' || ui.sweep.value === 'n');
  ui.maxLoadField.classList.toggle('hidden', ui.mode.value !== 'auto'); ui.customField.classList.toggle('hidden', ui.workload.value !== 'custom' && ui.sweep.value !== 'workload');
  const dis = (k, on) => ui[k].closest('.field').classList.toggle('hidden', on);
  dis('workload', ui.sweep.value === 'workload'); dis('hash', ui.sweep.value === 'hash'); dis('capacity', ui.sweep.value === 'capacity'); dis('collide', ui.sweep.value === 'collidePct'); dis('delFrac', ui.sweep.value === 'delFrac');
  ui.crossField.classList.toggle('hidden', !App.bridge.ok);
}
function onSweepChange() { const sw = SWEEPS[ui.sweep.value]; ui.sweepValues.value = sw.def; refreshVisibility(); }
function applyPreset(p) {
  C = { ...BASE, sweep: 'lf', custom: C.custom, ...p.cfg }; C.sweepValues = SWEEPS[C.sweep].def;
  if (C.sweep === 'n') C.sizing = 'n'; if (C.sweep === 'lf') C.sizing = 'lf'; if (C.sweep === 'delFrac') C.delFrac = 0.5;
  applyToForm(); $$('.preset', root).forEach(b => b.classList.toggle('on', b.dataset.id === p.id)); toast('Preset: ' + p.name);
}
function F(label, input, hint, cls) { return h('div', { class: 'field ' + (cls || '') }, h('label', null, label), input, hint ? h('div', { class: 'hint' }, hint) : null); }
function build() {
  const num = (v, o = {}) => h('input', { type: 'number', value: v, min: o.min, max: o.max, step: o.step || 'any', onchange: refreshVisibility });
  const sel = (opts, v, f) => h('select', { onchange: f || refreshVisibility }, opts.map(([val, lab]) => h('option', { value: val, selected: val === v }, lab)));
  ui.workload = sel([['random', 'Random identifiers'], ['sequential', 'Sequential (var0, var1, …)'], ['code', 'Code-like names (buf_len3, m_node …)'], ['custom', 'Custom list (paste / Compiler tab)']], C.workload);
  ui.hash = sel(E.HASH_NAMES.map(n => [n, n + ' - ' + E.HASHES[n].desc]), C.hash);
  ui.capacity = num(C.capacity, { min: 3, step: 1 }); ui.sizing = sel([['lf', 'by load factor'], ['n', 'by number of identifiers']], C.sizing);
  ui.lf = num(C.lf, { min: 0.01, max: 5, step: 0.05 }); ui.n = num(C.n, { min: 1, step: 1 });
  ui.mode = sel([['fixed', 'Fixed capacity - no resizing (inserts may fail)'], ['auto', 'Auto-resize (grow & rehash at max load)']], C.mode);
  ui.maxLoad = num(C.maxLoad, { min: 0.1, max: 0.98, step: 0.05 }); ui.collide = num(C.collidePct, { min: 0, max: 100, step: 5 });
  ui.trials = num(C.trials, { min: 1, max: 50, step: 1 }); ui.reps = num(C.reps, { min: 0, step: 1 }); ui.delFrac = num(C.delFrac, { min: 0, max: 1, step: 0.05 }); ui.seed = num(C.seed, { step: 1 });
  ui.sweep = sel(Object.entries(SWEEPS).map(([k, v]) => [k, v.label]), C.sweep, onSweepChange); ui.sweepValues = h('input', { type: 'text', value: C.sweepValues, spellcheck: 'false' });
  ui.custom = h('textarea', { rows: 4, placeholder: 'count total index buf_len …  (whitespace or comma separated)', spellcheck: 'false' });
  ui.params = paramFields(C); ui.strat = strategyPicker(null);
  ui.cross = h('input', { type: 'checkbox' });
  ui.err = h('div', { class: 'banner bad hidden' });
  ui.runBtn = h('button', { class: 'btn primary block', onclick: run }, '▶ Run experiment'); ui.cancelBtn = h('button', { class: 'btn danger block hidden', onclick: () => { cancel = true; } }, 'Cancel');
  ui.bar = h('i'); ui.progTxt = h('div', { class: 'small muted', style: { marginTop: '4px' } }); ui.progress = h('div', { class: 'hidden' }, h('div', { class: 'progress' }, ui.bar), ui.progTxt);
  ui.sweepValuesField = F('Values to test', ui.sweepValues); ui.sweepHint = ui.sweepValuesField.querySelector('.hint') || ui.sweepValuesField.appendChild(h('div', { class: 'hint' }));
  ui.sizingField = F('Size the workload', ui.sizing); ui.lfField = F('Load factor (keys ÷ table size)', ui.lf, 'n = ⌊capacity × load factor⌋ - same keys for every strategy'); ui.nField = F('Number of identifiers (n)', ui.n);
  ui.maxLoadField = F('Max load before resizing', ui.maxLoad); ui.customField = F('Custom identifiers', ui.custom, null);
  const upl = h('input', { type: 'file', accept: '.txt,.csv,.c,.h,.cpp,.java,.py,.js', class: 'hidden', onchange: async e => { const f = e.target.files[0]; if (!f) return; const t = await f.text(); ui.custom.value = LX.describe(LX.tokenize(t), t).uniqueNames.join(' '); ui.workload.value = 'custom'; refreshVisibility(); toast('Loaded identifiers from ' + f.name); } });
  ui.customField.append(h('div', { class: 'row', style: { marginTop: '4px' } }, h('button', { class: 'btn small', onclick: () => upl.click() }, 'Upload source file…'), h('button', { class: 'btn small', onclick: () => { const ids = App.compiler && App.compiler.identifiers(); if (ids && ids.length) { ui.custom.value = ids.join(' '); toast(ids.length + ' identifiers imported'); } else toast('Open the Compiler tab and analyse a program first'); } }, 'Use Compiler-tab identifiers'), upl));
  ui.crossField = h('label', { class: 'check hidden', title: 'Runs each experiment in JavaScript AND in the compiled C++ code and compares every counter' }, ui.cross, 'Cross-check against C++ (run both engines)');
  const presets = h('div', { class: 'presets' }, PRESETS.map(p => h('button', { class: 'preset' + (p.id === 'lf' ? ' on' : ''), 'data-id': p.id, onclick: () => applyPreset(p) }, h('b', null, p.name), h('span', null, p.sub))));
  const left = h('div', { class: 'stack' },
    h('div', { class: 'card runbar' }, ui.crossField, ui.err, ui.runBtn, ui.cancelBtn, ui.progress, h('div', { class: 'small muted engine-note', style: { marginTop: '6px' } })),
    h('div', { class: 'card' }, h('h3', null, 'Experiment'), presets),
    h('div', { class: 'card' }, h('h3', null, 'What to vary'), F('Sweep variable', ui.sweep, 'The x-axis of the chart. Every other value below stays fixed.'), ui.sweepValuesField),
    h('div', { class: 'card' }, h('h3', null, 'Workload & table'), F('Identifiers', ui.workload), ui.customField, F('Hash function', ui.hash), F('Table capacity (initial slots)', ui.capacity, 'rounded up to a prime, as in the C++ code'),
      ui.sizingField, ui.lfField, ui.nField, F('Table mode', ui.mode), ui.maxLoadField, F('Colliding keys (%)', ui.collide, 'share of keys forced into ONE bucket (adversarial / worst case)')),
    h('div', { class: 'card' }, h('h3', null, 'Measurement'), h('div', { class: 'two' }, F('Trials (averaged)', ui.trials), F('Search repetitions', ui.reps, '0 = automatic')), h('div', { class: 'two' }, F('Fraction deleted', ui.delFrac, 'then re-measured'), F('Random seed', ui.seed))),
    h('details', { class: 'card' }, h('summary', null, 'Hybrid-scheme parameters'), ui.params.el, h('div', { class: 'hint' }, 'Defaults match the C++ benchmark. Each parameter only affects its own strategy.')),
    h('details', { class: 'card', open: true }, h('summary', null, 'Strategies to compare'), ui.strat.el));
  { const cards = [...left.children];
    const adv = h('details', { class: 'card' }, h('summary', null, '⚙ Customize every value  (table size, hash, workload, trials, hybrid parameters, strategies)'), h('div', { class: 'stack', style: { marginTop: '12px' } }, cards.slice(2)));
    left.innerHTML = ''; left.append(cards[0], cards[1], adv); }
  ui.results = h('div');
  root.append(h('div', { class: 'intro' }, h('h2', null, 'Benchmark lab'), h('p', null, 'Change any value - table size, load factor, hash function, workload, hybrid parameters, number of trials - choose what to sweep, and measure every strategy on exactly the same keys. All runs are verified for correctness.')),
    h('div', { class: 'split' }, left, ui.results));
  refreshVisibility(); renderResults();
}
build();
App.bench = { run, refresh: refreshVisibility, importSweep, state: () => ({ C, R }), setConfig: (o) => { Object.assign(C, o); applyToForm(); } };
})();
