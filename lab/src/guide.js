/* =============================================================================
   guide.js - "Guide" tab: theory, metric definitions, methodology, usage
   ============================================================================= */
(function () {
'use strict';
const root = $('#pane-guide');
const T = (rows, head) => h('table', null, h('thead', null, h('tr', null, head.map(x => h('th', null, x)))), h('tbody', null, rows.map(r => h('tr', null, r.map(c => h('td', { html: c }))))));
root.append(h('div', { class: 'guide card' },
  h('h2', null, 'Performance evaluation of a compiler’s symbol table: collision resolution'),
  h('p', { class: 'muted' }, 'A compiler front-end looks up every identifier it reads and declares every new one, so the symbol table is on the hot path. Two different identifiers can hash to the same slot - a collision - and how the table resolves it determines how many slots must be examined (probes) per operation, how the cost grows as the table fills, how bad the worst case is, and how much memory is used. This project implements eight strategies in C++ and measures them under identical conditions.'),

  h('h3', null, '1. The eight strategies'),
  T([
    ['<b>Separate chaining</b>', 'bucket = linked list; colliding keys are pushed on the list', 'never fails; load factor may exceed 1', 'pointer per node; poor cache locality'],
    ['<b>Linear probing</b>', 'try slot+1, +2, …', 'best cache behaviour at low load', 'primary clustering: unsuccessful searches explode near full'],
    ['<b>Quadratic probing</b>', 'try slot+1², +2², …', 'less clustering than linear', 'may never reach a free slot above ~50% load (fixed capacity)'],
    ['<b>Double hashing</b>', 'step size from a second hash', 'close to ideal uniform probing', 'two hash computations; probes jump around memory'],
    ['<b>Robin Hood</b> <span class="badge info">hybrid</span>', 'linear probing, but a key farther from home steals the slot of a “richer” key', 'very low variance; lookups stop early on a miss', 'inserts move other keys; deletion needs backward shift'],
    ['<b>H1 chaining + tree</b> <span class="badge info">hybrid</span>', 'a chain longer than the treeify threshold becomes a red-black tree', 'worst case O(log n) per bucket', 'extra memory; costlier resize'],
    ['<b>H2 open addressing + overflow</b> <span class="badge info">hybrid</span>', 'linear probing inside a fixed window; a full window spills to a chain', 'bounded probe length; misses usually end inside the window', 'depends on a decent hash'],
    ['<b>H3 cuckoo + stash</b> <span class="badge info">hybrid</span>', 'two hashes, multi-slot buckets, kick keys to their other bucket, tiny stash for failures', 'lookup touches at most 2 buckets + stash', 'expensive inserts and long tail while filling'],
  ], ['Strategy', 'How a collision is resolved', 'Strength', 'Weakness']),

  h('h3', null, '2. What is measured'),
  h('ul', null,
    h('li', { html: '<b>Probe</b> - one slot, list node or tree level examined. Probe counts are exact and machine independent; the C++ and JavaScript engines produce identical numbers.' }),
    h('li', { html: '<b>Avg probes per insert / successful search / unsuccessful search</b> - the classic textbook measures. Theory curves (Knuth) can be overlaid on load-factor sweeps.' }),
    h('li', { html: '<b>Max probes</b> - the worst single operation (tail latency). A few terrible operations matter in a compiler that must never stall.' }),
    h('li', { html: '<b>Collisions</b> - inserts whose first-choice location was already occupied (cuckoo: number of kicks).' }),
    h('li', { html: '<b>Time (ns/op)</b> - wall-clock per operation. Use the C++ engine for authoritative numbers; browser timings include JIT effects.' }),
    h('li', { html: '<b>Memory (bytes/entry)</b> - table structure only (identifier strings are the same for every strategy). Uses the C++ <code>sizeof</code> values.' }),
    h('li', { html: '<b>Failed inserts</b> - a fixed-capacity table that cannot place a key (open addressing at 100%, quadratic probing’s unreachable slots, cuckoo without stash room).' }),
    h('li', { html: '<b>After-deletion probes</b> - tombstones (linear/quadratic/double/H2) lengthen later searches; Robin Hood shifts entries back; chains simply unlink.' })),
  h('p', { class: 'small muted' }, 'Fairness notes: H1 estimates a tree search as ⌈log₂(size+1)⌉ comparisons; cuckoo counts the slots examined in its two buckets (plus stash), which is a small contiguous block - so its “probes” are cheaper than a chain’s pointer hops. Compare probes within a family and use time for cross-family conclusions.'),

  h('h3', null, '3. Using this lab'),
  T([
    ['<b>Visualizer</b>', 'one small table; insert / search / delete with an animated, explained probe trace; change strategy, hash, size and hybrid parameters live; generate colliding keys'],
    ['<b>Benchmark</b>', 'the main experiment tool: pick a preset (load-factor sweep, growth, hash functions, workloads, collision stress, deletion, resize threshold) or sweep any parameter; all strategies get identical keys; every run is verified; export CSV / PNG / Markdown'],
    ['<b>Compiler</b>', 'paste or upload real source code; it is tokenised and replayed through every strategy as declare / resolve / scope-exit traffic'],
    ['<b>Hash Lab</b>', 'distribution of the five hash functions across buckets vs an ideal random hash (χ², occupancy map)'],
    ['<b>Tests</b>', 'correctness evidence: hash vectors, edge cases, scopes, and hundreds of thousands of random operations checked against a reference'],
  ], ['Tab', 'Purpose']),

  h('h3', null, '4. How the C++ project and this page fit together'),
  h('ul', null,
    h('li', { html: '<code>source/symtab.cpp</code> is the reference implementation (all strategies, hash functions, scope manager). <code>source/benchmark.cpp</code> produces the CSV data used for the report graphs; <code>tests/test_correctness.cpp</code> verifies it.' }),
    h('li', { html: 'This page contains a JavaScript port of the same algorithms so it runs anywhere with no installation. The port was verified against the C++ binary on tens of thousands of counters (identical probes, collisions, resizes, failures and memory).' })),

  h('h3', null, '5. Methodology'),
  h('ul', null,
    h('li', 'Every strategy receives exactly the same keys, in the same order, in each trial; misses are near-miss “typos” guaranteed absent.'),
    h('li', 'Fixed-capacity experiments never resize (the textbook setting; inserts may fail). Growth experiments start small and resize at the maximum load factor, which is closer to a real compiler.'),
    h('li', 'Averages over several trials with different random keys. Each run is verified: all accepted keys are found, absent keys never are, deleted keys disappear and the rest stay intact.'),
    h('li', 'Limitations: a single machine, synthetic and sample identifiers rather than a large code corpus, strings hashed with simple non-cryptographic functions, tree cost estimated analytically for H1.'))
));
})();
