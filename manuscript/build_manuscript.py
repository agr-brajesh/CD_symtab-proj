# Builds Symbol_Table_Manuscript_IEEE_Access.docx from results/paper_data.json (run from repository root: python3 manuscript/build_manuscript.py)
import json, os, sys, subprocess, platform, re
sys.path.insert(0, 'manuscript')
from dx import *
from lxml import etree
data = json.load(open('results/paper_data.json')); T = data['T']; N = data['N']
COMMIT = open('manuscript/COMMIT').read().strip() if os.path.exists('manuscript/COMMIT') else '[[commit hash]]'
REPO = open('manuscript/REPO').read().strip() if os.path.exists('manuscript/REPO') else '[[https://github.com/<user>/<repo>]]'
def ver(cmd): 
    try: return subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.STDOUT).strip().splitlines()[0]
    except Exception: return 'n/a'
GCC = ver('g++ --version'); PYV = platform.python_version(); NODEV = ver('node --version')
PKG = ver('python3 -c "import pandas,matplotlib,scipy,numpy;print(pandas.__version__,matplotlib.__version__,scipy.__version__,numpy.__version__)"')
D = Doc(); C = D.cite; add = D.add
W2 = 5040; W1 = 10440
def two(): add(para('', f'<w:spacing w:after="0"/>')); 
def wide_begin(): add(para('', '<w:spacing w:after="0" w:line="20" w:lineRule="exact"/>' + sect(2)))      # closes the running two-column section
def wide_end(): add(para('', '<w:spacing w:after="0" w:line="20" w:lineRule="exact"/>' + sect(1)))        # closes the single-column section
FIG = {}; TBL = {}
def fig(key, path, width, caption, wide=False):
    n = len(FIG) + 1; FIG[key] = n
    if wide: wide_begin()
    add(D.figure(path, width, caption)); add(caption_fig(n, caption))
    if wide: wide_end()
def tbl(key, caption, rows, widths, wide=False, **k):
    n = len(TBL) + 1; TBL[key] = n
    if wide: wide_begin()
    add(caption_tbl(n, caption)); add(table(rows, widths, **k))
    if wide: wide_end()
def F_(k): return f'Fig. {FIG[k]}'
def T_(k): return f'Table {TBL[k]}'
# numbers are known before the text is written: pre-assign in document order
ORDER_F = ['arch', 'flow', 'a1', 'a2', 'a3', 'a4', 'dist', 'mem', 'scope', 'bwl', 'bhash', 'trace']
ORDER_T = ['related', 'strat', 'probe', 'modules', 'env', 'corpora', 'params', 'ahead', 'theory', 'atime', 'distt', 'memt', 'hyba', 'hybs', 'scopet', 'bins', 'bhit', 'bmiss', 'bdel', 'bscope', 'bhash', 'bhyb', 'tflat', 'tscope']
for i, k in enumerate(ORDER_F): FIG[k] = i + 1
for i, k in enumerate(ORDER_T): TBL[k] = i + 1
def FR(k): return f'Fig. {FIG_SAVE[k]}'
def TR(k): return f'Table {TBL_SAVE[k]}'
FIG_SAVE, TBL_SAVE = dict(FIG), dict(TBL); FIG.clear(); TBL.clear()      # fig()/tbl() recount in order and are cross-checked at the end

REFS = {
 'knuth': 'D. E. Knuth, {i:The Art of Computer Programming, Vol. 3: Sorting and Searching}, 2nd ed. Reading, MA, USA: Addison-Wesley, 1998.',
 'clrs': 'T. H. Cormen, C. E. Leiserson, R. L. Rivest, and C. Stein, {i:Introduction to Algorithms}, 3rd ed. Cambridge, MA, USA: MIT Press, 2009.',
 'celis': 'P. Celis, P.-A. Larson, and J. I. Munro, “Robin Hood hashing,” in {i:Proc. 26th Annu. Symp. Found. Comput. Sci. (FOCS)}, 1985, pp. 281–288.',
 'pagh': 'R. Pagh and F. F. Rodler, “Cuckoo hashing,” in {i:Proc. 9th Annu. Eur. Symp. Algorithms (ESA)}, 2001, pp. 121–133.',
 'cooper': 'K. D. Cooper and L. Torczon, {i:Engineering a Compiler}, 3rd ed. Cambridge, MA, USA: Morgan Kaufmann, 2022.',
 'sedgewick': 'R. Sedgewick and K. Wayne, {i:Algorithms}, 4th ed. Boston, MA, USA: Addison-Wesley, 2011.',
 'weiss': 'M. A. Weiss, {i:Data Structures and Algorithm Analysis in C++}, 4th ed. Boston, MA, USA: Pearson, 2014.',
 'carter': 'J. L. Carter and M. N. Wegman, “Universal classes of hash functions,” {i:J. Comput. Syst. Sci.}, vol. 18, no. 2, pp. 143–154, 1979.',
 'rz97': 'M. V. Ramakrishna and J. Zobel, “Performance in practice of string hashing functions,” in {i:Proc. 5th Int. Conf. Database Syst. Adv. Appl. (DASFAA)}, 1997, pp. 215–224.',
 'aho': 'A. V. Aho, M. S. Lam, R. Sethi, and J. D. Ullman, {i:Compilers: Principles, Techniques, and Tools}, 2nd ed. Boston, MA, USA: Pearson, 2006.',
 'f14': 'Meta Engineering. “Open-sourcing F14 for faster, more memory-efficient hash tables.” Apr. 25, 2019. [Online]. Available: https://engineering.fb.com/2019/04/25/developer-tools/f14/',
 'swiss': 'Abseil. “Swiss Tables design notes.” [Online]. Available: https://abseil.io/about/design/swisstables',
 'cpp17': '{i:Programming Languages—C++}, ISO/IEC Standard 14882:2017, International Organization for Standardization, Geneva, Switzerland, 2017.',
 'mpl': 'J. D. Hunter, “Matplotlib: A 2D graphics environment,” {i:Comput. Sci. Eng.}, vol. 9, no. 3, pp. 90–95, 2007.',
 'asan': 'GNU Project. “Instrumentation options: AddressSanitizer.” GCC Online Documentation. [Online]. Available: https://gcc.gnu.org/onlinedocs/gcc/Instrumentation-Options.html',
 'ubsan': 'LLVM Project. “UndefinedBehaviorSanitizer.” [Online]. Available: https://clang.llvm.org/docs/UndefinedBehaviorSanitizer.html',
 'umap': 'cppreference.com. “std::unordered_map.” [Online]. Available: https://en.cppreference.com/w/cpp/container/unordered_map',
 'fck24': 'M. Farach-Colton, A. Krapivin, and W. Kuszmaul, “Optimal bounds for open addressing without reordering,” in {i:Proc. IEEE 65th Annu. Symp. Found. Comput. Sci. (FOCS)}, 2024, doi: 10.1109/FOCS61266.2024.00045.',
 'bkk21': 'M. A. Bender, B. C. Kuszmaul, and W. Kuszmaul, “Linear probing revisited: Tombstones mark the demise of primary clustering,” in {i:Proc. 62nd IEEE Annu. Symp. Found. Comput. Sci. (FOCS)}, 2021.',
 'zombie': 'Y. Chesetti, B. Shi, J. M. Phillips, and P. Pandey, “Zombie hashing: Reanimating tombstones in a graveyard,” {i:Proc. ACM Manag. Data}, vol. 3, no. 3 (SIGMOD), Art. 236, Jun. 2025.',
 'iceberg': 'M. A. Bender, A. Conway, M. Farach-Colton, W. Kuszmaul, and G. Tagliavini, “Iceberg hashing: Optimizing many hash-table criteria at once,” {i:J. ACM}, Dec. 2023.',
 'kmw': 'A. Kirsch, M. Mitzenmacher, and U. Wieder, “More robust hashing: Cuckoo hashing with a stash,” {i:SIAM J. Comput.}, vol. 39, no. 4, pp. 1543–1561, 2009, doi: 10.1137/080728743.',
 'li14': 'X. Li, D. G. Andersen, M. Kaminsky, and M. J. Freedman, “Algorithmic improvements for fast concurrent cuckoo hashing,” in {i:Proc. 9th ACM Eur. Conf. Comput. Syst. (EuroSys)}, 2014, pp. 27:1–27:14.',
 'horton': 'A. D. Breslow, D. P. Zhang, J. L. Greathouse, N. Jayasena, and D. M. Tullsen, “Horton tables: Fast hash tables for in-memory data-intensive computing,” in {i:Proc. USENIX Annu. Tech. Conf. (ATC)}, 2016.',
 'maier': 'T. Maier, P. Sanders, and R. Dementiev, “Concurrent hash tables: Fast and general(?)!,” {i:ACM Trans. Parallel Comput.}, vol. 5, no. 4, 2019, doi: 10.1145/3309206.',
 'richter': 'S. Richter, V. Alvarez, and J. Dittrich, “A seven-dimensional analysis of hashing methods and its implications on query processing,” {i:Proc. VLDB Endow.}, vol. 9, no. 3, pp. 96–107, 2015, doi: 10.14778/2850583.2850585.',
 'thorup': 'M. Thorup, “Fast and powerful hashing using tabulation,” {i:Commun. ACM}, Jul. 2017, doi: 10.1145/3068772.',
 'sabek': 'I. Sabek, K. Vaidya, D. Horn, A. Kipf, M. Mitzenmacher, and T. Kraska, “Can learned models replace hash functions?,” {i:Proc. VLDB Endow.}, vol. 16, no. 3, pp. 532–545, 2022.',
 'kraska': 'T. Kraska, A. Beutel, E. H. Chi, J. Dean, and N. Polyzotis, “The case for learned index structures,” in {i:Proc. ACM SIGMOD Int. Conf. Manage. Data}, 2018.',
 'sip': 'J.-P. Aumasson and D. J. Bernstein, “SipHash: A fast short-input PRF,” in {i:Progress in Cryptology—INDOCRYPT 2012}. Berlin, Germany: Springer, 2012, pp. 489–508.',
 'askitis': 'N. Askitis and R. Sinha, “Engineering scalable, cache and space efficient tries for strings,” {i:VLDB J.}, vol. 19, no. 5, pp. 633–660, 2010.',
 'moreno': 'P. Moreno, M. Areias, R. Rocha, and V. Santos Costa, “Yet another lock-free atom table design for scalable symbol management in Prolog,” {i:Int. J. Parallel Program.}, 2024, doi: 10.1007/s10766-024-00766-z.',
 'lua': 'Lua.org. “Lua 5.4.7 source code (tag v5.4.7).” [Online]. Available: https://github.com/lua/lua',
 'zlib': 'J.-L. Gailly and M. Adler. “zlib 1.3.1 source code (tag v1.3.1).” [Online]. Available: https://github.com/madler/zlib',
 'redis': 'Redis Ltd. “Redis 7.2.5 source code (tag 7.2.5).” [Online]. Available: https://github.com/redis/redis',
 'sqlite': 'SQLite Consortium. “SQLite 3.46.0 source code (tag version-3.46.0).” [Online]. Available: https://github.com/sqlite/sqlite',
}
# ----------------------------------------------------------------------------------------------- title block
add(center('Performance Evaluation of a Compiler’s Symbol Table Implementation: Collision Resolution Strategies', sz=48, after=120))
add(center('SYED AYMAN ALAM{sup:1}, GIRIJESHVASAN M{sup:1}, AND BRAJESH AGRAWAL{sup:1}', sz=22, after=60, b=True))
add(center('{sup:1}{i:{hl:[[Department / School]]}, Vellore Institute of Technology, [[City]], [[State]], India}', sz=18, after=0))
add(center('{i:Reg. Nos. 24BAI0100, 24BCE2352, 24BCE0551}   |   E-mail: {hl:[[author-1 email]]}, {hl:[[author-2 email]]}, {hl:[[author-3 email]]}', sz=18, after=60))
add(center('Corresponding author: Syed Ayman Alam (e-mail: {hl:[[author-1 email]]}).', sz=18, after=140))
add(para('', sect(1, first=True)))
M = N
abs_txt = (f'Symbol tables are central compiler data structures that map identifiers to type, scope and storage information, and their lookup cost affects every compiler phase. We implemented eight collision-resolution designs in one C++17 library (separate chaining, linear probing, quadratic probing, double hashing, Robin Hood hashing and three hybrids: H1 chaining with red-black-tree buckets, H2 bounded probing with an overflow chain, H3 bucketized cuckoo hashing with a stash) together with five string hash functions and two block-scope designs. '
 f'In a fixed-capacity experiment (10,007 slots, load factors 0.1–0.95, {M["n_trials"]} trials, two hash functions) we report means, standard deviations and 95 % confidence intervals using a probe metric that counts memory locations consistently across strategies. At load factor 0.9 an unsuccessful search costs {M["lin09_miss_mean"]:.1f} probes with linear probing (theory 50.5), 6.0 with Robin Hood hashing, 5.4 with H2 and 1.9 with separate chaining. Robin Hood hashing leaves the mean successful-search cost of linear probing unchanged (5.49) but cuts its variance from {M["dist_var_lin_hit"]:.0f} to {M["dist_var_rh_hit"]:.0f}. '
 f'Stress tests with weak-hash and multi-collision keys show when each hybrid mechanism fires: H1 cut the successful-search cost on 4,096 colliding keys from {M["hyb_collide4096_ch_hit"]:.0f} to {M["hyb_collide4096_h1_hit"]:.0f} probes. A resizing experiment over seven workloads, including identifier streams captured from the Lua, zlib, Redis and SQLite sources, and a comparison of the name@depth scope design with a conventional shadow-chain design (2.6–3.2× faster at nesting depth 8) complete the study. Results support choosing a strategy from the workload and hash function rather than a universal ranking.')
add(abstract('Abstract—', abs_txt))
add(abstract('Index Terms—', 'compiler, collision resolution, hash function, performance evaluation, scope management, symbol table, workload.', after=120))
add(para('', sect(1)))
# ----------------------------------------------------------------------------------------------- I. Introduction
add(h1('I. Introduction'))
add(body(f'A compiler symbol table records the attributes of every identifier and makes them available during parsing, semantic analysis, type checking, scope resolution and code generation. It must support insertion, lookup, deletion or scope exit, and queries that depend on the currently visible declaration. Hash tables are the usual choice because their expected cost is close to constant, but collisions, high load factors, key distributions, deletion policies and memory layout change the observed cost substantially {C("knuth","clrs","richter")}. Compiler textbooks describe hashing for symbol tables {C("aho","cooper")}, yet they rarely compare collision-resolution strategies under one measurement protocol.'))
add(body(f'We address a narrow, practical question: how do different collision-resolution strategies behave when they are implemented in one C++17 library and measured with the same keys, the same probe definition and the same harness, on random identifiers, adversarial identifiers, and identifiers taken from real compiler workloads? We compare separate chaining, linear, quadratic and double hashing, Robin Hood hashing {C("celis")} and three hybrids that we designed to bound the worst case of chaining, of open addressing and of cuckoo hashing {C("pagh","kmw")}.'))
add(body('Our contributions are: (i) a library of eight strategies, five hash functions and two block-scope designs behind one interface; (ii) a probe metric that counts memory locations consistently, so that chaining and open addressing can be compared directly; (iii) a fixed-capacity study with 30 trials per point, two hash functions, confidence intervals and a validation against the classical linear-probing formulas; (iv) stress tests that show when the hybrid mechanisms (tree conversion, overflow chain, stash) are actually used; (v) a resizing study over synthetic workloads and identifier streams captured from four open-source C code bases; and (vi) a specification and evaluation of the scope-handling design against a conventional shadow-chain design.'))
add(body('Section II reviews recent work and states the research gap. Section III defines the system, the metrics, the probe counting and the scope designs. Section IV describes the environment and the experiments, Section V reports results, and Sections VI–VIII cover verification, limitations and conclusions. Declarations on author contributions, the use of AI tools, and data and code availability close the paper.'))
# ----------------------------------------------------------------------------------------------- II. Related work
add(h1('II. Related Work'))
add(h2('A. Open Addressing and Primary Clustering'))
add(body(f'Knuth’s analysis gives the expected successful and unsuccessful search costs of linear probing {C("knuth")}, and the same analysis explains why linear probing is avoided at high load. Bender {{i:et al.}} showed that deletion design changes this picture: tombstones can act against primary clustering, and a “graveyard” variant keeps insertion cost low at any sequence of operations {C("bkk21")}; Chesetti {{i:et al.}} later removed the periodic stop-the-world redistribution this needs {C("zombie")}. Farach-Colton {{i:et al.}} proved tight probe bounds for open addressing without reordering and disproved a long-standing conjecture on uniform probing {C("fck24")}. These works concern asymptotics and integer keys; our study measures what happens at fixed load for string identifiers.'))
add(h2('B. Cuckoo Hashing, Stashes and Bucketized Designs'))
add(body(f'Cuckoo hashing {C("pagh")} bounds lookups to a few candidate locations; adding a small stash makes insertion failures rare {C("kmw")}, which is the mechanism of our H3. Li {{i:et al.}} engineered concurrent cuckoo tables {C("li14")}, Breslow {{i:et al.}} reduced the number of cache lines touched by bucketized cuckoo lookups {C("horton")}, and Bender {{i:et al.}} combined front-yard/back-yard layout with low associativity and stability in Iceberg hashing {C("iceberg")}. Maier {{i:et al.}} benchmarked concurrent tables against widely used libraries {C("maier")}. All of these target integer or fixed-size keys and general-purpose workloads, not the scoped, string-keyed, delete-heavy pattern of a symbol table.'))
add(h2('C. Comparative Evaluation and Hash Functions'))
add(body(f'Richter {{i:et al.}} compared chaining, linear, quadratic, cuckoo and Robin Hood hashing along seven dimensions and showed that the best scheme depends on load factor, key distribution, read/write ratio and hash function {C("richter")}. Ramakrishna and Zobel studied string hash functions in practice {C("rz97")}, Thorup surveyed tabulation hashing with strong guarantees {C("thorup")}, and Sabek {{i:et al.}} found that learned models can replace hash functions only for suitable distributions {C("sabek","kraska")}. Aumasson and Bernstein motivated keyed hashing by hash-flooding attacks {C("sip")}, which is the threat our multi-collision stress test models.'))
add(h2('D. String-Keyed Structures and Symbol Management'))
add(body(f'Askitis and Sinha combined tries with hash buckets for cache-efficient string storage {C("askitis")}. Moreno {{i:et al.}} replaced the lock-based atom (symbol) table of a Prolog system with a lock-free hash trie to scale symbol management across threads {C("moreno")}. Symbol-table design in compilers is otherwise treated as textbook material {C("aho","cooper")}.'))
rel = [['Ref.', 'Year / venue', 'Contribution', 'Relation to this study'],
 [C('knuth'), '1998, book', 'Classical analysis of probing and chaining', f'Baseline formulas validated in {TR("theory")}'],
 [C('kmw'), '2009, SICOMP', 'Cuckoo hashing with a constant-size stash', 'Mechanism of H3; we measure when the stash is used'],
 [C('askitis'), '2010, VLDB J.', 'HAT-trie: cache-conscious string keys', 'Alternative string-key structure; not covered here'],
 [C('sip'), '2012, INDOCRYPT', 'Keyed hash function against hash flooding', 'Motivates the multi-collision stress test'],
 [C('li14'), '2014, EuroSys', 'Fast concurrent optimistic cuckoo hashing', 'Single-threaded here; concurrency is future work'],
 [C('richter'), '2015, PVLDB', 'Seven-dimension comparison of hashing schemes', 'Closest in method; integer keys, no scopes or compiler data'],
 [C('horton'), '2016, USENIX ATC', 'Horton tables: fewer buckets per lookup', 'Related to H3 miss cost (always 8 slots)'],
 [C('thorup'), '2017, CACM', 'Tabulation hashing with strong guarantees', 'Stronger hash functions than the five tested'],
 [C('kraska'), '2018, SIGMOD', 'Learned index structures', 'Learned alternatives to hashing, not evaluated'],
 [C('maier'), '2019, TOPC', 'Concurrent hash tables, extensive comparison', 'Concurrency; word-sized keys'],
 [C('bkk21'), '2021, FOCS', 'Tombstones defeat primary clustering', 'Explains linear-probing behaviour under deletes'],
 [C('sabek'), '2022, PVLDB', 'Learned models as hash functions', 'Hash function choice matters; our weak hash shows extreme case'],
 [C('iceberg'), '2023, JACM', 'Iceberg hashing: stable, space-efficient', 'Design space beyond our eight strategies'],
 [C('fck24'), '2024, FOCS', 'Optimal open addressing without reordering', 'Theory for the open-addressing family'],
 [C('moreno'), '2024, IJPP', 'Lock-free atom table for Prolog symbols', 'Only symbol-table paper in the set; concurrency focus'],
 [C('zombie'), '2025, SIGMOD', 'Zombie hashing: deamortized tombstones', 'Deletion handling for linear probing']]
tbl('related', 'Summary of the related work reviewed in Section II.', rel, [650, 1050, 1750, 1590], sz=14, align=['left', 'left', 'left', 'left'])
add(h2('E. Research Gap'))
add(body('The works above establish algorithms, bounds and engineering for hash tables with integer or fixed-size keys. None of them compares collision-resolution strategies for compiler symbol tables under one probe definition, with adversarial and real-code identifier streams, resizing, deletion and block-scope operations. The only symbol-table paper we found targets concurrency {C("moreno")}. We therefore contribute a controlled, reproducible, single-threaded comparison that includes the scope-handling design, and we state clearly that its results hold for this implementation and these workloads.'.replace('{C("moreno")}', C('moreno'))))
# ----------------------------------------------------------------------------------------------- III. System design
add(h1('III. System Design'))
add(h2('A. Problem Formulation'))
add(body('A symbol table stores identifier records under a chosen hash function and collision-resolution strategy. For every operation it must keep dictionary semantics: inserted keys are retrievable, absent keys are not returned, and deleted keys disappear. Our objective is to compare operation costs while the functional behaviour stays identical, using probe counts, elapsed time, failed insertions and memory.'))
add(body('A compiler adds block structure: a name declared in an outer block is hidden by a declaration of the same name in an inner block, and leaving a block must remove the inner declarations. Sections III-E and V-E specify and evaluate two designs for this.'))
fig('arch', '/home/claude/doc/un/word/media/8ef87d933df863f81756acfda225fa6ff7e3f6bd.png', 7.0, 'Architecture of the evaluation framework.', wide=True)
add(body(f'{FR("arch")} shows the path from workload generation through the common interface, hash selection and collision strategy to the metrics and CSV outputs. The browser lab (lab/) offers a second interface to the same operations: a visualizer of probe traces, a configurable benchmark, a compiler mode that replays source code, a hash-distribution lab and in-browser tests. A JavaScript engine reproduces the C++ engine, and the two agree on probes, collisions, resizes, failures and memory estimates for identical operation scripts (Section VI). A front end of this kind couples parsing with symbol-table lookups {C("aho")}; modern production tables such as Swiss tables and F14 use metadata and group probing {C("swiss","f14")}.'))
add(h2('B. Implemented Strategies'))
add(body(f'{TR("strat")} lists the eight strategies. The three hybrids are our own designs and expose counters for their special mechanisms (tree conversions, overflow spills, stash placements), which Sections V-D and V-F use.', first=True))
strat = [['Strategy', 'Behaviour', 'Expected trade-off'],
 ['Separate chaining', 'Each bucket owns a linked list of entries.', 'Miss cost follows bucket occupancy; pointer and allocation overhead.'],
 ['Linear probing', 'Checks consecutive slots until match or empty slot.', 'Locality, but primary clustering raises miss and tail cost.'],
 ['Quadratic probing', 'Probe offsets i².', 'Less clustering; may not reach every slot.'],
 ['Double hashing', 'Second hash sets the step.', 'Disperses probe sequences better than linear probing.'],
 ['Robin Hood hashing', 'Insertion swaps with residents closer to home; lookup stops early.', 'Lower variance of probe length; relocation work on insert.'],
 ['H1: chaining + tree', 'A chain longer than 8 becomes a red-black tree; reverts at 4.', 'Bounds chain search at O(log n); tree nodes cost memory.'],
 ['H2: bounded probing + overflow', 'Probe an 8-slot window; a key that does not fit goes to an overflow chain.', 'Bounded slot scans; overflow chain and pointers.'],
 ['H3: bucketized cuckoo + stash', 'Two hashes, 4-slot buckets, 4-entry stash, at most 200 kicks.', 'At most two buckets per lookup; displacement chains on insert.']]
tbl('strat', 'Implemented collision-resolution strategies.', strat, [1150, 2050, 1840], sz=14, align=['left', 'left', 'left'])
add(h2('C. Hash Functions'))
add(body('Five hash functions are supported: djb2, 64-bit FNV-1a, sdbm, PJW (ELF), and a deliberately weak sum of characters. The weak function is a stress case, not a recommendation: anagrams and many differently ordered names collide. Experiment A uses djb2 for the headline results and repeats the sweep with FNV-1a; Experiment B uses all five.'))
add(h2('D. Metrics, Probe Counting and Mathematical Definitions'))
add(body('Let n be the number of stored entries, m the number of slots (or buckets) and α the load factor. For q measured operations, let p{sub:i} be the probes of operation i and t{sub:i} its elapsed time. The metrics are'))
orig = etree.parse('/home/claude/doc/un/word/document.xml'); ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
els = list(orig.getroot().find('w:body', ns))
for i in range(44, 51):
    x = etree.tostring(els[i], encoding='unicode'); add(x)
add(eq(msub('P', 'hit') + mr(' ≈ ') + omath_frac(mr('1'), mr('2')) + mbr(mr('1 + ') + omath_frac(mr('1'), mr('1 − α'))), 8))
add(eq(msub('P', 'miss') + mr(' ≈ ') + omath_frac(mr('1'), mr('2')) + mbr(mr('1 + ') + omath_frac(mr('1'), '<m:sSup><m:sSupPr/><m:e>' + mr('(1 − α)') + '</m:e><m:sup>' + mr('2') + '</m:sup></m:sSup>')), 9))
add(body('where P{sub:hit} in (8) and P{sub:miss} in (9) are Knuth’s expected numbers of probes for a successful and an unsuccessful search under linear probing {C("knuth")}. Eq. (8) is the successful-search formula and (9) the unsuccessful-search formula; in an earlier version of this work (8) was used for both, which is wrong for unsuccessful searches. P{sub:max} in (4) is the maximum over the q operations. In (7) a scope operation is one declaration, one resolve, or one erase performed when a scope exits.'.replace('{C("knuth")}', C('knuth')), first=False))
add(body('{b:Probe definition.} A probe is one distinct memory location whose key or state is examined: a table slot, a bucket-head pointer, a list node, or a tree level. The raw counter of the library does not count the bucket-head read of chaining and H1 lookups, so an empty bucket costs 0 probes; open addressing counts the empty slot it stops at. This would make the comparison of 0.9 against 53 probes at α = 0.9 partly an artefact. We therefore report a {i:consistent} probe metric, equal to the raw counter plus one for lookups in chaining and H1, and give the raw value where it matters. Insertion counters already agree: a chaining insert counts one bucket-head read plus the nodes scanned, which equals the raw value (nodes scanned plus one). H1 tree buckets use the estimate ⌈log{sub:2}(size + 1)⌉ per access, not a count of real comparisons. A probe remains a logical unit: a list node, a slot and a tree level do not have equal latency, so we report timing separately.' , first=False))
probe = [['Strategy', 'One probe is …', 'Consistent vs. raw'],
 ['Chaining', 'one list node (raw); consistent also counts the bucket-head read', '+1 on lookups'],
 ['Linear / quadratic / double', 'one table slot, including the empty slot that ends a search', 'equal'],
 ['Robin Hood', 'one slot; a lookup stops when the resident is closer to home', 'equal'],
 ['H1', 'one list node, or ⌈log₂(size+1)⌉ levels for a tree bucket; plus bucket head', '+1 on lookups'],
 ['H2', 'one slot of the 8-slot window, or one overflow node', 'equal'],
 ['H3', 'one slot of either candidate bucket, or one stash entry', 'equal']]
tbl('probe', 'Probe definition per strategy.', probe, [1250, 2790, 1000], sz=14, align=['left', 'left', 'left'])
add(h2('E. Scope-Handling Designs'))
add(body('The original design, {i:name@depth}, mangles every declaration into the key name@d, where d is the current lexical depth, and inserts it into the table. Algorithm 2 gives the lookup procedure that earlier versions left undefined. Its cost is one table lookup per candidate depth, each preceded by a string concatenation, so a successful resolve costs (current depth − declaring depth + 1) lookups and an unsuccessful resolve costs (current depth + 1) lookups.'))
add(algtitle(1, 'Benchmark one strategy'))
for t in ['Select the strategy, hash function, capacity and workload.', 'Construct the table and insert the common key set in the specified order.', 'For each operation record the probe count and the elapsed time.', 'Verify that every stored key is found and every absent key stays absent.', 'Verify that deleted keys are gone; record failures and the memory estimate.', 'Repeat for the prescribed trials; export one CSV row per trial.']: add(step(t, 2))
add(algtitle(2, 'Block scopes with name@depth keys'))
for t in ['enter_scope: push an empty list of declared keys; depth ← depth + 1.', 'declare(x): k ← x + “@” + depth; insert k; append k to the current list.', 'resolve(x): for d ← depth down to 0: k ← x + “@” + d; if lookup(k) succeeds, return it. Return “not found”.', 'exit_scope: erase every key of the current list; pop the list; depth ← depth − 1.']: add(step(t, 3))
add(body('The conventional alternative, the {i:shadow chain}, keeps one table entry per plain name holding the innermost visible declaration; each declaration remembers the one it shadows. Algorithm 3 shows it. Resolve is one table lookup regardless of depth and needs no concatenation; declare costs one lookup and one insert; exit_scope restores or erases one entry per declaration. We implemented both on top of every strategy and compare them in Section V-E.', first=False))
add(algtitle(3, 'Block scopes with shadow chains'))
for t in ['enter_scope: remember the current size of the declaration stack.', 'declare(x): look up x; if its entry belongs to the current depth, update it in place; otherwise push (declaration, shadowed entry) on the stack and insert or overwrite the entry for x.', 'resolve(x): return lookup(x).', 'exit_scope: pop declarations down to the remembered size; for each one restore the shadowed declaration (insert) or erase x if nothing was shadowed.']: add(step(t, 5))
add(h2('F. Operation Flow and Modules'))
fig('flow', '/home/claude/doc/un/word/media/2d26adc70b5ffc37464d5e66874329091ec10c11.png', 3.2, 'General operation and measurement flow.')
mods = [['Module', 'Responsibility'], ['symtab.h / symtab.cpp', 'Strategies, hash functions, hybrid counters, both scope managers.'], ['benchmark.cpp', 'Original load-factor sweep and extended workloads.'],
 ['experiments.cpp', 'Per-trial sweeps, probe-length distributions, hybrid stress tests, scope designs, Experiment B, real-code traces.'], ['test_correctness.cpp', 'Hash vectors, edge cases, scopes, differential fuzzing.'],
 ['symtab_cli.cpp', 'Scripted operations for the JavaScript cross-check.'], ['lab/', 'Offline browser lab: visualizer, benchmark, compiler replay, hash lab, tests.'], ['analysis/analyze.py', 'Statistics, figures and tables from the raw CSV files.']]
tbl('modules', 'Software modules.', mods, [1500, 3540], sz=14, align=['left', 'left'])
# ----------------------------------------------------------------------------------------------- IV. Setup
import pandas as pd
bs = pd.read_csv('results/exp_b_summary.csv'); bsn = bs[bs.hash != 'sum']
REL_SD = float((bsn.hit_ns_sd / bsn.hit_ns).median())
add(h1('IV. Experimental Setup'))
add(h2('A. Environment'))
add(body(f'All measurements reported in this paper were taken in one session on one machine, whose full configuration is given in {TR("env")}. It is a virtualized single-core server, so absolute timings are specific to it and are noisy; we therefore repeat every timed point and report dispersion, and we interpret probe counts, which do not depend on the machine, separately from times. The code was compiled with -O2.'))
env = [['Item', 'Value'], ['CPU', 'Intel Xeon Processor (virtualized), 2.10 GHz, 1 vCPU'], ['Memory', '3.9 GiB RAM'], ['Operating system', 'Ubuntu 24.04.4 LTS, x86-64'], ['C++ compiler', GCC], ['Build flags', '-O2 -std=c++17 -Wall -Wextra (tests: -O1 -g -fsanitize=address,undefined)'],
 ['Timer / allocator', 'std::chrono::steady_clock; glibc malloc (heap measured with mallinfo2)'], ['Analysis software', f'Python {PYV}; pandas, matplotlib, SciPy, NumPy {PKG}; Node.js {NODEV}'], ['Real source code', 'Lua 5.4.7, zlib 1.3.1, Redis 7.2.5, SQLite 3.46.0 (release tags)']]
tbl('env', 'Hardware and software environment of all measurements.', env, [1250, 3790], sz=14, align=['left', 'left'])
add(h2('B. Workloads'))
add(body(f'{{b:Synthetic.}} {{i:Random}} identifiers have 3–15 characters, start with a letter and use letters, digits and underscore. {{i:Sequential}} identifiers are var0, var1, …. {{i:Code-like}} identifiers combine 24 common programming words, optional suffix numbers and an m_ prefix. {{b:Real code.}} We extracted identifiers from all C files of four open-source projects, {C("lua")}, {C("zlib")}, {C("redis")} (src/) and {C("sqlite")} (src/), with comments, string literals, preprocessor lines and C keywords removed. {TR("corpora")} describes them. The {{i:-ids}} workloads in Experiment B are the sets of unique identifiers per project. The {{i:traces}} of Section V-G replay every identifier token in source order, one table per source file, as a lexer with an interning symbol table would: a token is looked up and inserted if absent. A {{i:scoped}} replay additionally issues enter/exit_scope at braces and declarations for identifiers that follow a type keyword or type name; this declaration heuristic has no full parser behind it.'))
cor = [['Corpus', 'Files', 'Source lines', 'Id. tokens', 'Unique ids', 'Unique / file (mean)', 'Unique / file (max)', 'Decl. events', 'Use events', 'Max depth']] + T['corpora']
tbl('corpora', 'Real-code workloads (identifier counts after removing comments, strings, directives and keywords).', cor, [560, 380, 600, 560, 520, 520, 520, 520, 520, 340], sz=13)
add(h2('C. Experiments and Statistics'))
add(body(f'{{b:Experiment A}} uses a fixed capacity of 10,007 slots (cuckoo: 10,012), twelve load factors from 0.1 to 0.95, and n = ⌊10,007 α⌋ random keys that are identical for every strategy. Each point is repeated for {M["n_trials"]} trials with different keys. For each trial we insert n keys, search the n keys (five passes, mean per pass) and search n absent keys of the same kind. The main comparison uses {{b:djb2}}, the default hash function of the library; we repeat it with {{b:FNV-1a}}. We report mean ± standard deviation over trials and, for plots, 95 % confidence intervals from the t distribution with {M["n_trials"] - 1} degrees of freedom. {{b:Experiment B}} starts with 1,031 slots and resizes at maximum load 0.7; it covers seven workloads, five hash functions, eight strategies, insert, hit, miss and delete phases and the block-scope workload of Section III-E. Every cell is repeated {M["b_reps"]} times (three times for the weak sum hash, whose clustered cases cost O(n²) and were limited to 10,000 keys) and reported as the median. Run-to-run SD of a median is {REL_SD * 100:.0f} % of the value in a typical cell, so differences below about 15 % should not be read as ranking evidence.'))
params = [['Parameter', 'Experiment A', 'Experiment B', 'Traces'],
 ['Capacity', '10,007 fixed', '1,031, grows at α > 0.7', '211, grows at α > 0.7'], ['Keys', 'random, 3–15 chars', 'random, sequential, code-like; four real unique-id sets', 'identifier tokens of C files'],
 ['Repetitions', '30 trials', '5 (3 for sum hash)', '3'], ['Hash', 'djb2; FNV-1a', 'all five', 'djb2; FNV-1a'], ['Operations', 'insert, hit, miss', 'insert, hit, miss, delete, scope', 'lookup+insert; scoped replay'], ['Reported', 'mean ± SD, 95 % CI', 'median', 'median']]
tbl('params', 'Experimental parameters.', params, [900, 1000, 1700, 1440], sz=14, align=['left', 'left', 'left', 'left'])
# ----------------------------------------------------------------------------------------------- V. Results
add(h1('V. Results'))
add(h2('A. Experiment A: Fixed-Capacity Sweep'))
fig('a1', 'figures/fig_a1.png', 7.0, 'Insertion and successful-search probes versus load factor (djb2, mean over 30 trials, bars: 95 % CI; dotted: Eq. (8)).', wide=True)
add(body(f'Insertion probes rise with load for every strategy ({FR("a1")}a). At α = 0.9 chaining and H1 need 1.45 probes, H2 2.56, double hashing 2.55, quadratic probing 2.79, linear probing and Robin Hood hashing 5.58, and H3 14.87 because cuckoo kicks and slot scans are counted. Successful search ({FR("a1")}b) follows Eq. (8) for linear probing within the confidence interval (5.58 ± 0.17 against 5.50 at α = 0.9). Linear probing and Robin Hood hashing have {{i:identical}} mean costs in {FR("a1")} and {FR("a2")}a. This is expected: Robin Hood hashing moves entries so that probe lengths equalize, but the sum of the displacements of all keys is unchanged, so the mean successful-search cost cannot change; the benefit appears in the distribution (Section V-B).'))
fig('a2', 'figures/fig_a2.png', 7.0, 'Unsuccessful-search probes (consistent metric; dotted: Eq. (9)) and worst-case insertion probes (median over trials) versus load factor.', wide=True)
add(body(f'Unsuccessful search ({FR("a2")}a, {TR("ahead")}) is the most sensitive metric. At α = 0.9 linear probing needs {M["lin09_miss_mean"]:.2f} ± {M["lin09_miss_ci"]:.2f} probes (95 % CI) against 50.50 from Eq. (9), and 49.95 ± 4.64 with FNV-1a; the original five-trial run in the archived data/results.csv gave 50.73. At α = 0.5 the measured 2.52 ± 0.03 matches 2.50 ({TR("theory")}); with the successful-search formula this value would have been 1.5, which is why Eq. (9) must be used. Quadratic probing and double hashing need 11.41 and 9.96 probes, Robin Hood hashing 6.02, H2 5.35, H3 a constant 8.00 (both buckets are always scanned and the stash is empty), and chaining and H1 1.90 on the consistent metric. The raw counter would show 0.90, which is the figure the earlier version contrasted with 50.73; it understates chaining by one probe. The maximum insertion cost ({FR("a2")}b) shows the tails: median maxima at α = 0.9 are 397 (linear, Robin Hood), 465 (H3), 60 (quadratic), 51 (double), 12 (H2) and 6 (chaining, H1).'))
head = [['Strategy', 'Insert probes', 'Hit probes (cons.)', 'Miss probes (raw)', 'Miss probes (cons.)', 'Miss, FNV-1a (cons.)', 'Max insert (median)']] + T['a_head']
tbl('ahead', f'Experiment A at α = 0.9 (mean ± SD over {M["n_trials"]} trials; djb2 unless stated).', head, [900, 720, 720, 720, 720, 720, 540], sz=13)
th = [['α', 'Hit, Eq. (8)', 'Hit measured', 'Miss, Eq. (9)', 'Miss measured (djb2)', 'Miss measured (FNV-1a)', 'Eq. (8) used for miss']] + T['theory']
tbl('theory', 'Linear probing: measured cost (mean ± 95 % CI) against Eqs. (8) and (9).', th, [380, 700, 800, 700, 900, 900, 660], sz=13)
fig('a3', 'figures/fig_a3.png', 7.0, 'Insertion time (whole insertion phase) and successful-search time per pass versus load factor (mean, bars: 95 % CI, 30 trials).', wide=True)
dh = M['dh_insert_ms']
add(body(f'Timing curves ({FR("a3")}, {TR("atime")}) are noisy on the virtualized host, which is why we use 30 trials. The jump of double hashing at α = 0.7 that is visible in a single run is not a feature: the 30-trial mean grows monotonically ({dh["0.60"][0]:.3f}, {dh["0.70"][0]:.3f}, {dh["0.75"][0]:.3f} ms at α = 0.6, 0.7, 0.75) with a relative SD of {M["dh_cv_07"] * 100:.0f} % at α = 0.7. At α = 0.9 chaining and H1 have the cheapest successful search (0.32 and 0.35 ms per pass) against 0.56–0.68 ms for the open-addressing family, while Robin Hood hashing and H3 pay about 2.5 times the insertion time of linear probing (1.65 and 1.70 ms against 0.65 ms). Chaining insertion is noisy (SD 54 % at α = 0.9) because of allocator behaviour.'))
at = [['Strategy', 'Insert α=0.5', 'Hit α=0.5', 'Insert α=0.9', 'Hit α=0.9']] + T['a_time']
tbl('atime', 'Experiment A times in ms (mean ± SD, 30 trials; insertion: whole phase; hit: one pass over all keys).', at, [1100, 980, 980, 980, 1000], sz=14)
fig('a4', 'figures/fig_a4.png', 7.0, 'Insertion and unsuccessful-search probes at α = 0.9 for two hash functions (mean ± SD).', wide=True)
add(body(f'The ranking is the same for the two hash functions ({FR("a4")}). The insertion failure plot of the earlier version is replaced by one statement: no insertion failed in any of the 5,760 table builds except one H3 insertion at α = 0.95 with FNV-1a, so failures are a capacity and policy outcome that matters only for the stress tests of Section V-D.'))
add(h2('B. Probe-Length Distributions'))
fig('dist', 'figures/fig_dist.png', 7.0, 'Complementary distribution of the probes of one search at α = 0.9 (djb2, 30 trials pooled).', wide=True)
dd = [['Strategy', 'Hit mean', 'Hit var.', 'Hit p99', 'Hit max', 'Miss mean', 'Miss var.', 'Miss p99', 'Miss max']] + T['dist']
tbl('distt', 'Probe-length statistics at α = 0.9 (consistent metric).', dd, [900, 500, 500, 450, 450, 520, 560, 520, 450], sz=13)
add(body(f'Linear probing and Robin Hood hashing share the successful-search mean (5.49) but differ in spread ({TR("distt")}, {FR("dist")}): the variance falls from {M["dist_var_lin_hit"]:.0f} to {M["dist_var_rh_hit"]:.0f}, the 99th percentile from 77 to 22 and the maximum from 671 to 40 probes. For unsuccessful search Robin Hood hashing also lowers the mean from 49.9 to 6.0 because its early-exit rule stops at the first resident that is closer to home. Chaining has the smallest spread (hit variance 0.5), which matters for latency-sensitive compilation phases.'))
add(h2('C. Memory'))
fig('mem', 'figures/fig_mem.png', 3.4, 'Table-structure bytes per stored entry: model (ticks) and measured heap (bars) at α = 0.5, 0.7, 0.9.')
mm = [['Strategy', 'α=0.5 model', 'α=0.5 heap', 'α=0.7 model', 'α=0.7 heap', 'α=0.9 model', 'α=0.9 heap']] + T['mem']
tbl('memt', 'Bytes per entry: estimation model and measured heap (djb2, mean of 30 trials).', mm, [900, 700, 700, 700, 700, 700, 640], sz=13, )
add(body(f'The estimate counts only table structure: bytes = (slots × slot size + allocated nodes × node size) / stored entries, with sizeof(Symbol) = 48 B on this platform, a list node 56 B, an open-addressing slot 56 B, an H1 bucket header 24 B and a tree entry 112 B. Identifiers of at most 15 characters fit the string’s inline buffer, so key bytes are inside the symbol. The earlier text and figure disagreed because the figure plotted α = 0.7 (chaining 67.4, open addressing 80.0, H1 90.3, H2 84.5 B) while the text quoted α = 0.9 (64.9, 62.2, 82.7, 69.1 B); both are correct for their load factor ({TR("memt")}). Chaining looks cheapest at low and medium load because it allocates only the nodes it stores (8/α + 56 B per entry), whereas open addressing pre-allocates every slot (56/α B); the model crosses at α ≈ 0.86. The model ignores allocator overhead: measured heap bytes (glibc mallinfo2) are 7.9 B per entry higher for chaining (one 8-byte malloc header per node) and 7.9 B higher for H1, so the measured crossover is near α ≈ 0.75. For slot arrays the measurement equals the model to within 0.1 B.'))
add(h2('D. Do the Hybrids Use Their Special Mechanisms?'))
hya = [['Strategy', 'α', 'Keys', 'Tree conv.', 'Overflow spills', 'Overflow walks', 'Stash', 'Collisions / kicks']] + T['hyb_a']
tbl('hyba', 'Hybrid-mechanism counters in Experiment A (mean per trial, djb2).', hya, [500, 400, 560, 620, 760, 760, 500, 940], sz=13)
add(body(f'In Experiment A, H1 behaves exactly like chaining: in 719 of its 720 builds (30 trials × 12 loads × 2 hashes) no chain exceeded 8 entries, and a single tree conversion occurred in total ({TR("hyba")}). H1’s curves therefore coincide with those of chaining. H2 does use its overflow chain: at α = 0.9 an average of {M["a_h2_overflow_09"]:.0f} of 9,006 keys ({M["a_h2_overflow_09_frac"] * 100:.1f} %) spill, and the chain is walked about 21,800 times per trial; H3 placed 28 keys in its stash over all builds, with a mean of 0.5 per trial at α = 0.95. To exercise the mechanisms we added stress scenarios ({TR("hybs")}): random keys with the weak sum hash, and 256 and 4,096 keys that share one djb2 value (concatenations of the blocks “ab” and “bA”, which have equal djb2 contribution), the hash-flooding case {C("sip")}.'))
hys = [['Scenario', 'Strategy', 'Keys', 'Insert probes', 'Hit probes', 'Miss probes', 'Failed', 'Mechanism count']] + T['hybrid']
tbl('hybs', 'Stress tests at fixed capacity 10,007 (probes on the consistent metric; mechanism counts for H1: tree conversions, H2: spills / overflow walks, H3: stashed keys / kicks).', hys, [1500, 900, 650, 900, 800, 800, 600, 2290], sz=13, wide=True)
add(body(f'With the weak sum hash at α = 0.9, H1 converted {M["hyb_sum09_h1_trees"]} chains to trees and lowered the miss cost from 8.5 (chaining) to 6.1 probes; H2 spilled 7,702 of 9,006 keys to its overflow chain, and H3 failed to place {M["hyb_sum09_h3_failed"]} keys because both candidate buckets and the stash were full. With 4,096 keys of one djb2 value, chaining needs {M["hyb_collide4096_ch_hit"]:.0f} probes per successful search, H1 only {M["hyb_collide4096_h1_hit"]:.0f}; H2’s window does not help hits (2,049) but keeps misses at 1.0 because a miss stops at the first empty slot; H3 spreads colliding keys through its second hash but still rejected {M["hyb_c4096_h3_failed"]} keys at fixed capacity. The mechanisms thus work as designed, and each trades a cost: tree nodes (memory), overflow chains (pointer walks) and rebuilds or failures (cuckoo).'))
add(h2('E. Scope-Handling Designs'))
sc = [['Depth', 'Strategy', 'name@depth, ns/op', 'Shadow chain, ns/op', 'Ratio', 'Lookups / resolve name@d', 'Lookups / resolve shadow']] + [[r[0], r[1], r[2], r[3], r[4], r[5], r[6]] for r in T['scope']]
fig('scope', 'figures/fig_scope.png', 7.0, 'Scope cost of the two designs versus maximum nesting depth (median of 7 repetitions): (a) Eq. (7) in ns per scope operation, (b) table lookups per resolve, (c) raw probes per resolve under linear probing.', wide=True)
tbl('scopet', 'Scope cost, Eq. (7), median (interquartile range) over 7 repetitions, djb2, resizing tables; 80 % of resolves target a visible name.', sc, [500, 1000, 1000, 1000, 500, 520, 520], sz=13)
r8 = M['scope_ratio_d8']; lo, hi = min(r8.values()), max(r8.values())
add(body(f'We replayed identical block-structured programs (150 top-level blocks, each nesting down to the maximum depth, 3–10 declarations and 10–29 resolves per block, 600 names) on both designs and on every strategy; both designs agreed with a reference model on every resolve. At depth 8 the name@depth design needs {M["scope_lk_d8"][0]:.2f} table lookups per resolve (each with a string concatenation) against {M["scope_lk_d8"][1]:.2f} for the shadow chain, and is {lo:.1f}–{hi:.1f} times slower per scope operation, depending on the strategy ({TR("scopet")}, {FR("scope")}a). At depth 2 the factor is 1.4–2.1. The cost of name@depth grows with nesting depth ({FR("scope")}b), whereas the shadow chain is nearly independent of it; its price is one lookup in each declaration and the restore work at scope exit. The shadow chain also helps open addressing disproportionately, because unsuccessful lookups of name@d keys for each outer depth are the expensive case there: under linear probing the raw probes per resolve fall from 7.6 to 1.2 at depth 8 ({FR("scope")}c). Name@depth remains attractive for its simplicity, but a compiler with deep nesting should prefer shadow chains.'))
# ---- Experiment B
add(h2('F. Experiment B: Resizing, Deletion and Workloads'))
au = M['audit_pooled_hit_probes_by_hash']; npp = M['audit_ns_per_probe_overall']
add(body(f'{{b:Audit.}} The earlier summary of this experiment mentioned “very large” values and asked for an audit. We re-examined every column of the benchmark. Units are correct: times are nanoseconds per operation (total milliseconds × 10{{sup:6}} ÷ operations), and the implied time per probe lies between {npp[0]:.0f} and {npp[2]:.0f} ns (5th–95th percentile; median {npp[1]:.0f} ns) in all {M["b_rows"]:,} runs, which is plausible for cache-missing string comparisons and rules out a factor error. The large values come from the weak sum hash: pooled over the three synthetic workloads, the mean number of probes of a successful search is {au["sum"]:,.0f} for sum against {au["fnv1a"]:.2f}–{au["pjw"]:.2f} for the four other hashes, so any average that pools hash functions is dominated by the weak one. Three genuine defects were fixed: (i) results were pooled across hash functions and workloads, so we now report each workload × hash × strategy cell; (ii) each cell was a single run, so we now report the median of {M["b_reps"]} repetitions; (iii) the column max_probe mixed insertion and lookup maxima, which we now keep apart in the CSV. All {M["b_rows"]:,} runs passed the correctness checks (stored keys found, absent keys absent, deleted keys gone).'))
WL = M['b_workloads']; nk = M['b_nkeys']
hdr1 = ['Strategy'] + [w.replace('-ids', ' ids').replace('sequential','seq.').replace('code-like','code') for w in WL]; hdr2 = ['n keys'] + [f'{nk[w]:,}' for w in WL]
def bt(key, cap, k, wide=False):
    rows = [hdr1, hdr2] + T[k]; tbl(key, cap, rows, [900] + [590] * len(WL), sz=13, header=2, wide=wide)
bt('bins', 'Experiment B, djb2: median insertion time in ns per key, including resizing (n: unique keys of the workload).', 'b_ins_djb2')
bt('bhit', 'Experiment B, djb2: median successful-search time in ns.', 'b_hit_djb2')
bt('bmiss', 'Experiment B, djb2: median unsuccessful-search time in ns.', 'b_miss_djb2')
bt('bdel', 'Experiment B, djb2: median deletion time in ns (every second key deleted).', 'b_del_djb2')
bt('bscope', 'Experiment B, djb2: Eq. (7) scope cost in ns per scope operation (name@depth design).', 'b_scope_djb2')
add(body(f'With djb2 and well-distributed identifiers ({TR("bins")}–{TR("bscope")}) most strategies are within noise of each other in time for successful search (roughly 25–100 ns); the clear separations are those that probe counts predict. Chaining and H1 have the cheapest unsuccessful searches (23–47 and 21–43 ns) and H3 the most expensive (68–100 ns, always two buckets). Robin Hood hashing is the fastest, or within 5 ns of the fastest, for successful search on all four real-code sets. Insertion including resizing is cheapest for chaining on synthetic keys (58–138 ns) and costs 2.5–4.5 times more for H1 and H3, which pay for tree bookkeeping and displacement. H1 never converted a chain to a tree with djb2 on any of the seven workloads, so on real identifiers it behaves exactly as chaining; the weak-hash block below is where it differs. Real identifier sets (lua, zlib, redis, sqlite) behave like the random workload; the sequential workload is harder for linear probing and Robin Hood hashing under djb2 (successful-search probes 3.96 against 1.42 on random keys) while double hashing is unaffected (1.37).'))
hs = ['djb2', 'fnv1a', 'sdbm', 'pjw', 'sum']
hrows = [['', 'random', '', '', '', '', 'sequential', '', '', '', '', 'sqlite ids', '', '', '', ''], ['Strategy'] + hs * 3]
for i in range(8): hrows.append([T['b_hash_missp_random'][i][0]] + T['b_hash_missp_random'][i][1:] + T['b_hash_missp_sequential'][i][1:] + T['b_hash_missp_sqlite-ids'][i][1:])
tbl('bhash', 'Experiment B: unsuccessful-search probes (consistent metric, median) for each hash function on three workloads (random and sequential: 30,000 keys, 10,000 for the sum hash; SQLite: 13,835 keys, 10,000 for sum).', hrows, [1000] + [620] * 15, sz=13, header=2, wide=True)
fig('bwl', 'figures/fig_b_workloads.png', 7.0, 'Experiment B, djb2: successful-search time per workload (median ns, log scale).', wide=True)
fig('bhash', 'figures/fig_b_hash.png', 7.0, 'Hash-function sensitivity: successful-search probes (consistent metric, median) on sequential identifiers and on the SQLite identifier set.', wide=True)
add(body(f'Hash functions ({TR("bhash")}, {FR("bhash")}) matter little for the four regular hashes on random and real identifiers, but the weak sum hash is catastrophic for open addressing: on sequential identifiers the miss cost is 9,774 probes for linear probing and 7,236 for Robin Hood hashing, against 44 for chaining, 46 for H2, 3.6 for double hashing and 2.7 for H1, whose trees bound the damage. On the SQLite identifiers the same pattern holds (8,842 and 3,940 against 5.7 for chaining and 4.9 for H1). PJW was the weakest of the regular hashes on sequential names (linear-probing miss cost 197 against 2.1 for FNV-1a), so a hash function must be tested on realistic identifier patterns and not only on random strings.'))
bh = [['Workload', 'Strategy', 'Keys', 'Hit probes', 'Miss probes', 'Tree conv.', 'Overflow spills', 'Stashed']] + T['b_hyb_sum']
tbl('bhyb', 'Hybrid mechanisms under the weak sum hash in Experiment B (median of 3 runs).', bh, [800, 650, 650, 700, 700, 560, 560, 420], sz=13)
add(body(f'Under the sum hash ({TR("bhyb")}) all three mechanisms are active: H1 converts hundreds of chains (637 on random, 211 on sequential and 501 on code-like keys), H2 spills 83–99 % of its keys, and H3 stashed keys on sequential identifiers.'))
# ---- traces
add(h2('G. Real Compiler Workloads'))
fl = [['Strategy', 'Lua ns', 'Lua pr.', 'zlib ns', 'zlib pr.', 'Redis ns', 'Redis pr.', 'SQLite ns', 'SQLite pr.']] + T['trace_flat']
tbl('tflat', 'Flat replay of identifier tokens, djb2: median ns per access and consistent probes per access (including insertions on first occurrence).', fl, [1100] + [490] * 8, sz=13)
fig('trace', 'figures/fig_trace.png', 7.0, 'Real-code replays (djb2): (a) flat replay, ns per identifier access; (b) scoped replay, time of name@depth relative to the shadow chain.', wide=True)
fh = M['trace_flat_hit_ratio']; sh = M['trace_hit_ratio_scoped']
add(body(f'The four corpora contain {sum(int(r[3].replace(",", "")) for r in T["corpora"]):,} identifier tokens; {min(fh.values()) * 100:.0f}–{max(fh.values()) * 100:.0f} % of the accesses of a flat replay are hits, as in a real compiler, where most tokens repeat an identifier already seen ({TR("tflat")}, {FR("trace")}a). Chaining and H1 are fastest (28–51 ns per access, 2.25–2.31 probes), double hashing needs the fewest probes (1.48–1.73), H3 the most (3.7–4.6) and is the slowest (54–86 ns). Chaining and H1 are identical in probes on all four corpora because no chain exceeded eight entries.'))
sl = [['Strategy'] + [f'{c} {d}' for c in ('Lua', 'zlib', 'Redis', 'SQLite') for d in ('name@d', 'shadow')]]
for r in T['trace_scope']: sl.append([r[0]] + [r[1 + 4 * i + j] for i in range(4) for j in (0, 1)])
sl.append(['lookups / resolve'] + [T['trace_scope'][0][3 + 4 * i + j] for i in range(4) for j in (0, 1)])
tbl('tscope', 'Block-scoped replay of real code, djb2: median ns per scope operation for both designs, and table lookups per resolve in the last row (the shadow-chain count includes the lookup made by each declaration).', sl, [1100] + [490] * 8, sz=13)
add(body(f'In the scoped replay ({TR("tscope")}, {FR("trace")}b) the shadow chain is 2.3–3.4 times faster than name@depth on every corpus and strategy, because real code resolves against a depth of up to {max(int(r[9]) for r in T["corpora"])} with {min(sh.values()) * 100:.0f}–{max(sh.values()) * 100:.0f} % of uses resolving to a heuristically detected declaration, so unsuccessful resolves, such as globals and library names not declared in the file, walk the whole chain of depths (2.1–2.6 lookups per resolve against 1.1–1.2). The declaration heuristic misses declarations that do not follow a type name, which understates the hit ratio and favours the shadow chain slightly; we therefore report the direction of the effect, not its precise size.'))
# ----------------------------------------------------------------------------------------------- VI Verification
add(h1('VI. Verification'))
add(body(f'The C++ test suite runs 1,440,178 checks (hash test vectors, edge cases, scope behaviour, and differential fuzzing against std::unordered_map {C("umap")}) under AddressSanitizer and UndefinedBehaviorSanitizer {C("asan","ubsan")}; it passes after the counters and the shadow-chain scope manager were added. Every benchmark run verifies that stored keys are found, absent keys are not returned and deleted keys are gone ({M["b_rows"]:,} Experiment B runs, 5,760 Experiment A builds, and the trace replays all passed). Both scope designs agree with an independent reference model on every resolve of the scope experiment. A JavaScript engine reproduces the C++ engine on identical operation scripts (26,640 counters compared) and passes 433,531 engine checks; browser timings include JIT effects and are for demonstration only. Four issues were corrected before the evaluation: a link error without -O2 (odr-use of static constants), a missing digit in the FNV-1a offset basis, unsequenced random calls in cuckoo hashing, and unequal key counts among strategies in Experiment A; during this revision we also corrected the heap measurement, which had charged an index vector to the table.'))
add(h1('VII. Limitations'))
for t in ['{i:One machine.} All timings come from one virtualized single-core host ({TR_ENV}); ranks that differ by less than about 15 % in time are not reliable, and probe counts are the portable result.'.replace('{TR_ENV}', TR('env')),
          '{i:Logical probes.} A slot, a list node and a tree level are each one probe; H1’s tree cost is the estimate ⌈log₂(size+1)⌉, not a count of comparisons.',
          '{i:Heuristic scope trace.} The declaration detector of the real-code scoped replay is not a parser; it affects hit ratios and therefore the size, not the direction, of the scope-design comparison.',
          '{i:Heap model.} Memory is the table structure plus measured heap; resident-set size, fragmentation and key strings longer than 15 characters are not modelled.',
          '{i:Scope of workloads.} Four C code bases and three synthetic generators do not cover all languages or very large programs; the sum hash was limited to 10,000 keys because its clustered cases are quadratic.',
          '{i:Single thread.} Concurrent symbol tables are outside the study.']: add(bullet(t))
add(h1('VIII. Conclusion and Future Work'))
add(body(f'We implemented eight collision-resolution strategies, five hash functions and two scope designs in one C++17 library and evaluated them with 30 trials per point, two hash functions, a consistent probe metric and workloads that include identifiers from four real C code bases. Linear probing agrees with the classical formulas (53.2 ± 3.9 against 50.5 probes for an unsuccessful search at α = 0.9) and degrades sharply at high load; Robin Hood hashing leaves its mean successful-search cost unchanged but cuts its variance more than tenfold and its unsuccessful-search cost to 6.0; chaining and H1 are the most stable and fastest on real identifier streams; H1, H2 and H3 use their mechanisms only under weak hashes or colliding keys, where H1’s trees keep chains short, H2 absorbs overflow and H3 can reject keys. For scopes, a shadow chain resolves names with one lookup and was 2.6–3.2 times faster than name@depth at nesting depth 8 and 2.3–3.4 times faster on real code. The design guidance is therefore to choose the strategy from the workload and hash function, to prefer a shadow-chain scope manager, and to avoid weak hashes with open addressing.'))
add(body('Future work should repeat the measurements on several machines, count real tree comparisons, use a full parser for the scoped traces, evaluate keyed hash functions and concurrent tables, and extend the corpora beyond C.'))
# ----------------------------------------------------------------------------------------------- declarations
add(h1('Author Contributions'))
add(body('The roles below follow the repository and the evaluation. {hl:[[Replace each placeholder with the initials of the author who did the work; the three authors must confirm this list.]]}'))
for t in ['Library design and implementation (strategies, hash functions, hybrid mechanisms; symtab.h/.cpp): {hl:[[authors]]}.', 'Block-scope manager (name@depth) and shadow-chain scope manager: {hl:[[authors]]}.',
          'Benchmark drivers, per-trial experiments, stress tests and real-code trace replay (benchmark.cpp, experiments.cpp): {hl:[[authors]]}.', 'Browser lab, JavaScript engine and cross-check against the C++ binary: {hl:[[authors]]}.',
          'Correctness tests and sanitizer runs: {hl:[[authors]]}.', 'Statistical analysis, figures and tables (analysis/analyze.py): {hl:[[authors]]}.', 'Manuscript writing and review: {hl:[[authors]]}.']: add(bullet(t))
add(body('{hl:[[Team size: this team has three members, whereas teams of four or five were expected. Confirm that the author list is complete before submission.]]}', first=False))
add(h1('Use of AI Tools'))
add(body('Generative AI (Anthropic’s Claude) was used to help write the additional experiment programs, the analysis scripts and the text of this manuscript, and to search for and check the cited literature. {hl:[[The authors reviewed and verified the code, the results and every reference, and take responsibility for the content.]]} All reported numbers were produced by the programs in the repository and can be regenerated with run_all.sh.'))
add(h1('Data and Code Availability'))
add(body(f'All code, raw per-trial CSV files, analysis scripts, figures and the reproduction scripts (make, run_all.sh, fetch_corpora.sh) are in the repository {REPO}, commit {COMMIT}. The real-code workloads are obtained by fetch_corpora.sh from the release tags listed in {TR("env")} and are not redistributed; SHA-256 checksums of the downloaded archives are stored in corpora/SHA256SUMS.txt. The original five-trial results and plots are kept in data/.'))
add(para('', sect(2)))
add(h1('References'))
for k in D.reflist: add(ref(D.cites[k], REFS[k]))
# ----------------------------------------------------------------------------------------------- biographies
add(h1('Authors'))
bios = [('SYED AYMAN ALAM', '24BAI0100'), ('GIRIJESHVASAN M', '24BCE2352'), ('BRAJESH AGRAWAL', '24BCE0551')]
for name, reg in bios:
    photo = para(run('[[PHOTO]]', sz=14, hl=True), '<w:spacing w:after="0"/><w:jc w:val="center"/>')
    cell = lambda w, inner, b=True: f'<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="{w}"/>' + ('<w:tcBorders><w:top w:val="single" w:sz="4" w:color="000000"/><w:left w:val="single" w:sz="4" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:color="000000"/><w:right w:val="single" w:sz="4" w:color="000000"/></w:tcBorders><w:vAlign w:val="center"/>' if b else '') + f'</w:tcPr>{inner}</w:tc>'
    text = para(run(name, sz=16, b=True) + runs(f' is an undergraduate student (Reg. No. {reg}) at Vellore Institute of Technology, {{hl:[[campus and school]]}}. {{hl:[[Add year and place of birth, degree programme, research interests and any awards, 2–4 sentences.]]}}', sz=16), '<w:spacing w:after="0" w:line="220"/><w:jc w:val="both"/>')
    add(f'<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="5040"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="1250"/><w:gridCol w:w="3790"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="1800" w:hRule="atLeast"/></w:trPr>{cell(1250, photo)}{cell(3790, text, False)}</w:tr></w:tbl>' + para('', '<w:spacing w:after="80" w:line="120" w:lineRule="exact"/>'))
# consistency of pre-assigned numbers
assert FIG == FIG_SAVE, (FIG, FIG_SAVE); assert TBL == TBL_SAVE, (TBL, TBL_SAVE)
out = 'Symbol_Table_Manuscript_IEEE_Access.docx'
package(D, '/home/claude/doc/un', out, 'ALAM et al.: Performance Evaluation of a Compiler’s Symbol Table Implementation', 'VOLUME 14, 2026')
print('built', out, 'refs', len(D.reflist), 'figs', len(FIG), 'tables', len(TBL))
