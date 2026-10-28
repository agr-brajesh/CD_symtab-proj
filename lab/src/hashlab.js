/* =============================================================================
   hashlab.js - "Hash Lab" tab: how evenly does each hash function spread the identifiers?
   Collisions begin here: a bad distribution costs every collision-resolution scheme.
   ============================================================================= */
(function () {
'use strict';
const root = $('#pane-hash');
let ui = {}, chart = null, last = null;
const COLORS = { djb2: '#2457d6', fnv1a: '#17855a', sdbm: '#e8a21f', pjw: '#9467bd', sum: '#c23a2e' };

function keys(kind, n, seed) {
  const r = E.makeRng(seed);
  if (kind === 'sequential') return E.genSequential(n);
  if (kind === 'code') return E.genCodeLike(n, r);
  if (kind === 'custom') { const ids = App.compiler && App.compiler.identifiers(); if (!ids || !ids.length) throw new Error('Open the Compiler tab and analyse a program first'); return ids.slice(0, n); }
  return E.uniqueRandom(n, r);
}
function verdict(a) {
  const q = a.chi2Ratio; if (q < 1.15) return ['uniform', 'ok']; if (q < 1.6) return ['slightly skewed', 'warn']; return ['badly skewed', 'bad'];
}
function heat(canvas, counts) {
  const cell = 6, cols = Math.min(120, counts.length), rows = Math.ceil(counts.length / cols);
  canvas.width = cols * cell; canvas.height = rows * cell; canvas.style.height = Math.min(120, rows * cell * (canvas.clientWidth / canvas.width || 1)) + 'px';
  const ctx = canvas.getContext('2d'), pal = [cssVar('--surface2'), '#9db8f0', '#e8c26a', '#e8873a', '#c23a2e'];
  for (let i = 0; i < counts.length; i++) { ctx.fillStyle = pal[Math.min(counts[i], 4)]; ctx.fillRect((i % cols) * cell, Math.floor(i / cols) * cell, cell - 1, cell - 1); }
}
function run() {
  ui.err.classList.add('hidden');
  try {
    const sel = E.HASH_NAMES.filter(n => ui.boxes[n].checked); if (!sel.length) throw new Error('select at least one hash function');
    const m = E.nextPrime(Math.max(3, Math.floor(+ui.m.value))); const n = Math.max(1, Math.floor(+ui.n.value));
    if (m > 2e6 || n > 2e6) throw new Error('table size and key count are limited to 2,000,000');
    const ks = keys(ui.wl.value, n, +ui.seed.value || 1);
    const res = sel.map(h => E.analyzeHash(h, ks, m));
    last = { res, m, n: ks.length, ks, wl: ui.wl.value }; render();
  } catch (e) { ui.err.textContent = e.message; ui.err.classList.remove('hidden'); }
}
function render() {
  const box = ui.out; box.innerHTML = ''; if (chart) { chart.destroy(); chart = null; }
  const { res, m, n, ks } = last, lam = n / m;
  box.append(h('div', { class: 'banner' }, h('span', { class: 'badge info' }, 'setup'), `${fmt(n, 0)} identifiers hashed into ${fmt(m, 0)} buckets (prime) → average ${fix(lam, 3)} keys per bucket. An ideal random hash would leave ${fix(Math.exp(-lam) * 100, 1)}% of buckets empty and give χ²/(m−1) ≈ 1.`));
  const maxK = Math.min(Math.max(...res.map(a => a.max)), 14);
  const labels = Array.from({ length: maxK + 1 }, (_, i) => String(i));
  const ds = res.map(a => ({ label: a.hash, color: COLORS[a.hash], data: labels.map((_, k) => a.hist[k] || 0) }));
  ds.push({ label: 'ideal random hash (Poisson)', color: '#8793a6', data: labels.map((_, k) => m * E.Theory.poisson(lam, k)) });
  box.append(h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, 'How many buckets hold k keys?'), h('button', { class: 'btn small', onclick: () => download('hash_distribution.png', chart.png()) }, '⬇ PNG')),
    h('div', { class: 'small muted', style: { marginBottom: '8px' } }, 'A good hash follows the grey Poisson bars. Long tails (many buckets with 4, 5, 6… keys) mean long chains and long probe sequences; a tall bar at 0 means wasted slots.'),
    h('div', { class: 'chart-box short' }, ui.canvas = h('canvas'))));
  chart = makeChart(ui.canvas, { type: 'bar', labels, datasets: ds, xTitle: 'keys in one bucket (k)', yTitle: 'number of buckets', log: ui.log.checked });
  const rows = res.map(a => { const [v, c] = verdict(a); return h('tr', null, h('td', { class: 'l' }, h('span', { class: 'sw', style: { background: COLORS[a.hash], marginRight: '7px' } }), a.hash),
    h('td', null, fix(a.emptyPct * 100, 1) + '%'), h('td', null, fix(a.expectedEmptyPct * 100, 1) + '%'), h('td', null, a.max), h('td', null, fix(a.variance, 3)), h('td', null, fix(a.expectedVariance, 3)),
    h('td', null, fix(a.chi2Ratio, 3)), h('td', null, fix(a.collidingKeys / n * 100, 1) + '%'), h('td', { class: 'l' }, h('span', { class: 'badge ' + c }, v))); });
  box.append(h('div', { class: 'card' }, h('h3', null, 'Distribution quality'),
    h('div', { class: 'tablewrap' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, ['Hash', 'empty buckets', 'ideal', 'fullest bucket', 'variance of load', 'ideal (=λ)', 'χ² / (m−1)', 'keys sharing a bucket', 'verdict'].map((t, i) => h('th', { class: i === 0 || i === 8 ? 'l' : '' }, t)))), h('tbody', null, rows))),
    h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'χ² / (m−1) compares the observed bucket loads with a perfectly uniform spread; ≈ 1 is what a random function gives, much larger means clustering. “keys sharing a bucket” is the share of keys that have at least one collision partner.')));
  const maps = h('div', { class: 'col' });
  res.forEach(a => { const cv = h('canvas', { class: 'heat' }); const full = a.counts.indexOf(a.max); const inB = ks.filter(k => E.hashMod(a.hash, k, m) === full).slice(0, 8);
    maps.append(h('div', null, h('div', { class: 'row', style: { marginBottom: '3px' } }, h('span', { class: 'sw', style: { background: COLORS[a.hash] } }), h('b', null, a.hash), h('span', { class: 'muted small' }, `fullest bucket #${full} holds ${a.max} keys: ` + inB.join(', ') + (a.max > 8 ? ' …' : ''))), cv)); setTimeout(() => heat(cv, a.counts), 0); });
  box.append(h('div', { class: 'card' }, h('h3', null, 'Bucket occupancy map'), h('div', { class: 'legend', style: { marginBottom: '8px' } },
    [['var(--surface2)', 'empty'], ['#9db8f0', '1 key'], ['#e8c26a', '2 keys'], ['#e8873a', '3 keys'], ['#c23a2e', '4+ keys']].map(([c, l]) => h('span', null, h('i', { style: { background: c, borderColor: c } }), l))), maps));
}
function build() {
  ui.boxes = {}; const hl = h('div', { class: 'col', style: { gap: '4px' } });
  E.HASH_NAMES.forEach(n => { ui.boxes[n] = h('input', { type: 'checkbox', checked: true }); hl.append(h('label', { class: 'check' }, ui.boxes[n], h('span', { class: 'sw', style: { background: COLORS[n] } }), h('b', null, n), h('span', { class: 'muted small' }, ' ' + E.HASHES[n].desc))); });
  ui.wl = h('select', null, [['random', 'Random identifiers'], ['sequential', 'Sequential (var0, var1, …)'], ['code', 'Code-like names'], ['custom', 'Identifiers from the Compiler tab']].map(([v, l]) => h('option', { value: v }, l)));
  ui.n = h('input', { type: 'number', min: 1, value: 7000 }); ui.m = h('input', { type: 'number', min: 3, value: 10007 }); ui.seed = h('input', { type: 'number', value: 1 });
  ui.log = h('input', { type: 'checkbox', onchange: () => chart && chart.update({ ...chart.spec, log: ui.log.checked }) }); ui.err = h('div', { class: 'banner bad hidden', style: { marginBottom: '8px' } }); ui.out = h('div', { class: 'stack' });
  const left = h('div', { class: 'stack' }, h('div', { class: 'card' }, h('h3', null, 'Hash functions'), hl),
    h('div', { class: 'card' }, h('h3', null, 'Input'), h('div', { class: 'field' }, h('label', null, 'Identifiers'), ui.wl),
      h('div', { class: 'two' }, h('div', { class: 'field' }, h('label', null, 'Number of keys'), ui.n), h('div', { class: 'field' }, h('label', null, 'Table size'), ui.m)), h('div', { class: 'field' }, h('label', null, 'Random seed'), ui.seed),
      h('label', { class: 'check', style: { marginBottom: '10px' } }, ui.log, 'log scale for the chart'), ui.err, h('button', { class: 'btn primary block', onclick: run }, '▶ Analyse distribution')));
  root.append(h('div', { class: 'intro' }, h('h2', null, 'Hash lab'), h('p', null, 'Collision resolution can only work as well as the hash function lets it. Hash the same identifiers with all five functions and see how evenly they land in the buckets - the sum-of-characters hash is deliberately weak to show what clustering looks like.')),
    h('div', { class: 'split' }, left, ui.out));
  run();
}
build();
})();
