/* =============================================================================
   viz.js - "Visualizer" tab: watch one table work, operation by operation
   ============================================================================= */
(function () {
'use strict';
const root = $('#pane-viz');
const S = { sid: 0, hash: 'djb2', capacity: 13, autoResize: false, maxLoad: 0.7, speed: 450, keys: [], table: null, nlog: 0, busy: false, rng: E.makeRng(2026) };
let paramUI, statsEl, vizEl, logEl, keyInp, descEl, actualEl, loadRange, loadLbl;

const RULE = { 1: j => `(home + ${j})`, 2: j => `(home + ${j}²)`, 3: j => `(home + ${j}·h₂(key))` };
const primaryMod = t => (t.b ? t.b.length : t.st ? t.st.length : t.dist ? t.dist.length : t.nb);
const validKey = k => /^[\x21-\x7e]{1,24}$/.test(k);

function opts() { return Object.assign({ capacity: S.capacity, hash: S.hash, autoResize: S.autoResize, maxLoad: S.maxLoad }, paramUI.get()); }
function rebuild(keep) {
  const old = S.keys; S.table = E.createTable(S.sid, opts()); S.keys = [];
  let dropped = 0;
  if (keep) for (const k of old) { const r = S.table.insert({ name: k, type: 0, scope: 0, line: S.keys.length }); if (r === E.INSERT_FAILED) dropped++; else S.keys.push(k); }
  S.table.stats.inserts = S.table.stats.insertProbes = S.table.stats.lookups = S.table.stats.lookupProbes = 0;
  if (dropped) toast(dropped + ' key(s) could not be placed with these settings and were dropped');
  actualEl.textContent = 'actual primary size: ' + (S.table.capacity()) + (S.sid === 7 ? ' slots' : ' (prime)');
  renderAll(S.table.snapshot()); renderStats();
}

/* ---------------------------------------------------------------- rendering */
function node(name, key, extra) { return h('div', { class: 'node ' + (extra || ''), 'data-k': key }, name); }
function render(snap, mark) {
  vizEl.innerHTML = '';
  const T = snap.type;
  if (T === 'chain' || T === 'chaintree') {
    snap.buckets.forEach((b, i) => {
      const nodes = T === 'chain' ? b : b.names, row = h('div', { class: 'chainrow' });
      row.append(h('div', { class: 'bk' + (nodes.length ? ' full' : ''), 'data-k': 'bkt-' + i }, '[' + i + ']'));
      if (T === 'chaintree' && b.tree) {
        const tb = h('div', { class: 'treebox', 'data-k': 'tree-' + i }, h('span', { class: 'tag' }, 'RB-tree · ' + nodes.length));
        nodes.forEach((n, j) => tb.append(node(n.name, `node-${i}-${j}`)));
        row.append(tb);
      } else nodes.forEach((n, j) => { if (j) row.append(h('span', { class: 'arrow' }, '→')); row.append(node(n.name, `node-${i}-${j}`)); });
      vizEl.append(row);
    });
  } else if (T === 'slots' || T === 'slots+ov') {
    const cells = h('div', { class: 'cells' });
    snap.slots.forEach((s, i) => {
      const c = h('div', { class: 'cell' + (s.s === 1 ? ' full' : s.s === 2 ? ' tomb' : ''), 'data-k': 'slot-' + i },
        h('div', { class: 'ix' }, '#' + i), h('div', { class: 'nm' }, s.s === 1 ? s.name : s.s === 2 ? 'deleted' : ''));
      if (snap.robin && s.s === 1) c.append(h('div', { class: 'dist', title: 'distance from home slot' }, 'd=' + s.dist));
      cells.append(c);
    });
    vizEl.append(cells);
    if (T === 'slots+ov') {
      vizEl.append(h('div', { class: 'sect' }, 'Overflow chains (used when the ' + snap.window + '-slot probe window is full)'));
      let any = false;
      snap.overflow.forEach((b, i) => {
        if (!b.length) return; any = true; const row = h('div', { class: 'chainrow' }, h('div', { class: 'bk full', 'data-k': 'ovb-' + i }, 'ov ' + i));
        b.forEach((n, j) => { if (j) row.append(h('span', { class: 'arrow' }, '→')); row.append(node(n.name, `ov-${i}-${j}`)); }); vizEl.append(row);
      });
      if (!any) vizEl.append(h('div', { class: 'muted small' }, 'empty - no key has spilled yet'));
    }
  } else if (T === 'cuckoo') {
    snap.buckets.forEach((b, i) => {
      const row = h('div', { class: 'bucketrow' }, h('div', { class: 'bk' }, 'b' + i)), cells = h('div', { class: 'cells tight' });
      b.forEach((s, j) => cells.append(h('div', { class: 'cell' + (s ? ' full' : ''), 'data-k': `cs-${i}-${j}` }, h('div', { class: 'ix' }, 's' + j), h('div', { class: 'nm' }, s ? s.name : ''))));
      row.append(cells); vizEl.append(row);
    });
    vizEl.append(h('div', { class: 'sect' }, 'Stash (' + snap.stash.length + ' / ' + snap.stashCap + ')'));
    const st = h('div', { class: 'cells tight' });
    for (let i = 0; i < Math.max(snap.stashCap, snap.stash.length); i++) st.append(h('div', { class: 'cell' + (snap.stash[i] ? ' full' : ''), 'data-k': 'st-' + i }, h('div', { class: 'ix' }, 'x' + i), h('div', { class: 'nm' }, snap.stash[i] ? snap.stash[i].name : '')));
    vizEl.append(st);
  }
  if (mark) mark.forEach(m => mark_(m[0], m[1]));
}
const renderAll = snap => render(snap);
function mark_(key, cls) { const el = vizEl.querySelector(`[data-k="${key}"]`); if (el) el.classList.add(cls); return el; }
function targets(ev, snapType) {
  switch (ev.k) {
    case 'slot': return ['slot-' + ev.i]; case 'node': return [`node-${ev.i}-${ev.j}`]; case 'bucket': return ['bkt-' + ev.i];
    case 'tree': return ['bkt-' + ev.i, 'tree-' + ev.i]; case 'ov': return [`ov-${ev.i}-${ev.j}`]; case 'cslot': return [`cs-${ev.i}-${ev.j}`];
    case 'stash': case 'stash-add': return ['st-' + ev.i]; case 'swap': case 'tomb': case 'shift': return ['slot-' + ev.i];
    case 'kick': return [`cs-${ev.i}-${ev.j}`]; case 'treeify': case 'untreeify': return ['bkt-' + ev.i, 'tree-' + ev.i]; case 'spill': return ['ovb-' + ev.i];
    case 'place':
      if (snapType === 'chain' || snapType === 'chaintree') return [`node-${ev.i}-0`, 'tree-' + ev.i];
      if (snapType === 'cuckoo') return [`cs-${ev.i}-${ev.j}`];
      return ['slot-' + ev.i];
  }
  return [];
}
const evClass = ev => ev.k === 'place' || ev.k === 'stash-add' || ev.k === 'spill' || ev.k === 'treeify' || ev.k === 'untreeify' ? 'probe-new'
  : ev.r === 'match' ? 'probe-match' : ev.r === 'empty' ? 'probe-empty' : ev.r === 'tomb' ? 'probe-tomb' : ev.k === 'swap' || ev.k === 'kick' ? 'probe-diff' : 'probe-diff';

function nameAt(snap, ev) {
  try {
    if (snap.type === 'chain') return snap.buckets[ev.i][ev.j].name;
    if (snap.type === 'chaintree') return snap.buckets[ev.i].names[ev.j] ? snap.buckets[ev.i].names[ev.j].name : '…';
    if (snap.type === 'slots' || snap.type === 'slots+ov') return ev.k === 'ov' ? snap.overflow[ev.i][ev.j].name : snap.slots[ev.i].name;
    if (snap.type === 'cuckoo') return ev.k === 'stash' ? snap.stash[ev.i].name : snap.buckets[ev.i][ev.j].name;
  } catch (e) { /* structure changed since the event */ }
  return '…';
}
function narrate(ev, c) {
  const n = () => '<b>' + esc(nameAt(c.snap, ev)) + '</b>', key = '<b>' + esc(c.key) + '</b>', op = c.op;
  switch (ev.k) {
    case 'bucket': return `bucket ${ev.i} is empty` + (op === 'insert' ? ' → nothing to compare' : ' → key is not in the table');
    case 'node': return ev.r === 'match' ? `node ${ev.j} of bucket ${ev.i} is ${key} → ${op === 'insert' ? 'already present, value updated' : 'found'}`
                                         : `node ${ev.j} of bucket ${ev.i} is ${n()} ≠ key → <b>collision</b>, follow the chain`;
    case 'tree': return `bucket ${ev.i} is a red-black tree (${ev.size} keys) → about ${ev.j} comparisons: ${ev.r === 'match' ? 'found' : 'not found'}`;
    case 'treeify': return `chain in bucket ${ev.i} exceeded the threshold → <b>converted to a red-black tree</b>`;
    case 'untreeify': return `tree in bucket ${ev.i} became small → <b>converted back to a chain</b>`;
    case 'ov': return ev.r === 'match' ? `overflow chain ${ev.i}, node ${ev.j} is ${key} → ${op === 'insert' ? 'already present' : 'found'}` : `overflow chain ${ev.i}, node ${ev.j} is ${n()} ≠ key → next`;
    case 'spill': return `probe window is full → key <b>spilled</b> to overflow chain ${ev.i}`;
    case 'slot': {
      if (ev.dist !== undefined) {                                   // Robin Hood
        if (ev.r === 'empty') return `slot ${ev.i} is empty → ` + (op === 'insert' ? 'place the key here' : 'key is not in the table');
        if (ev.r === 'match') return `slot ${ev.i} holds ${key} → ${op === 'insert' ? 'already present, updated' : 'found'}`;
        if (op !== 'insert' && ev.dist < ev.myDist) return `slot ${ev.i} holds ${n()} which is only ${ev.dist} from home but the key would be ${ev.myDist} → key cannot be further on: <b>early stop</b>, not found`;
        return `slot ${ev.i} holds ${n()} (${ev.dist} from home), key is ${ev.myDist} from home → ` + (op === 'insert' && ev.dist < ev.myDist ? 'key is "poorer": it will take this slot' : 'move on to the next slot');
      }
      if (ev.r === 'empty') return `slot ${ev.i} is empty → ` + (op === 'insert' ? 'place the key here' : 'key cannot be further along: <b>not found</b>');
      if (ev.r === 'tomb') return `slot ${ev.i} is a tombstone (deleted entry) → keep probing` + (op === 'insert' ? ' (it can be reused if the key is absent)' : '');
      if (ev.r === 'match') return `slot ${ev.i} holds ${key} → ${op === 'insert' ? 'already present, updated' : 'found'}`;
      const rule = c.sid === 6 ? `(home + ${ev.j + 1}) inside the window` : (RULE[c.sid] || RULE[1])(ev.j + 1);
      return `slot ${ev.i} holds ${n()} ≠ key → <b>collision</b>, next probe ${rule} mod m`;
    }
    case 'swap': return `key is ${ev.myDist} from home, ${esc(nameAt(c.snap, { k: 'slot', i: ev.i }) === '…' ? ev.name : ev.name)} only ${ev.dist} → <b>swap</b>: the key takes slot ${ev.i}, the resident continues probing`;
    case 'shift': return `backward-shift deletion: the entry in slot ${ev.i} moves one slot closer to home`;
    case 'tomb': return `slot ${ev.i} marked as a tombstone`;
    case 'place': return ev.note ? ev.note.charAt(0).toUpperCase() + ev.note.slice(1) + (ev.i !== undefined && c.sid !== 5 && c.sid !== 0 && c.sid !== 7 ? ` (slot ${ev.i})` : ` (bucket ${ev.i})`) : 'placed';
    case 'cslot': return ev.r === 'empty' ? `bucket ${ev.i}, slot ${ev.j} is empty` + (op === 'insert' ? ' → place the key here' : '')
                        : ev.r === 'match' ? `bucket ${ev.i}, slot ${ev.j} holds ${key} → ${op === 'insert' ? 'already present' : 'found'}` : `bucket ${ev.i}, slot ${ev.j} holds ${n()} ≠ key`;
    case 'kick': return `both buckets are full → <b>evict</b> ${esc(ev.name)} from bucket ${ev.i} and re-insert it into its other bucket`;
    case 'stash': return ev.r === 'match' ? `stash entry ${ev.i} is ${key} → found` : `stash entry ${ev.i} ≠ key`;
    case 'stash-add': return `kick chain too long → <b>${esc(ev.name)}</b> parked in the stash`;
    case 'resize': return `<b>table grows</b> ${ev.from} → ${ev.to} slots; every key is rehashed`;
  }
  return ev.k;
}

/* ---------------------------------------------------------------- operations */
function renderStats() {
  const t = S.table, st = t.stats, cell = (v, l) => h('div', { class: 'stat' }, h('b', null, v), h('span', null, l));
  statsEl.innerHTML = ''; statsEl.append(
    cell(t.size(), 'keys stored'), cell(t.capacity(), 'capacity'), cell(fix(t.loadFactor(), 2), 'load factor'),
    cell(st.collisions, 'collisions'), cell(st.resizes, 'resizes'), cell(st.failed, 'failed inserts'),
    cell(st.inserts ? fix(st.insertProbes / st.inserts, 2) : '–', 'avg probes / insert'), cell(st.lookups ? fix(st.lookupProbes / st.lookups, 2) : '–', 'avg probes / search'),
    cell(st.lastProbes || '–', 'probes, last op'));
}
async function operate(op, key) {
  if (S.busy) return; key = key.trim();
  if (!validKey(key)) { toast('Use 1-24 printable characters without spaces'); return; }
  S.busy = true; setBusy(true);
  const t = S.table; const before = t.snapshot(); t.tr = [];
  const m = primaryMod(t); const home = E.hashMod(S.hash, key, m);
  let res, resText, ok = true;
  if (op === 'insert') {
    const r = t.insert({ name: key, type: 0, scope: 0, line: S.keys.length });
    res = r; if (r === E.INSERT_OK) { S.keys.push(key); resText = 'inserted'; } else if (r === E.INSERT_EXISTS) resText = 'already present (value updated)'; else { resText = 'FAILED - the fixed-capacity table cannot place this key'; ok = false; }
  } else if (op === 'search') { const f = t.lookup(key); resText = f ? 'found' : 'not found'; ok = !!f; }
  else { const d = t.erase(key); if (d) S.keys = S.keys.filter(k => k !== key); resText = d ? 'deleted' : 'not found - nothing deleted'; ok = d; }
  const events = t.tr; t.tr = null; const after = t.snapshot();
  const hdr = h('div', { class: 'hd' }, h('span', { class: 'badge info' }, op.toUpperCase()), h('span', { class: 'mono' }, key),
    h('span', { class: 'muted small' }, `h(key) mod ${m} = ${home}`), h('span', { class: 'badge ' + (ok ? 'ok' : 'warn') }, resText), h('span', { class: 'muted small' }, (t.stats.lastProbes || 0) + ' probe(s)'));
  const ol = h('ol'); const entry = h('div', { class: 'logop' }, hdr, ol);
  logEl.prepend(entry); while (logEl.children.length > 25) logEl.lastChild.remove();
  const lis = []; let cur = before; const ctx = { op, key, sid: S.sid, snap: before };
  const seq = events.filter(e => e.k !== 'cslot' || true);
  for (const ev of seq) {
    if (ev.k === 'resize' || ['place', 'swap', 'kick', 'spill', 'tomb', 'shift', 'treeify', 'untreeify', 'stash-add'].includes(ev.k)) { cur = after; }
    ctx.snap = cur; const li = h('li', { html: narrate(ev, ctx) }); ol.append(li); lis.push({ ev, li, snap: cur });
  }
  if (!events.length) ol.append(h('li', null, 'no probes needed'));
  // animate
  if (S.speed > 0 && lis.length) {
    let shown = before; render(shown);
    const visited = [];
    for (const { ev, li, snap } of lis) {
      if (snap !== shown) { shown = snap; render(shown); }
      $$('.probe-diff,.probe-match,.probe-empty,.probe-tomb,.probe-new', vizEl).forEach(e => e.classList.remove('probe-diff', 'probe-match', 'probe-empty', 'probe-tomb', 'probe-new'));
      ol.querySelectorAll('li.cur').forEach(x => x.classList.remove('cur')); li.classList.add('cur');
      const ts = targets(ev, shown.type), cls = evClass(ev);
      ts.forEach(k => { const el = mark_(k, cls); if (el && el.scrollIntoView) { /* keep in view */ const r = el.getBoundingClientRect(); if (r.top < 60 || r.bottom > innerHeight - 20) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } });
      await sleep(S.speed);
    }
    ol.querySelectorAll('li.cur').forEach(x => x.classList.remove('cur'));
  }
  // final state, highlighting where the key ended up
  render(after); const placed = events.filter(e => e.k === 'place' || e.k === 'stash-add');
  placed.forEach(ev => targets(ev, after.type).forEach(k => mark_(k, 'probe-new')));
  if (op === 'search' && ok) { const hit = events.filter(e => e.r === 'match').pop(); if (hit) targets(hit, after.type).forEach(k => mark_(k, 'probe-match')); }
  renderStats(); S.busy = false; setBusy(false);
  return res;
}
function setBusy(b) { $$('button[data-op]', root).forEach(x => x.disabled = b); }
function addQuiet(keys) {
  let failed = 0;
  for (const k of keys) { const r = S.table.insert({ name: k, type: 0, scope: 0, line: S.keys.length }); if (r === E.INSERT_OK) S.keys.push(k); else if (r === E.INSERT_FAILED) failed++; }
  renderAll(S.table.snapshot()); renderStats();
  if (failed) toast(failed + ' insert(s) FAILED (fixed capacity exhausted)');
}
function logNote(text) { logEl.prepend(h('div', { class: 'logop' }, h('div', { class: 'hd' }, h('span', { class: 'badge info' }, 'BATCH'), text))); }

async function demo() {
  if (S.busy) return;
  S.table = E.createTable(S.sid, opts()); S.keys = []; logEl.innerHTML = ''; renderAll(S.table.snapshot()); renderStats();
  const g = E.genColliding(7, E.makeRng(11), S.hash, primaryMod(S.table), 4e6); const ks = g.keys;
  if (ks.length < 5) { toast('could not find enough colliding keys for this table size'); return; }
  logNote(`demo: ${ks.length} keys that all hash to index ${g.target} (mod ${primaryMod(S.table)}) are inserted one by one`);
  for (const k of ks) await operate('insert', k);
  await operate('search', ks[3]); await operate('search', E.genIdent(E.makeRng(5)) + 'Z');
  await operate('delete', ks[1]); await operate('search', ks[4]); await operate('insert', ks[1]);
}

/* ---------------------------------------------------------------- UI */
function build() {
  const stratSel = h('select', { onchange: () => { S.sid = +stratSel.value; onStrategy(); rebuild(true); } }, E.STRATEGIES.map(s => h('option', { value: s.id }, s.name)));
  descEl = h('div', { class: 'small muted' });
  const hashSel = h('select', { onchange: () => { S.hash = hashSel.value; rebuild(true); } }, E.HASH_NAMES.map(n => h('option', { value: n }, n + ' - ' + E.HASHES[n].desc)));
  const capInp = h('input', { type: 'number', min: 3, max: 199, value: S.capacity, onchange: () => { S.capacity = Math.max(3, Math.min(199, +capInp.value || 13)); capInp.value = S.capacity; rebuild(true); } });
  actualEl = h('div', { class: 'hint' });
  const resizeCb = h('input', { type: 'checkbox', checked: S.autoResize, onchange: () => { S.autoResize = resizeCb.checked; loadRow.classList.toggle('hidden', !S.autoResize); rebuild(true); } });
  loadRange = h('input', { type: 'range', min: 0.3, max: 0.95, step: 0.05, value: S.maxLoad, oninput: () => { S.maxLoad = +loadRange.value; loadLbl.textContent = fix(S.maxLoad, 2); }, onchange: () => rebuild(true) });
  loadLbl = h('span', { class: 'mono' }, fix(S.maxLoad, 2));
  const loadRow = h('div', { class: 'field hidden' }, h('label', null, 'Resize when load factor exceeds ', loadLbl), loadRange);
  paramUI = paramFields({ treeify: 3, untreeify: 1, window: 4, bucket: 2, stash: 2, maxkick: 20 }, () => rebuild(true));
  const speedSel = h('select', { onchange: () => { S.speed = +speedSel.value; } }, [['Instant (no animation)', 0], ['Fast', 150], ['Normal', 450], ['Slow', 900]].map(([l, v]) => h('option', { value: v, selected: v === S.speed }, l)));
  keyInp = h('input', { type: 'text', placeholder: 'identifier, e.g. count', maxlength: 24, spellcheck: 'false', onkeydown: e => { if (e.key === 'Enter') operate('insert', keyInp.value); } });
  const nInp = h('input', { type: 'number', min: 1, max: 500, value: 8 }), kInp = h('input', { type: 'number', min: 2, max: 200, value: 6 });
  const left = h('div', { class: 'stack' },
    h('div', { class: 'card' }, h('h3', null, 'Table configuration'),
      h('div', { class: 'field' }, h('label', null, 'Collision-resolution strategy'), stratSel, descEl),
      h('div', { class: 'field' }, h('label', null, 'Hash function'), hashSel),
      h('div', { class: 'field' }, h('label', null, 'Table size (slots / buckets)'), capInp, actualEl),
      h('label', { class: 'check', style: { margin: '4px 0 8px' } }, resizeCb, 'Auto-resize (rehash into a bigger table)'), loadRow,
      paramUI.el, h('div', { class: 'hint' }, 'Small parameter values make hybrid behaviour visible on a tiny table. The Benchmark tab uses 8 / 4 / 8 / 4 / 4 by default.')),
    h('div', { class: 'card' }, h('h3', null, 'Operations'),
      h('div', { class: 'field' }, h('label', null, 'Identifier'), keyInp),
      h('div', { class: 'row' }, h('button', { class: 'btn primary grow', 'data-op': 1, onclick: () => operate('insert', keyInp.value) }, 'Insert'),
        h('button', { class: 'btn grow', 'data-op': 1, onclick: () => operate('search', keyInp.value) }, 'Search'),
        h('button', { class: 'btn grow', 'data-op': 1, onclick: () => operate('delete', keyInp.value) }, 'Delete')),
      h('div', { class: 'row', style: { marginTop: '12px' } }, h('div', { style: { width: '70px' } }, nInp),
        h('button', { class: 'btn grow', 'data-op': 1, onclick: () => { const ks = E.uniqueRandom(Math.max(1, Math.min(500, +nInp.value || 1)), S.rng, new Set(S.keys)); addQuiet(ks); logNote('inserted ' + ks.length + ' random identifiers'); } }, 'Add random identifiers')),
      h('div', { class: 'row', style: { marginTop: '8px' } }, h('div', { style: { width: '70px' } }, kInp),
        h('button', { class: 'btn grow', 'data-op': 1, title: 'keys whose hash maps to the same primary index as the identifier above (or a random index)', onclick: () => {
          const m = primaryMod(S.table); const g = E.genColliding(Math.max(2, Math.min(200, +kInp.value || 2)), S.rng, S.hash, m, 3e6);
          if (keyInp.value.trim()) { /* aim at the typed key's index */ }
          addQuiet(g.keys.filter(k => !S.keys.includes(k))); logNote(`inserted ${g.found} keys that all map to index ${g.target} (mod ${m})`); } }, 'Add colliding keys')),
      h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn grow', 'data-op': 1, onclick: demo }, '▶ Run collision demo'),
        h('button', { class: 'btn danger', 'data-op': 1, onclick: () => { S.keys = []; logEl.innerHTML = ''; rebuild(false); } }, 'Clear')),
      h('div', { class: 'field', style: { marginTop: '12px' } }, h('label', null, 'Animation speed'), speedSel)));
  statsEl = h('div', { class: 'stats' }); vizEl = h('div', { class: 'viz', style: { maxHeight: '560px', overflow: 'auto', paddingBottom: '4px' } });
  logEl = h('div', { class: 'log' });
  const legend = h('div', { class: 'legend' },
    h('span', null, h('i', { style: { borderColor: 'var(--probe)' } }), 'probed, not the key (collision)'), h('span', null, h('i', { style: { borderColor: 'var(--hit)' } }), 'key found'),
    h('span', null, h('i', { style: { borderColor: 'var(--miss)' } }), 'empty slot (search stops)'), h('span', null, h('i', { style: { borderColor: 'var(--accent)' } }), 'key stored here'), h('span', null, h('i', { style: { borderColor: 'var(--faint)', borderStyle: 'dashed' } }), 'tombstone'));
  const right = h('div', { class: 'stack' }, h('div', { class: 'card' }, h('h3', null, 'Live statistics'), statsEl),
    h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, 'Table'), legend), vizEl),
    h('div', { class: 'card' }, h('h3', null, 'Probe trace'), h('div', { class: 'small muted', style: { marginBottom: '8px' } }, 'Every operation is explained step by step. “Probe” = one slot, list node or tree level examined.'), logEl));
  root.append(h('div', { class: 'intro' }, h('h2', null, 'Visualizer'), h('p', null, 'Insert, search and delete identifiers and watch how each strategy resolves collisions. Change the hash function or table size and the existing keys are re-inserted so you can compare layouts instantly.')),
    h('div', { class: 'split' }, left, right));
  const onStrategy = () => {
    descEl.textContent = E.STRATEGIES[S.sid].desc;
    paramUI.show(S.sid === 5 ? ['treeify', 'untreeify'] : S.sid === 6 ? ['window'] : S.sid === 7 ? ['bucket', 'stash', 'maxkick'] : []);
  };
  onStrategy(); rebuild(false);
  S.speedSel = speedSel; speedSel.value = S.speed;
}
build();
App.viz = { operate, state: S, rebuild };
})();
