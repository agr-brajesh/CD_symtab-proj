(function () {
'use strict';
const root = $('#pane-home');
const card = (ic, title, text, tab, cta) => h('button', { class: 'bigcard', onclick: () => App.show(tab) }, h('span', { class: 'ic' }, ic), h('b', null, title), h('span', { class: 'd' }, text), h('span', { class: 'badge info', style: { marginTop: '12px' } }, cta + ' →'));
root.append(
  h('div', { class: 'hero' }, h('h2', null, 'How fast can a compiler find a name?'),
    h('p', null, 'Every identifier in a program is looked up in the symbol table. When two names land in the same slot, how the table resolves that collision decides how fast compilation runs. Compare eight strategies, change any value, and see the result.'),
    h('div', { class: 'facts' }, h('span', null, '8 strategies'), h('span', null, '5 hash functions'), h('span', null, 'C++ reference + verified web port'), h('span', null, 'works offline'))),
  h('div', { class: 'cards3' },
    card('👀', 'Watch it work', 'Insert, search and delete names in a small table and follow every probe, step by step.', 'viz', 'Open the visualizer'),
    card('📊', 'Run an experiment', 'Pick a preset, change table size, load, hash function or workload, and compare all strategies on the same keys.', 'bench', 'Open the benchmark'),
    card('💻', 'Try real code', 'Paste a C, Java or Python program and see how each strategy handles its identifiers and scopes.', 'comp', 'Open compiler mode')));
// headline result from the compiled C++ benchmark (embedded data)
try {
  const lines = $('#cppResultsCsv').textContent.trim().split(/\r?\n/), head = lines.shift().split(',');
  const rows = lines.map(l => { const p = l.split(','), o = {}; head.forEach((k, i) => o[k] = p[i]); return o; }).filter(r => +r.load_factor === 0.9);
  const mx = Math.max(...rows.map(r => +r.avg_search_probes_miss)), body = h('div', { class: 'col', style: { gap: '7px' } });
  rows.sort((a, b) => +a.avg_search_probes_miss - +b.avg_search_probes_miss).forEach(r => { const S = E.STRATEGIES.find(s => s.name === r.strategy); if (!S) return;
    body.append(h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('span', { style: { width: '190px', flex: 'none' } }, S.name), h('div', { class: 'bar' }, h('i', { style: { width: Math.max(1.5, +r.avg_search_probes_miss / mx * 100) + '%', background: S.color } })), h('b', { class: 'mono', style: { width: '56px', textAlign: 'right' } }, fix(+r.avg_search_probes_miss, 1)))); });
  root.append(h('div', { class: 'card' }, h('h3', null, 'The headline result'), h('p', { class: 'muted', style: { margin: '4px 0 12px' } }, 'Average slots examined to prove a name is NOT in a table that is 90% full (compiled C++ benchmark, 10,007 slots). Lower is better.'), body,
    h('p', { class: 'small muted', style: { marginTop: '10px' } }, 'Linear probing’s long clusters make a failed search dramatically slower; chaining and the hybrids stay far lower (Robin Hood 6.1 vs 50.7). Hash Lab, Tests and Guide are in the top bar.')));
} catch (e) { /* no embedded data */ }
})();
