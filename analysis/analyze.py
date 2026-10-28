"""Turns the raw per-trial CSV files in results/ into statistics, figures (figures/) and paper_data.json.
Run from the repository root:  python3 analysis/analyze.py
Probe metric used for every cross-strategy comparison ("consistent probes"): one probe = one distinct memory
location examined (table slot, bucket-head pointer, list node, tree level).  The raw counter of the C++ library
does not count the bucket-head read of chaining / H1 lookups, so the consistent lookup metric is raw + 1 for those
two strategies (insert counters already agree, see manuscript Section III-D)."""
import json, os, sys
import numpy as np, pandas as pd
from scipy import stats as st
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt

R = "results"; F = "figures"; os.makedirs(F, exist_ok=True)
OUT = {}
SHORT = {"Separate Chaining": "Chaining", "Linear Probing": "Linear", "Quadratic Probing": "Quadratic", "Double Hashing": "Double",
         "Robin Hood Hashing": "Robin Hood", "H1: Chaining + Tree": "H1", "H2: Open Addr + Overflow": "H2", "H3: Cuckoo + Stash": "H3"}
ORDER = list(SHORT)
COL = {"Separate Chaining": "#4C72B0", "Linear Probing": "#DD8452", "Quadratic Probing": "#55A868", "Double Hashing": "#C44E52",
       "Robin Hood Hashing": "#8172B2", "H1: Chaining + Tree": "#17becf", "H2: Open Addr + Overflow": "#bcbd22", "H3: Cuckoo + Stash": "#e377c2"}
MK = {"Separate Chaining": "o", "Linear Probing": "s", "Quadratic Probing": "^", "Double Hashing": "D", "Robin Hood Hashing": "*",
      "H1: Chaining + Tree": "P", "H2: Open Addr + Overflow": "X", "H3: Cuckoo + Stash": "v"}
HYB = {"Robin Hood Hashing", "H1: Chaining + Tree", "H2: Open Addr + Overflow", "H3: Cuckoo + Stash"}
BUCKET = {"Separate Chaining", "H1: Chaining + Tree"}            # lookups read one extra location (the bucket head)
plt.rcParams.update({"font.size": 8, "axes.titlesize": 8, "axes.labelsize": 8, "legend.fontsize": 6.5, "xtick.labelsize": 7, "ytick.labelsize": 7,
                     "font.family": "serif", "axes.grid": True, "grid.alpha": .3, "figure.dpi": 100})

def tcrit(n): return st.t.ppf(0.975, max(n - 1, 1))
def agg(df, by, cols):
    g = df.groupby(by)[cols]; m = g.mean(); s = g.std(ddof=1); n = g.count()
    ci = s.copy()
    for c in cols: ci[c] = s[c] * tcrit(n[c].iloc[0]) / np.sqrt(n[c])
    return m, s, ci
def fmt(x, d=2): return f"{x:.{d}f}"
def pm(m, s, d=2): return f"{m:.{d}f} ± {s:.{d}f}"
def fmtint(x): return f"{x:,.0f}"

# ----------------------------------------------------------------------------- Experiment A
A = {}
for h in ("djb2", "fnv1a"):
    d = pd.read_csv(f"{R}/exp_a_trials_{h}.csv")
    for c in ("hit_probes", "miss_probes"):
        d[c + "_c"] = d[c] + d["strategy"].isin(BUCKET).astype(int)
    A[h] = d
NTR = A["djb2"]["trial"].nunique(); OUT["n_trials"] = int(NTR)
OUT["failed_total"] = int(A["djb2"].failed.sum() + A["fnv1a"].failed.sum()); OUT["ok_min"] = int(min(A["djb2"].ok.min(), A["fnv1a"].ok.min()))
METR = ["avg_insert_probes", "hit_probes_c", "miss_probes_c", "miss_probes", "hit_probes", "max_insert_probes", "insert_ms", "hit_ms", "miss_ms", "model_bytes_per_entry", "heap_bytes_per_entry"]
SUM = {}
for h, d in A.items():
    m, s, ci = agg(d, ["strategy", "load_factor"], METR)
    SUM[h] = (m, s, ci)
    out = m.add_suffix("_mean").join(s.add_suffix("_sd")).join(ci.add_suffix("_ci95")); out.to_csv(f"{R}/exp_a_summary_{h}.csv")
LFS = sorted(A["djb2"].load_factor.unique())

def lineplot(ax, h, col, ylabel, logy=False, theory=None):
    m, s, ci = SUM[h]
    for sname in ORDER:
        mm = m.loc[sname][col]; cc = ci.loc[sname][col]
        ax.errorbar(mm.index, mm.values, yerr=cc.values, marker=MK[sname], color=COL[sname], ls="--" if sname in HYB else "-", lw=1, ms=3.5, capsize=1.5, elinewidth=.6, label=SHORT[sname])
    if theory is not None:
        x = np.linspace(.1, .95, 100); ax.plot(x, theory(x), "k:", lw=1.2, label="theory (linear)")
    ax.set_xlabel("load factor α"); ax.set_ylabel(ylabel)
    if logy: ax.set_yscale("log")

def panel_fig(fname, specs, h="djb2", size=(7.1, 2.7)):
    fig, axes = plt.subplots(1, len(specs), figsize=size)
    for ax, (col, yl, logy, th, title) in zip(np.atleast_1d(axes), specs):
        lineplot(ax, h, col, yl, logy, th); ax.set_title(title)
    np.atleast_1d(axes)[0].legend(ncol=2, loc="upper left")
    fig.tight_layout(); fig.savefig(f"{F}/{fname}", dpi=220); plt.close(fig)
hit_th = lambda a: .5 * (1 + 1 / (1 - a)); miss_th = lambda a: .5 * (1 + 1 / (1 - a) ** 2)
panel_fig("fig_a1.png", [("avg_insert_probes", "probes per insert", True, None, "(a) insertion"), ("hit_probes_c", "probes per successful search", False, hit_th, "(b) successful search")])
panel_fig("fig_a2.png", [("miss_probes_c", "probes per unsuccessful search", True, miss_th, "(a) unsuccessful search"), ("max_insert_probes", "max probes of one insert", True, None, "(b) worst-case insertion")])
panel_fig("fig_a3.png", [("insert_ms", "insert time, whole phase (ms)", False, None, "(a) insertion time"), ("hit_ms", "successful-search time per pass (ms)", False, None, "(b) successful-search time")])

# headline bars at 0.9, two hashes
fig, axes = plt.subplots(1, 2, figsize=(7.1, 2.6)); w = .38; xs = np.arange(8)
for ax, col, ttl in zip(axes, ["avg_insert_probes", "miss_probes_c"], ["(a) insertion probes", "(b) unsuccessful-search probes"]):
    for k, (h, off) in enumerate((("djb2", -w / 2), ("fnv1a", w / 2))):
        m, s, ci = SUM[h]; v = [m.loc[(x, .9)][col] for x in ORDER]; e = [s.loc[(x, .9)][col] for x in ORDER]
        ax.bar(xs + off, v, w, yerr=e, capsize=1.5, label=h, color=["#4C72B0", "#DD8452"][k], error_kw={"elinewidth": .6})
    ax.set_xticks(xs); ax.set_xticklabels([SHORT[x] for x in ORDER], rotation=35, ha="right"); ax.set_yscale("log"); ax.set_title(ttl + " at α = 0.9 (mean ± SD)"); ax.set_ylabel("probes")
axes[0].legend(); fig.tight_layout(); fig.savefig(f"{F}/fig_a4.png", dpi=220); plt.close(fig)

# tables
T = {}
def row_at(h, sname, lf): m, s, ci = SUM[h]; return m.loc[(sname, lf)], s.loc[(sname, lf)], ci.loc[(sname, lf)]
T["a_head"] = []
for sname in ORDER:
    m, s, _ = row_at("djb2", sname, .9); mf, sf, _ = row_at("fnv1a", sname, .9)
    mx = A["djb2"][(A["djb2"].strategy == sname) & (A["djb2"].load_factor == .9)].max_insert_probes.median()
    T["a_head"].append([SHORT[sname], pm(m.avg_insert_probes, s.avg_insert_probes), pm(m.hit_probes_c, s.hit_probes_c), pm(m.miss_probes, s.miss_probes), pm(m.miss_probes_c, s.miss_probes_c), pm(mf.miss_probes_c, sf.miss_probes_c), fmtint(mx)])
T["a_time"] = []
for sname in ORDER:
    r = []
    for lf in (.5, .9):
        m, s, _ = row_at("djb2", sname, lf); r += [pm(m.insert_ms, s.insert_ms, 3), pm(m.hit_ms, s.hit_ms, 3)]
    T["a_time"].append([SHORT[sname]] + r)
# theory vs measurement, linear probing
T["theory"] = []
for lf in (.5, .7, .9):
    m, s, ci = row_at("djb2", "Linear Probing", lf); mf, _, cif = row_at("fnv1a", "Linear Probing", lf)
    T["theory"].append([f"{lf:.1f}", fmt(hit_th(lf)), f"{m.hit_probes_c:.2f} ± {ci.hit_probes_c:.2f}", fmt(.5 * (1 + 1 / (1 - lf)), 2) if False else fmt(miss_th(lf)), f"{m.miss_probes_c:.2f} ± {ci.miss_probes_c:.2f}", f"{mf.miss_probes_c:.2f} ± {cif.miss_probes_c:.2f}", fmt(.5 * (1 + 1 / (1 - lf)))])
OUT["lin09_miss_mean"] = float(SUM["djb2"][0].loc[("Linear Probing", .9)].miss_probes); OUT["lin09_miss_ci"] = float(SUM["djb2"][2].loc[("Linear Probing", .9)].miss_probes)
OUT["lin05_miss_mean"] = float(SUM["djb2"][0].loc[("Linear Probing", .5)].miss_probes); OUT["lin05_hit_mean"] = float(SUM["djb2"][0].loc[("Linear Probing", .5)].hit_probes)
# noise at the double-hashing 0.7 point
dh = A["djb2"][A["djb2"].strategy == "Double Hashing"].groupby("load_factor").insert_ms.agg(["mean", "std", "median"])
OUT["dh_insert_ms"] = {f"{k:.2f}": [round(v["mean"], 3), round(v["std"], 3), round(v["median"], 3)] for k, v in dh.iterrows()}
OUT["dh_cv_07"] = float(dh.loc[.7, "std"] / dh.loc[.7, "mean"])

# memory
T["mem"] = []
for sname in ORDER:
    r = [SHORT[sname]]
    for lf in (.5, .7, .9):
        m, s, _ = row_at("djb2", sname, lf); r += [fmt(m.model_bytes_per_entry, 1), fmt(m.heap_bytes_per_entry, 1)]
    T["mem"].append(r)
fig, ax = plt.subplots(figsize=(3.45, 2.6)); w = .2
for k, (lf, c) in enumerate(((.5, "#9ecae1"), (.7, "#6baed6"), (.9, "#2171b5"))):
    mod = [SUM["djb2"][0].loc[(x, lf)].model_bytes_per_entry for x in ORDER]; hp = [SUM["djb2"][0].loc[(x, lf)].heap_bytes_per_entry for x in ORDER]
    ax.bar(xs + (k - 1) * w, hp, w, color=c, label=f"measured heap, α={lf}")
    ax.plot(xs + (k - 1) * w, mod, "k_", ms=5, mew=1.2, label="model" if k == 0 else None)
ax.set_xticks(xs); ax.set_xticklabels([SHORT[x] for x in ORDER], rotation=35, ha="right"); ax.set_ylabel("bytes per stored entry"); ax.legend(ncol=2, fontsize=6)
fig.tight_layout(); fig.savefig(f"{F}/fig_mem.png", dpi=220); plt.close(fig)

# hybrid mechanisms inside experiment A
T["hyb_a"] = []
for sname, cols in (("H1: Chaining + Tree", ["treeifications"]), ("H2: Open Addr + Overflow", ["overflow_inserts", "overflow_lookups"]), ("H3: Cuckoo + Stash", ["stash_inserts", "stash_lookups"])):
    for lf in (.5, .9, .95):
        d = A["djb2"][(A["djb2"].strategy == sname) & (A["djb2"].load_factor == lf)]; n = d.n_items.iloc[0]
        T["hyb_a"].append([SHORT[sname], f"{lf:.2f}", fmtint(n)] + [fmt(d[c].mean(), 1) if c in cols else "–" for c in ("treeifications", "overflow_inserts", "overflow_lookups", "stash_inserts")] + [fmt(d.collisions.mean(), 0)])
OUT["a_treeifications_total"] = int(pd.concat(A.values()).query("strategy=='H1: Chaining + Tree'").treeifications.sum())
OUT["a_stash_total"] = int(pd.concat(A.values()).query("strategy=='H3: Cuckoo + Stash'").stash_inserts.sum())
OUT["a_h2_overflow_09"] = float(A["djb2"].query("strategy=='H2: Open Addr + Overflow' and load_factor==0.9").overflow_inserts.mean())
OUT["a_h2_overflow_09_frac"] = OUT["a_h2_overflow_09"] / float(A["djb2"].query("load_factor==0.9").n_items.iloc[0])

# ----------------------------------------------------------------------------- probe-length distributions
D = pd.read_csv(f"{R}/exp_dist.csv")
D["probes_c"] = D["probes"] + D["strategy"].isin(BUCKET).astype(int)
def dstats(g):
    p = np.repeat(g.probes_c.values, g["count"].values); return pd.Series({"mean": p.mean(), "var": p.var(ddof=0), "p99": np.percentile(p, 99), "p999": np.percentile(p, 99.9), "max": p.max()})
DS = D.groupby(["hash", "strategy", "load_factor", "kind"]).apply(dstats, include_groups=False).reset_index()
DS.to_csv(f"{R}/exp_dist_summary.csv", index=False)
T["dist"] = []
for sname in ("Linear Probing", "Robin Hood Hashing", "Double Hashing", "Separate Chaining"):
    r = [SHORT[sname]]
    for kind in ("hit", "miss"):
        x = DS[(DS.hash == "djb2") & (DS.strategy == sname) & (DS.load_factor == .9) & (DS.kind == kind)].iloc[0]
        r += [fmt(x["mean"]), fmt(x["var"], 1), fmtint(x["p99"]), fmtint(x["max"])]
    T["dist"].append(r)
fig, axes = plt.subplots(1, 2, figsize=(7.1, 2.5))
for ax, kind, ttl in zip(axes, ("hit", "miss"), ("(a) successful search", "(b) unsuccessful search")):
    for sname in ("Linear Probing", "Robin Hood Hashing", "Double Hashing", "Separate Chaining"):
        g = D[(D.hash == "djb2") & (D.strategy == sname) & (D.load_factor == .9) & (D.kind == kind)].sort_values("probes_c")
        tot = g["count"].sum(); ccdf = 1 - (g["count"].cumsum() - g["count"]) / tot   # P(probes >= x)
        ax.step(g.probes_c, ccdf, where="post", color=COL[sname], lw=1.2, label=SHORT[sname])
    ax.set_xscale("log"); ax.set_yscale("log"); ax.set_xlabel("probes of one search"); ax.set_ylabel("P(probes ≥ x)"); ax.set_title(ttl + ", α = 0.9, djb2"); ax.set_ylim(1e-5, 1.2)
axes[0].legend(); fig.tight_layout(); fig.savefig(f"{F}/fig_dist.png", dpi=220); plt.close(fig)
OUT["dist_var_lin_hit"] = float(DS[(DS.hash == "djb2") & (DS.strategy == "Linear Probing") & (DS.load_factor == .9) & (DS.kind == "hit")]["var"].iloc[0])
OUT["dist_var_rh_hit"] = float(DS[(DS.hash == "djb2") & (DS.strategy == "Robin Hood Hashing") & (DS.load_factor == .9) & (DS.kind == "hit")]["var"].iloc[0])
OUT["dist_mean_lin_hit"] = float(DS[(DS.hash == "djb2") & (DS.strategy == "Linear Probing") & (DS.load_factor == .9) & (DS.kind == "hit")]["mean"].iloc[0])
OUT["dist_mean_rh_hit"] = float(DS[(DS.hash == "djb2") & (DS.strategy == "Robin Hood Hashing") & (DS.load_factor == .9) & (DS.kind == "hit")]["mean"].iloc[0])

# ----------------------------------------------------------------------------- hybrid stress scenarios
H = pd.read_csv(f"{R}/exp_hybrid.csv"); H["hit_c"] = H.hit_probes + H.strategy.isin(BUCKET); H["miss_c"] = H.miss_probes + H.strategy.isin(BUCKET)
H.to_csv(f"{R}/exp_hybrid_consistent.csv", index=False)
T["hybrid"] = []
for scn in ("random-djb2-a0.9", "random-sum-a0.9", "collide-djb2-256", "collide-djb2-4096"):
    for base, hyb in (("Separate Chaining", "H1: Chaining + Tree"), ("Linear Probing", "H2: Open Addr + Overflow"), (None, "H3: Cuckoo + Stash")):
        for sname in ([base] if base else []) + [hyb]:
            x = H[(H.scenario == scn) & (H.strategy == sname)].iloc[0]
            mech = {"H1: Chaining + Tree": f"{int(x.treeifications)} conversions", "H2: Open Addr + Overflow": f"{int(x.overflow_inserts)} spills / {int(x.overflow_lookups)} chain walks",
                    "H3: Cuckoo + Stash": f"{int(x.stash_inserts)} stashed / {int(x.collisions)} kicks"}.get(sname, "–")
            T["hybrid"].append([scn.replace("a0.9", "α0.9"), SHORT[sname], fmtint(x.n_keys), fmt(x.avg_insert_probes, 1), fmt(x.hit_c, 1), fmt(x.miss_c, 1), fmtint(x.failed), mech])
OUT["hyb_collide4096_h1_hit"] = float(H[(H.scenario == "collide-djb2-4096") & (H.strategy == "H1: Chaining + Tree")].hit_c.iloc[0])
OUT["hyb_collide4096_ch_hit"] = float(H[(H.scenario == "collide-djb2-4096") & (H.strategy == "Separate Chaining")].hit_c.iloc[0])
OUT["hyb_sum09_h1_trees"] = int(H[(H.scenario == "random-sum-a0.9") & (H.strategy == "H1: Chaining + Tree")].treeifications.iloc[0])
OUT["hyb_sum09_h3_failed"] = int(H[(H.scenario == "random-sum-a0.9") & (H.strategy == "H3: Cuckoo + Stash")].failed.iloc[0])
OUT["hyb_c4096_h3_failed"] = int(H[(H.scenario == "collide-djb2-4096") & (H.strategy == "H3: Cuckoo + Stash")].failed.iloc[0])

# ----------------------------------------------------------------------------- scopes
if os.path.exists(f"{R}/exp_scopes.csv"):
    S = pd.read_csv(f"{R}/exp_scopes.csv"); OUT["scopes_ok"] = int(S.ok.min())
    g = S.groupby(["strategy", "design", "max_depth"]).agg(ns=("ns_per_scope_op", "median"), ns_q1=("ns_per_scope_op", lambda x: x.quantile(.25)), ns_q3=("ns_per_scope_op", lambda x: x.quantile(.75)),
                                                           lk=("table_lookups_per_resolve", "first"), pr=("table_probes_per_resolve", "first")).reset_index()
    g.to_csv(f"{R}/exp_scopes_summary.csv", index=False)
    T["scope"] = []
    for D_ in (2, 8):
        for sname in ORDER:
            a = g[(g.strategy == sname) & (g.design == "name@depth") & (g.max_depth == D_)].iloc[0]; b = g[(g.strategy == sname) & (g.design == "shadow-chain") & (g.max_depth == D_)].iloc[0]
            T["scope"].append([str(D_), SHORT[sname], f"{a.ns:.0f} ({a.ns_q1:.0f}–{a.ns_q3:.0f})", f"{b.ns:.0f} ({b.ns_q1:.0f}–{b.ns_q3:.0f})", f"{a.ns / b.ns:.2f}×", fmt(a.lk, 2), fmt(b.lk, 2), fmt(a.pr, 1), fmt(b.pr, 1)])
    fig, axes = plt.subplots(1, 3, figsize=(7.1, 2.5))
    for sname, ls in (("Separate Chaining", "o"), ("Linear Probing", "s"), ("H1: Chaining + Tree", "P")):
        for design, lsty in (("name@depth", "-"), ("shadow-chain", "--")):
            x = g[(g.strategy == sname) & (g.design == design)].sort_values("max_depth")
            axes[0].plot(x.max_depth, x.ns, ls + lsty, color=COL[sname], ms=3.5, lw=1, label=f"{SHORT[sname]}, {design}")
    axes[0].set_xscale("log", base=2); axes[0].set_xlabel("maximum block-nesting depth"); axes[0].set_ylabel("ns per scope operation (median)"); axes[0].set_title("(a) Eq. (7) scope cost"); axes[0].legend(fontsize=5.5)
    for design, lsty in (("name@depth", "-"), ("shadow-chain", "--")):
        x = g[(g.strategy == "Separate Chaining") & (g.design == design)].sort_values("max_depth"); axes[1].plot(x.max_depth, x.lk, "o" + lsty, color="k", ms=3.5, lw=1, label=design)
        x = g[(g.strategy == "Linear Probing") & (g.design == design)].sort_values("max_depth"); axes[2].plot(x.max_depth, x.pr, "s" + lsty, color=COL["Linear Probing"], ms=3.5, lw=1, label=design)
    axes[1].set_xscale("log", base=2); axes[1].set_xlabel("maximum block-nesting depth"); axes[1].set_ylabel("table lookups per resolve"); axes[1].set_title("(b) lookups per resolve"); axes[1].legend()
    axes[2].set_xscale("log", base=2); axes[2].set_xlabel("maximum block-nesting depth"); axes[2].set_ylabel("raw probes per resolve (linear probing)"); axes[2].set_title("(c) probes per resolve"); axes[2].legend()
    fig.tight_layout(); fig.savefig(f"{F}/fig_scope.png", dpi=220); plt.close(fig)
    d8 = g[g.max_depth == 8]
    OUT["scope_ratio_d8"] = {SHORT[s]: float(d8[(d8.strategy == s) & (d8.design == "name@depth")].ns.iloc[0] / d8[(d8.strategy == s) & (d8.design == "shadow-chain")].ns.iloc[0]) for s in ORDER}
    OUT["scope_lk_d8"] = [float(d8[(d8.strategy == "Separate Chaining") & (d8.design == "name@depth")].lk.iloc[0]), float(d8[(d8.strategy == "Separate Chaining") & (d8.design == "shadow-chain")].lk.iloc[0])]

# ----------------------------------------------------------------------------- Experiment B
if os.path.exists(f"{R}/exp_b_reps.csv"):
    B = pd.read_csv(f"{R}/exp_b_reps.csv")
    for c in ("hit_probes", "miss_probes"): B[c + "_c"] = B[c] + B.strategy.isin(BUCKET).astype(int)
    B["ns_per_probe"] = B.hit_ns / B.hit_probes_c
    BM = ["insert_ns", "hit_ns", "miss_ns", "delete_ns", "scope_ns_per_op", "hit_probes_c", "miss_probes_c", "insert_probes", "max_insert_probe", "max_lookup_probe", "resizes", "load_factor", "model_bytes_per_entry", "heap_bytes_per_entry", "treeifications", "overflow_inserts", "stash_inserts"]
    Bm = B.groupby(["workload", "hash", "strategy"])[BM].median().reset_index(); Bm["n_keys"] = B.groupby(["workload", "hash", "strategy"]).n_keys.first().values
    Bs = B.groupby(["workload", "hash", "strategy"])[["insert_ns", "hit_ns", "miss_ns"]].std(ddof=1).add_suffix("_sd").reset_index()
    Bm = Bm.merge(Bs, on=["workload", "hash", "strategy"]); Bm.to_csv(f"{R}/exp_b_summary.csv", index=False)
    OUT["b_ok_min"] = int(B.ok.min()); OUT["b_rows"] = int(len(B)); OUT["b_reps"] = int(B.rep.max() + 1)
    WL = [w for w in ["random", "sequential", "code-like", "lua-ids", "zlib-ids", "redis-ids", "sqlite-ids"] if w in set(B.workload)]
    OUT["b_workloads"] = WL; OUT["b_nkeys"] = {w: int(B[B.workload == w].n_keys.iloc[0]) for w in WL}
    # audit: ns per probe and share of the pooled mean due to the weak hash
    pool_all = B[B.workload.isin(["random", "sequential", "code-like"])].groupby("hash").hit_probes_c.mean()
    OUT["audit_pooled_hit_probes_by_hash"] = {k: float(v) for k, v in pool_all.items()}
    OUT["audit_ns_per_probe_median"] = {k: float(v) for k, v in B[B.strategy.isin(["Linear Probing", "Robin Hood Hashing"])].groupby("hash").ns_per_probe.median().items()}
    OUT["audit_ns_per_probe_overall"] = [float(B.ns_per_probe.quantile(q)) for q in (0.05, .5, .95)]
    def tab(metric, hsh, d=0, scale=1):
        rows = []
        for sname in ORDER:
            r = [SHORT[sname]]
            for w in WL:
                x = Bm[(Bm.workload == w) & (Bm.hash == hsh) & (Bm.strategy == sname)]
                r.append(fmt(x[metric].iloc[0] * scale, d) if len(x) else "–")
            rows.append(r)
        return rows
    T["b_hit_djb2"] = tab("hit_ns", "djb2", 0); T["b_ins_djb2"] = tab("insert_ns", "djb2", 0); T["b_miss_djb2"] = tab("miss_ns", "djb2", 0)
    T["b_del_djb2"] = tab("delete_ns", "djb2", 0); T["b_scope_djb2"] = tab("scope_ns_per_op", "djb2", 0); T["b_missp_djb2"] = tab("miss_probes_c", "djb2", 2); T["b_hitp_djb2"] = tab("hit_probes_c", "djb2", 2)
    T["b_bpe_djb2"] = tab("model_bytes_per_entry", "djb2", 1); T["b_resz_djb2"] = tab("resizes", "djb2", 0)
    HS = ["djb2", "fnv1a", "sdbm", "pjw", "sum"]
    def htab(metric, w, d=2):
        rows = []
        for sname in ORDER:
            r = [SHORT[sname]]
            for hsh in HS:
                x = Bm[(Bm.workload == w) & (Bm.hash == hsh) & (Bm.strategy == sname)]; r.append(fmt(x[metric].iloc[0], d) if len(x) else "–")
            rows.append(r)
        return rows
    for w in WL:
        T[f"b_hash_missp_{w}"] = htab("miss_probes_c", w, 2); T[f"b_hash_hitns_{w}"] = htab("hit_ns", w, 0); T[f"b_hash_hitp_{w}"] = htab("hit_probes_c", w, 2)
    # figures: hit ns by workload (djb2), hash sensitivity
    fig, ax = plt.subplots(figsize=(7.1, 2.8)); n = len(WL); w_ = .8 / n
    for i, w in enumerate(WL):
        v = [Bm[(Bm.workload == w) & (Bm.hash == "djb2") & (Bm.strategy == s)].hit_ns.iloc[0] for s in ORDER]
        ax.bar(np.arange(8) + (i - (n - 1) / 2) * w_, v, w_, label=w)
    ax.set_xticks(range(8)); ax.set_xticklabels([SHORT[x] for x in ORDER]); ax.set_ylabel("median ns per successful search"); ax.set_yscale("log"); ax.legend(ncol=4, fontsize=6); ax.set_title("Experiment B, djb2: successful-search time per workload")
    fig.tight_layout(); fig.savefig(f"{F}/fig_b_workloads.png", dpi=220); plt.close(fig)
    fig, axes = plt.subplots(1, 2, figsize=(7.1, 2.7))
    for ax, w in zip(axes, ("sequential", WL[-1])):
        piv = Bm[Bm.workload == w].pivot(index="strategy", columns="hash", values="hit_probes_c").reindex(ORDER)[HS]; piv.index = [SHORT[x] for x in piv.index]
        piv.plot(kind="bar", ax=ax, width=.8, logy=True, legend=False); ax.set_ylabel("probes per successful search"); ax.set_xlabel(""); ax.set_title(f"({'a' if w == 'sequential' else 'b'}) {w} identifiers"); ax.tick_params(axis="x", rotation=35)
    axes[0].legend(ncol=3, fontsize=6); fig.tight_layout(); fig.savefig(f"{F}/fig_b_hash.png", dpi=220); plt.close(fig)
    # hybrid counters in B for the weak hash
    T["b_hyb_sum"] = []
    for w in WL[:3]:
        for sname in ("H1: Chaining + Tree", "H2: Open Addr + Overflow", "H3: Cuckoo + Stash"):
            x = Bm[(Bm.workload == w) & (Bm.hash == "sum") & (Bm.strategy == sname)].iloc[0]
            T["b_hyb_sum"].append([w, SHORT[sname], fmtint(x.n_keys), fmt(x.hit_probes_c, 1), fmt(x.miss_probes_c, 1), fmtint(x.treeifications), fmtint(x.overflow_inserts), fmtint(x.stash_inserts)])
    OUT["b_hyb_djb2_treeif"] = int(Bm[(Bm.hash == "djb2") & (Bm.strategy == "H1: Chaining + Tree")].treeifications.sum())

# ----------------------------------------------------------------------------- real traces
if os.path.exists(f"{R}/exp_trace.csv"):
    X = pd.read_csv(f"{R}/exp_trace.csv"); C = pd.read_csv(f"{R}/exp_trace_corpora.csv"); OUT["trace_ok_min"] = int(X.ok.min())
    X["pa_c"] = X.probes_per_access + X.strategy.isin(BUCKET).astype(int) * X.lookups_per_access   # flat: lookups counted once per access
    C.to_csv(f"{R}/exp_trace_corpora.csv", index=False)
    T["corpora"] = [[r.corpus, fmtint(r.files), fmtint(r.source_lines), fmtint(r.identifier_tokens), fmtint(r.unique_identifiers_global), fmt(r.mean_unique_per_file, 0), fmtint(r.max_unique_per_file), fmtint(r.decl_events), fmtint(r.use_events), str(int(r.max_brace_depth))] for r in C.itertuples()]
    Xm = X.groupby(["corpus", "hash", "strategy", "mode", "design"], dropna=False).agg(ns=("ns_per_access", "median"), pa=("probes_per_access", "median"), la=("lookups_per_access", "median"), hit=("hit_ratio", "median"), rs=("resizes", "median")).reset_index()
    Xm.to_csv(f"{R}/exp_trace_summary.csv", index=False)
    CORP = list(C.corpus)
    T["trace_flat"] = []
    for sname in ORDER:
        r = [SHORT[sname]]
        for c in CORP:
            x = Xm[(Xm.corpus == c) & (Xm.hash == "djb2") & (Xm.strategy == sname) & (Xm["mode"] == "flat")].iloc[0]; r += [fmt(x.ns, 0), fmt(x.pa + (1 if sname in BUCKET else 0) * x.la, 2)]
        T["trace_flat"].append(r)
    T["trace_scope"] = []
    for sname in ORDER:
        r = [SHORT[sname]]
        for c in CORP:
            a = Xm[(Xm.corpus == c) & (Xm.hash == "djb2") & (Xm.strategy == sname) & (Xm.design == "name@depth")].iloc[0]; b = Xm[(Xm.corpus == c) & (Xm.hash == "djb2") & (Xm.strategy == sname) & (Xm.design == "shadow-chain")].iloc[0]
            r += [fmt(a.ns, 0), fmt(b.ns, 0), fmt(a.la, 2), fmt(b.la, 2)]
        T["trace_scope"].append(r)
    OUT["trace_corpora"] = CORP
    OUT["trace_hit_ratio_scoped"] = {c: float(Xm[(Xm.corpus == c) & (Xm.design == "name@depth") & (Xm.hash == "djb2") & (Xm.strategy == "Separate Chaining")].hit.iloc[0]) for c in CORP}
    OUT["trace_flat_hit_ratio"] = {c: float(Xm[(Xm.corpus == c) & (Xm["mode"] == "flat") & (Xm.hash == "djb2") & (Xm.strategy == "Separate Chaining")].hit.iloc[0]) for c in CORP}
    fig, axes = plt.subplots(1, 2, figsize=(7.1, 2.6)); n = len(CORP); w_ = .8 / n
    for i, c in enumerate(CORP):
        v = [Xm[(Xm.corpus == c) & (Xm.hash == "djb2") & (Xm.strategy == s) & (Xm["mode"] == "flat")].ns.iloc[0] for s in ORDER]; axes[0].bar(np.arange(8) + (i - (n - 1) / 2) * w_, v, w_, label=c)
        v2 = [Xm[(Xm.corpus == c) & (Xm.hash == "djb2") & (Xm.strategy == s) & (Xm.design == "name@depth")].ns.iloc[0] / Xm[(Xm.corpus == c) & (Xm.hash == "djb2") & (Xm.strategy == s) & (Xm.design == "shadow-chain")].ns.iloc[0] for s in ORDER]
        axes[1].bar(np.arange(8) + (i - (n - 1) / 2) * w_, v2, w_, label=c)
    axes[0].set_title("(a) flat replay: ns per identifier access"); axes[1].set_title("(b) scoped replay: name@depth / shadow-chain time"); axes[1].axhline(1, color="k", lw=.7)
    for ax in axes: ax.set_xticks(range(8)); ax.set_xticklabels([SHORT[x] for x in ORDER], rotation=35, ha="right")
    axes[0].legend(fontsize=6); fig.tight_layout(); fig.savefig(f"{F}/fig_trace.png", dpi=220); plt.close(fig)

json.dump({"T": T, "N": OUT}, open("results/paper_data.json", "w"), indent=1, default=float)
print(json.dumps(OUT, indent=1, default=float)[:6000])
