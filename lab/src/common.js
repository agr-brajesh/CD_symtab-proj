/* =============================================================================
   common.js - helpers shared by all tabs
   ============================================================================= */
'use strict';
const E = SymEngine, LX = SymLexer;
const App = { engine: 'js', bridge: { base: null, ok: false, info: null }, charts: new Set(), onTheme: [] };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
function h(tag, attrs, ...kids) {
  if (attrs !== null && attrs !== undefined && (typeof attrs !== 'object' || Array.isArray(attrs) || attrs.nodeType)) { kids.unshift(attrs); attrs = null; }   // h('li', 'text')
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = c => { if (c === null || c === undefined || c === false) return; if (Array.isArray(c)) c.forEach(add); else el.append(c.nodeType ? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  return el;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tick = () => new Promise(r => setTimeout(r, 0));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fmt(v, d = 2) {
  if (v === undefined || v === null || Number.isNaN(v)) return '–';
  if (!isFinite(v)) return '∞';
  if (Math.abs(v) >= 1e7) return v.toExponential(2);
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d });
}
const fix = (v, d = 2) => (v === undefined || v === null || Number.isNaN(v) ? '–' : (isFinite(v) ? v.toFixed(d) : '∞'));
function toast(msg) {
  let t = $('#toast'); if (!t) { t = h('div', { class: 'toast', id: 'toast' }); document.body.append(t); }
  t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2200);
}
function download(name, text, mime) {
  const url = typeof text === 'string' ? URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' })) : text;
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); if (typeof text === 'string') setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) { const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  toast('Copied to clipboard');
}
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function parseNumList(str) {            // "1,2,3" or "0.1:0.9:0.2" (start:end:step) or mixed
  const out = [];
  for (const part of String(str).split(/[\s,;]+/).filter(Boolean)) {
    if (part.includes(':')) {
      const [a, b, s] = part.split(':').map(Number);
      if ([a, b, s].some(Number.isNaN) || s <= 0) throw new Error('bad range "' + part + '"');
      for (let v = a; v <= b + 1e-9 && out.length < 500; v += s) out.push(Math.round(v * 1e9) / 1e9);
    } else { const v = Number(part); if (Number.isNaN(v)) throw new Error('"' + part + '" is not a number'); out.push(v); }
  }
  return out;
}
function csvEscape(v) { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

/* ------------------------------------------------------------------ theme */
function setTheme(t) {
  document.documentElement.dataset.theme = t; try { localStorage.setItem('symlab-theme', t); } catch (e) { /* file:// may block */ }
  App.onTheme.forEach(f => f());
}

/* ------------------------------------------------------------------ charts (Chart.js wrapper) */
function makeChart(canvas, spec) {
  const api = { chart: null, spec };
  const build = () => {
    const s = api.spec, text = cssVar('--muted'), grid = cssVar('--border'), surf = cssVar('--surface');
    const bar = s.type === 'bar';
    const datasets = s.datasets.map(d => {
      const data = s.log ? d.data.map(v => (v > 0 ? v : null)) : d.data;
      return bar
        ? { label: d.label, data, backgroundColor: d.color, borderColor: d.color, borderWidth: 0, borderRadius: 3 }
        : { label: d.label, data, borderColor: d.color, backgroundColor: d.color, borderWidth: d.bold ? 3 : 2, tension: 0.15, pointRadius: d.noPoints ? 0 : 3, pointHoverRadius: 5,
            borderDash: d.dashed ? [7, 5] : undefined, spanGaps: true, pointStyle: d.kind === 'hybrid' ? 'rectRot' : 'circle', hidden: !!d.hidden };
    });
    const cfg = {
      type: bar ? 'bar' : 'line', data: { labels: s.labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 220 }, interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: s.legend !== false, labels: { color: cssVar('--text'), usePointStyle: true, boxWidth: 8, font: { size: 12 } } },
          tooltip: { callbacks: { label: c => ' ' + c.dataset.label + ': ' + (c.parsed.y === null ? '–' : fmt(c.parsed.y, 3)) } },
          bg: { color: surf },
        },
        scales: {
          x: { title: { display: !!s.xTitle, text: s.xTitle, color: text }, ticks: { color: text, maxRotation: 0, autoSkip: true }, grid: { color: grid } },
          y: { type: s.log ? 'logarithmic' : 'linear', beginAtZero: !s.log, title: { display: !!s.yTitle, text: s.yTitle, color: text }, ticks: { color: text }, grid: { color: grid } },
        },
      },
      plugins: [{ id: 'bg', beforeDraw(ch, a, o) { const c = ch.ctx; c.save(); c.globalCompositeOperation = 'destination-over'; c.fillStyle = o.color || '#fff'; c.fillRect(0, 0, ch.width, ch.height); c.restore(); } }],
    };
    if (api.chart) api.chart.destroy();
    api.chart = new Chart(canvas, cfg);
  };
  api.update = spec2 => { api.spec = spec2 || api.spec; build(); };
  api.png = () => api.chart.toBase64Image('image/png', 1);
  api.destroy = () => { if (api.chart) api.chart.destroy(); App.charts.delete(api); };
  App.charts.add(api); build();
  return api;
}
App.onTheme.push(() => App.charts.forEach(c => c.update()));

/* ------------------------------------------------------------------ strategy picker */
function strategyPicker(selected, onchange) {
  const sel = new Set(selected || E.STRATEGIES.map(s => s.id));
  const list = h('div', { class: 'strat-list' });
  const boxes = E.STRATEGIES.map(s => {
    const cb = h('input', { type: 'checkbox', checked: sel.has(s.id), onchange: () => { cb.checked ? sel.add(s.id) : sel.delete(s.id); onchange && onchange(); } });
    list.append(h('label', { title: s.desc }, cb, h('span', { class: 'sw', style: { background: s.color } }), s.name, h('span', { class: 'tagk' }, s.kind)));
    return { cb, s };
  });
  const setAll = f => { boxes.forEach(b => { b.cb.checked = f(b.s); b.cb.checked ? sel.add(b.s.id) : sel.delete(b.s.id); }); onchange && onchange(); };
  const quick = h('div', { class: 'row', style: { marginTop: '6px' } },
    h('button', { class: 'btn small', onclick: () => setAll(() => true) }, 'All'),
    h('button', { class: 'btn small', onclick: () => setAll(s => s.kind === 'classic') }, 'Classic'),
    h('button', { class: 'btn small', onclick: () => setAll(s => s.kind === 'hybrid') }, 'Hybrid'),
    h('button', { class: 'btn small', onclick: () => setAll(() => false) }, 'None'));
  return { el: h('div', null, list, quick), get: () => E.STRATEGIES.map(s => s.id).filter(i => sel.has(i)), set: ids => setAll(s => ids.includes(s.id)) };
}

/* ------------------------------------------------------------------ hybrid parameter fields */
const PARAM_DEFS = [
  { k: 'treeify',   label: 'H1 treeify threshold', hint: 'a chain longer than this becomes a red-black tree', min: 1, max: 64, def: 8 },
  { k: 'untreeify', label: 'H1 untreeify size',    hint: 'a tree this small (or smaller) reverts to a list', min: 0, max: 64, def: 4 },
  { k: 'window',    label: 'H2 probe window',      hint: 'slots probed before spilling to the overflow chain', min: 1, max: 256, def: 8 },
  { k: 'bucket',    label: 'H3 slots per bucket',  hint: 'cuckoo bucket size B', min: 1, max: 16, def: 4 },
  { k: 'stash',     label: 'H3 stash size',        hint: 'entries that absorb failed kick chains', min: 0, max: 64, def: 4 },
  { k: 'maxkick',   label: 'H3 max kicks',         hint: 'displacement chain length before using the stash', min: 1, max: 1000, def: 200 },
];
function paramFields(defaults, onchange, only) {
  const inputs = {}; const grid = h('div', { class: 'two' });
  PARAM_DEFS.filter(p => !only || only.includes(p.k)).forEach(p => {
    const inp = h('input', { type: 'number', min: p.min, max: p.max, step: 1, value: (defaults && defaults[p.k] !== undefined) ? defaults[p.k] : p.def, onchange: () => onchange && onchange() });
    inputs[p.k] = inp; grid.append(h('div', { class: 'field', title: p.hint }, h('label', null, p.label), inp));
  });
  return { el: grid, inputs, get: () => { const o = {}; for (const k in inputs) o[k] = Number(inputs[k].value); return o; },
           set: o => { for (const k in o) if (inputs[k]) inputs[k].value = o[k]; }, show: (ks) => { PARAM_DEFS.forEach(p => { if (inputs[p.k]) inputs[p.k].closest('.field').classList.toggle('hidden', !ks.includes(p.k)); }); } };
}

/* ------------------------------------------------------------------ C++ bridge + engine dispatcher */
const FIELDS = ['reps', 'ops', 'inserts', 'insertProbes', 'maxInsertProbes', 'lookups', 'lookupProbes', 'maxLookupProbes', 'found', 'failed', 'collisions', 'resizes', 'size', 'capacity', 'memory'];
function compareResults(a, b) {         // number of counter mismatches between two engine outputs (timings are ignored)
  let diffs = 0, total = 0;
  if (a.results.length !== b.results.length) return { diffs: 1, total: 1 };
  for (let i = 0; i < a.results.length; i++) for (let p = 0; p < a.results[i].phases.length; p++) for (const f of FIELDS) { total++; if (a.results[i].phases[p][f] !== b.results[i].phases[p][f]) diffs++; }
  return { diffs, total };
}
function setEnginePill() {
  const pill = $('#bridgePill'), cppBtn = $('#engCpp');
  if (!pill) return;
  const b = App.bridge;
  pill.className = 'pill ' + (b.ok ? 'ok' : '');
  pill.innerHTML = '<span class="dot"></span>' + (b.ok ? 'C++ bridge on' : 'C++ bridge off');
  pill.title = b.ok ? 'Connected to ' + b.base + ' - experiments can run in the compiled C++ code' : 'Optional. Start it with:  python3 lab/server.py   (then reload)';
  cppBtn.disabled = !b.ok;
  if (!b.ok && App.engine === 'cpp') setEngine('js');
}
function setEngine(e) { App.engine = 'js'; return;
  /* (unused) */
  App.engine = e; $('#engJs').classList.toggle('on', e === 'js'); $('#engCpp').classList.toggle('on', e === 'cpp');
  $$('.engine-note').forEach(n => { n.textContent = e === 'cpp' ? 'Running in the compiled C++ library (native timings).' : 'Running in the browser (JavaScript port, identical probe counts; timings are JS timings).'; });
}
async function detectBridge() {
  const cands = [];
  if (/^https?:/.test(location.protocol)) cands.push(location.origin);
  cands.push('http://127.0.0.1:8765');
  for (const base of cands) {
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 1500);
      const r = await fetch(base + '/api/ping', { signal: ctl.signal }); clearTimeout(to);
      if (r.ok) { const j = await r.json(); if (j.cpp) { App.bridge = { base, ok: true, info: j.info }; break; } }
    } catch (e) { /* try next */ }
  }
  setEnginePill();
}
async function bridgeRun(text) {
  const r = await fetch(App.bridge.base + '/api/run', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: text });
  if (!r.ok) throw new Error('bridge error ' + r.status + ': ' + (await r.text()).slice(0, 300));
  return r.json();
}
async function jsRun(sids, opts, phases) {
  const results = [];
  for (const s of sids) { results.push(E.runStrategy(s, opts, phases)); await tick(); }
  return { engine: 'js', results };
}
/* run a script on the selected engine; with crosscheck=true (needs the bridge) run on BOTH and compare the counters */
async function runScript(sids, opts, phases, o) {
  o = o || {}; const engine = o.engine || App.engine;
  if (engine === 'cpp' && App.bridge.ok) {
    const res = await bridgeRun(E.scriptToText(sids, opts, phases));
    if (o.crosscheck) { const js = await jsRun(sids, opts, phases); res.cross = compareResults(js, res); }
    return res;
  }
  const res = await jsRun(sids, opts, phases);
  if (o.crosscheck && App.bridge.ok) { const c = await bridgeRun(E.scriptToText(sids, opts, phases)); res.cross = compareResults(res, c); }
  return res;
}
