/* =============================================================================
   compiler.js - "Compiler" tab: real source code -> symbol-table traffic -> strategy comparison
   ============================================================================= */
(function () {
'use strict';
const root = $('#pane-comp');
const CM = [
  { k: 'avgLookupProbes', label: 'Avg probes / lookup', d: 3 }, { k: 'avgInsertProbes', label: 'Avg probes / insert', d: 3 },
  { k: 'maxLookupProbes', label: 'Max probes (lookup)', d: 0 }, { k: 'maxInsertProbes', label: 'Max probes (insert)', d: 0 },
  { k: 'collisions', label: 'Collisions', d: 0 }, { k: 'resizes', label: 'Resizes', d: 0 },
  { k: 'nsPerOp', label: 'Time (ns / operation)', d: 1 }, { k: 'ms', label: 'Total time (ms)', d: 2 }, { k: 'bytesPerEntry', label: 'Memory (bytes / entry)', d: 1 },
];
let ui = {}, last = null, chart = null, metric = 'avgLookupProbes', toks = null, info = null;

function analyse() {
  const src = ui.src.value; if (!src.trim()) { toast('Paste or load some source code first'); return null; }
  toks = LX.tokenize(src); if (toks.length > 400000) { toast('Source is too large for the browser (limit 400,000 tokens)'); return null; }
  info = LX.describe(toks, src); renderInfo(); return info;
}
function renderInfo() {
  const i = info, c = (v, l) => h('div', { class: 'stat' }, h('b', null, v), h('span', null, l));
  ui.info.innerHTML = '';
  ui.info.append(h('div', { class: 'stats' }, c(fmt(i.lines, 0), 'lines'), c(fmt(i.identifiers, 0), 'identifier tokens'), c(fmt(i.unique, 0), 'distinct identifiers'), c(fmt(i.keywords, 0), 'reserved words'),
    c(fix(i.avgLen, 1), 'avg identifier length'), c(fmt(i.blocks, 0), '{ } blocks'), c(i.maxDepth, 'max nesting'), c(fix(i.reuse * 100, 1) + '%', 'repeat references')),
    h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'Most frequent identifiers: ', i.top.map(([k, n]) => h('span', { class: 'mono', style: { marginRight: '10px' } }, k + '×' + n))));
}
async function run() {
  if (!analyse()) return;
  const sids = ui.strat.get(); if (!sids.length) { toast('Select at least one strategy'); return; }
  const preload = ui.preload.checked, scopes = ui.scopes.checked;
  const built = LX.buildOps(toks, { preload, scopes });
  const o = { capacity: +ui.capacity.value || 1031, hash: ui.hash.value, autoResize: ui.mode.value === 'auto', maxLoad: +ui.maxLoad.value || 0.7, ...ui.params.get() };
  ui.run.disabled = true; ui.run.textContent = 'Running…'; ui.err.classList.add('hidden');
  try {
    const t0 = performance.now();
    const res = await runScript(sids, o, built.phases, { crosscheck: ui.cross.checked && App.bridge.ok });
    const prog = built.phases[built.phases.length - 1], resolves = prog.ops.t.reduce((a, t) => a + (t === E.OP.SR ? 1 : 0), 0);
    const rows = res.results.map(r => { const p = r.phases[r.phases.length - 1], per = (a, b) => (b > 0 ? a / b : 0);
      return { sid: r.strategy, name: r.name, kind: r.kind, ok: p.found === prog.expectedFound, found: p.found, expected: prog.expectedFound,
        avgLookupProbes: per(p.lookupProbes, p.lookups), avgInsertProbes: per(p.insertProbes, p.inserts), maxLookupProbes: p.maxLookupProbes, maxInsertProbes: p.maxInsertProbes,
        collisions: p.collisions, resizes: p.resizes, nsPerOp: per(p.ms * 1e6, p.ops), ms: p.ms, bytesPerEntry: per(p.memory, p.size), lookups: p.lookups, inserts: p.inserts, size: p.size, capacity: p.capacity }; });
    last = { rows, built, resolves, cross: res.cross || null, engine: res.engine, o, ms: performance.now() - t0 }; render();
  } catch (e) { ui.err.textContent = 'Run failed: ' + e.message; ui.err.classList.remove('hidden'); }
  ui.run.disabled = false; ui.run.textContent = '▶ Run symbol table on this program';
}
function spec() {
  const rs = last.rows, m = CM.find(x => x.k === metric);
  return { type: 'bar', labels: rs.map(r => E.STRATEGIES[r.sid].short), datasets: [{ label: m.label, data: rs.map(r => r[metric]), color: rs.map(r => E.STRATEGIES[r.sid].color) }], yTitle: m.label, legend: false, log: false };
}
function render() {
  const box = ui.out; box.innerHTML = '';
  if (chart) { chart.destroy(); chart = null; }
  const bad = last.rows.filter(r => !r.ok), b = last.built;
  box.append(h('div', { class: 'banner ' + (bad.length ? 'bad' : 'ok') }, h('span', { class: 'badge ' + (bad.length ? 'bad' : 'ok') }, bad.length ? '✗ mismatch' : '✓ verified'),
    bad.length ? 'These strategies resolved a different set of symbols than the reference scope model: ' + bad.map(x => x.name).join(', ')
               : `Every strategy resolved the same ${fmt(b.resolved, 0)} references and declared the same ${fmt(b.declared, 0)} symbols as an independent reference implementation of the scope rules.`,
    h('span', { class: 'muted small', style: { marginLeft: 'auto' } }, `${last.engine === 'cpp' ? 'C++ (native)' : 'JavaScript'} · ${fmt(last.ms, 0)} ms`)));
  if (last.cross) box.append(h('div', { class: 'banner ' + (last.cross.diffs ? 'bad' : 'ok'), style: { marginTop: '8px' } }, h('span', { class: 'badge ' + (last.cross.diffs ? 'bad' : 'ok') }, last.cross.diffs ? '✗ engines differ' : '✓ engines agree'),
    last.cross.diffs ? last.cross.diffs + ' counters differ between JS and C++' : `JS and C++ produced identical counters (${fmt(last.cross.total, 0)} compared).`));
  const first = last.rows[0], lk = first ? first.lookups : 0, ins = first ? first.inserts : 0;
  box.append(h('div', { class: 'card' }, h('h3', null, 'Symbol-table traffic generated by this program'),
    h('div', { class: 'stats' }, [[fmt(b.ops, 0), 'operations replayed'], [fmt(last.resolves, 0), 'name resolutions (SR)'], [fmt(b.declared, 0), 'declarations (SD)'], [fmt(lk, 0), 'table lookups'], [fmt(ins, 0), 'table inserts'],
      [fix(last.resolves ? lk / last.resolves : 0, 2), 'lookups per resolution']].map(([v, l]) => h('div', { class: 'stat' }, h('b', null, v), h('span', null, l)))),
    h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'A resolution walks the scope chain inner → outer, so one reference can cost several lookups. Entering a scope allocates nothing; leaving one erases its symbols (exercising deletion).')));
  const chips = h('div', { class: 'chips', style: { marginBottom: '10px' } }, CM.map(m => h('span', { class: 'chip' + (m.k === metric ? ' on' : ''), onclick: () => { metric = m.k; render(); } }, m.label)));
  box.append(h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, CM.find(x => x.k === metric).label), h('button', { class: 'btn small', onclick: () => download('compiler_' + metric + '.png', chart.png()) }, '⬇ PNG')), chips,
    h('div', { class: 'chart-box short' }, ui.canvas = h('canvas'))));
  chart = makeChart(ui.canvas, spec());
  const cols = CM.map(m => m.k);
  const rs = last.rows.slice(); const heat = {};
  cols.forEach(k => { const v = rs.map(r => r[k]); const lo = Math.min(...v), hi = Math.max(...v); rs.forEach(r => { heat[r.sid + k] = hi - lo < 1e-12 ? '' : (f => (f < 0.1 ? 'h0' : f < 0.3 ? 'h1' : f > 0.9 ? 'h4' : f > 0.7 ? 'h3' : ''))((r[k] - lo) / (hi - lo)); }); });
  box.append(h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, 'Comparison'),
    h('button', { class: 'btn small', onclick: () => download('compiler_results.csv', ['strategy,' + cols.join(','), ...rs.map(r => [r.name, ...cols.map(k => r[k])].map(csvEscape).join(','))].join('\n') + '\n', 'text/csv') }, '⬇ CSV')),
    h('div', { class: 'tablewrap' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Strategy'), CM.map(m => h('th', null, m.label)), h('th', null, 'final load'))),
      h('tbody', null, rs.map(r => h('tr', null, h('td', { class: 'l' }, h('span', { class: 'sw', style: { background: E.STRATEGIES[r.sid].color, marginRight: '7px' } }), r.name),
        cols.map(k => h('td', { class: heat[r.sid + k] }, fmt(r[k], CM.find(m => m.k === k).d))), h('td', null, fix(r.size / r.capacity, 2)))))))));
}

function build() {
  ui.src = h('textarea', { rows: 16, spellcheck: 'false', style: { minHeight: '260px' } }); ui.src.value = LX.SAMPLES.c.code;
  ui.info = h('div'); ui.out = h('div', { class: 'stack' }); ui.err = h('div', { class: 'banner bad hidden', style: { marginBottom: '8px' } });
  const sampleSel = h('select', { onchange: () => { if (sampleSel.value) { ui.src.value = LX.SAMPLES[sampleSel.value].code; analyse(); } } }, h('option', { value: '' }, 'Load a sample…'), Object.entries(LX.SAMPLES).map(([k, s]) => h('option', { value: k }, s.label)));
  const genN = h('input', { type: 'number', min: 100, max: 100000, value: 5000, style: { width: '90px' } });
  const upl = h('input', { type: 'file', class: 'hidden', accept: '.c,.h,.cpp,.cc,.hpp,.java,.js,.ts,.py,.cs,.go,.rs,.txt', onchange: async e => { const f = e.target.files[0]; if (!f) return; ui.src.value = await f.text(); analyse(); toast('Loaded ' + f.name); } });
  ui.hash = h('select', null, E.HASH_NAMES.map(n => h('option', { value: n }, n)));
  ui.capacity = h('input', { type: 'number', min: 3, value: 31 }); ui.mode = h('select', { onchange: () => ui.maxLoadF.classList.toggle('hidden', ui.mode.value !== 'auto') }, h('option', { value: 'auto' }, 'Auto-resize (a real compiler grows its table)'), h('option', { value: 'fixed' }, 'Fixed capacity'));
  ui.maxLoad = h('input', { type: 'number', min: 0.1, max: 0.98, step: 0.05, value: 0.7 }); ui.maxLoadF = h('div', { class: 'field' }, h('label', null, 'Max load before resizing'), ui.maxLoad);
  ui.preload = h('input', { type: 'checkbox', checked: true }); ui.scopes = h('input', { type: 'checkbox', checked: true });
  ui.cross = h('input', { type: 'checkbox' }); ui.crossF = h('label', { class: 'check hidden' }, ui.cross, 'Cross-check against C++');
  ui.params = paramFields({}); ui.strat = strategyPicker(null);
  ui.run = h('button', { class: 'btn primary block', onclick: run }, '▶ Run symbol table on this program');
  const left = h('div', { class: 'stack' },
    h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, 'Source program'), sampleSel), ui.src,
      h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn small', onclick: () => upl.click() }, 'Upload file…'), upl,
        h('button', { class: 'btn small', onclick: () => { ui.src.value = LX.generateProgram(Math.max(100, +genN.value || 5000), 7); analyse(); } }, 'Generate large program'), genN, h('span', { class: 'small muted' }, 'lines'))),
    h('div', { class: 'card' }, h('h3', null, 'Compiler settings'),
      h('label', { class: 'check', style: { marginBottom: '6px' } }, ui.preload, 'Pre-load reserved words into the table (classic lexer design)'),
      h('label', { class: 'check', style: { marginBottom: '10px' } }, ui.scopes, 'Block scopes: { opens a scope, } closes it and erases its symbols'),
      h('div', { class: 'two' }, h('div', { class: 'field' }, h('label', null, 'Hash function'), ui.hash), h('div', { class: 'field' }, h('label', null, 'Initial capacity'), ui.capacity)),
      h('div', { class: 'field' }, h('label', null, 'Table mode'), ui.mode), ui.maxLoadF),
    h('details', { class: 'card' }, h('summary', null, 'Hybrid-scheme parameters'), ui.params.el),
    h('details', { class: 'card', open: true }, h('summary', null, 'Strategies to compare'), ui.strat.el),
    h('div', { class: 'card' }, ui.crossF, h('div', { class: 'small muted engine-note', style: { margin: '6px 0 10px' } }), ui.err, ui.run));
  const right = h('div', { class: 'stack' }, h('div', { class: 'card' }, h('h3', null, 'What the front-end sees'), ui.info), ui.out);
  root.append(h('div', { class: 'intro' }, h('h2', null, 'Compiler mode'), h('p', null, 'The symbol table inside a compiler is driven by real programs: every identifier is looked up, new names are declared, and leaving a block erases its locals. Paste or upload source code to replay exactly that traffic through every collision-resolution strategy.')),
    h('div', { class: 'split' }, left, right));
  analyse();
  ui.out.append(h('div', { class: 'empty' }, 'Press ', h('b', null, 'Run symbol table on this program'), ' to compare the strategies on this source code.'));
}
build();
App.compiler = { identifiers: () => (info ? info.uniqueNames : null), refresh: () => ui.crossF.classList.toggle('hidden', !App.bridge.ok), run };
})();
