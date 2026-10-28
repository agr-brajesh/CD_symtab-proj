"""Regenerates every graph from results.csv (sweep) and, if present, results_extended.csv.

    python3 plot_results.py            # run from the folder that contains the CSV files
"""
import os
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

df = pd.read_csv("results.csv")
strategies = list(df["strategy"].unique())

colors = {
    "Separate Chaining": "#4C72B0", "Linear Probing": "#DD8452", "Quadratic Probing": "#55A868",
    "Double Hashing": "#C44E52", "Robin Hood Hashing": "#8172B2",
    "H1: Chaining + Tree": "#17becf", "H2: Open Addr + Overflow": "#bcbd22", "H3: Cuckoo + Stash": "#e377c2",
}
markers = {
    "Separate Chaining": "o", "Linear Probing": "s", "Quadratic Probing": "^", "Double Hashing": "D", "Robin Hood Hashing": "*",
    "H1: Chaining + Tree": "P", "H2: Open Addr + Overflow": "X", "H3: Cuckoo + Stash": "v",
}
HYBRID = {"Robin Hood Hashing", "H1: Chaining + Tree", "H2: Open Addr + Overflow", "H3: Cuckoo + Stash"}
style = lambda s: "--" if s in HYBRID else "-"          # classic = solid, hybrid = dashed


def lineplot(ycol, ylabel, title, fname, logy=False):
    plt.figure(figsize=(9, 6))
    for s in strategies:
        sub = df[df["strategy"] == s].sort_values("load_factor")
        plt.plot(sub["load_factor"], sub[ycol], marker=markers[s], color=colors[s], linestyle=style(s),
                 label=s, linewidth=2, markersize=7)
    plt.xlabel("Load Factor (n / capacity)")
    plt.ylabel(ylabel)
    plt.title(title)
    if logy:
        plt.yscale("log")
    plt.legend(fontsize=8)
    plt.grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig(fname, dpi=150)
    plt.close()


lineplot("avg_insert_probes", "Avg. Probes per Insert", "Average Insert Probes vs Load Factor", "1_avg_insert_probes.png", logy=True)
lineplot("avg_search_probes_hit", "Avg. Probes per Successful Search", "Average Successful Search Probes vs Load Factor", "2_avg_search_hit_probes.png")
lineplot("avg_search_probes_miss", "Avg. Probes per Unsuccessful Search", "Average Unsuccessful Search Probes vs Load Factor", "3_avg_search_miss_probes.png", logy=True)
lineplot("max_insert_probes", "Max Probes (worst case) per Insert", "Worst-Case Insert Probes vs Load Factor", "4_max_insert_probes.png", logy=True)
lineplot("insert_time_ms", "Total Insert Time (ms)", "Insert Time vs Load Factor", "5_insert_time.png")
lineplot("search_hit_time_ms", "Total Search Time - Hits (ms)", "Successful Search Time vs Load Factor", "6_search_hit_time.png")

# 7. Stress comparison at load factor 0.9
lf = 0.9
sub = df[df["load_factor"] == lf].set_index("strategy").reindex(strategies)
fig, axes = plt.subplots(1, 2, figsize=(14, 5.5))
for ax, col, ttl in ((axes[0], "avg_insert_probes", f"Avg Insert Probes @ Load Factor {lf}"),
                     (axes[1], "avg_search_probes_miss", f"Avg Unsuccessful Search Probes @ Load Factor {lf}")):
    sub[col].plot(kind="bar", ax=ax, color=[colors[s] for s in strategies])
    ax.set_title(ttl)
    ax.set_ylabel("Avg Probes")
    ax.set_xlabel("")
    ax.tick_params(axis="x", rotation=40)
    for lbl in ax.get_xticklabels():
        lbl.set_ha("right")
plt.tight_layout()
plt.savefig("7_stress_comparison_bar.png", dpi=150)
plt.close()

# 8. Failed inserts (fixed capacity: can the scheme still place every key?)
plt.figure(figsize=(9, 5.5))
for s in strategies:
    sub = df[df["strategy"] == s].sort_values("load_factor")
    plt.plot(sub["load_factor"], sub["failed_inserts"], marker=markers[s], color=colors[s], linestyle=style(s), label=s, linewidth=2)
plt.xlabel("Load Factor (n / capacity)")
plt.ylabel("Inserts that could not be placed (avg per trial)")
plt.title("Fixed-Capacity Insert Failures vs Load Factor")
plt.legend(fontsize=8)
plt.grid(alpha=0.3)
plt.tight_layout()
plt.savefig("8_failed_inserts.png", dpi=150)
plt.close()

# 9. Memory per entry at load factor 0.7 (a typical operating point)
m = df[df["load_factor"] == 0.7].set_index("strategy").reindex(strategies)
plt.figure(figsize=(9, 5.5))
m["bytes_per_entry"].plot(kind="bar", color=[colors[s] for s in strategies])
plt.ylabel("Table-structure bytes per stored symbol")
plt.title("Memory Overhead @ Load Factor 0.7")
plt.xticks(rotation=40, ha="right")
plt.xlabel("")
plt.tight_layout()
plt.savefig("9_memory_per_entry.png", dpi=150)
plt.close()

# ---------------------------------------------------------------- extended results
if os.path.exists("results_extended.csv"):
    ex = pd.read_csv("results_extended.csv")
    order = strategies

    # 10. ns/op by operation, random workload, djb2
    r = ex[(ex["workload"] == "random") & (ex["hash"] == "djb2")].set_index("strategy").reindex(order)
    ax = r[["insert_ns", "hit_ns", "miss_ns", "delete_ns", "scope_ns_per_op"]].plot(kind="bar", figsize=(12, 6), width=0.8)
    ax.set_ylabel("ns per operation")
    ax.set_title("Real-Compiler Conditions: time per operation (random identifiers, djb2, auto-resize @ 0.7)")
    ax.legend(["insert", "lookup hit", "lookup miss", "delete", "block-scoped workload"], fontsize=8)
    plt.xticks(rotation=40, ha="right")
    plt.xlabel("")
    plt.grid(axis="y", alpha=0.3)
    plt.tight_layout()
    plt.savefig("10_extended_ns_per_op.png", dpi=150)
    plt.close()

    # 11. Hash function sensitivity: avg hit probes, sequential workload (var0..varN), log scale
    for wl, fn in (("sequential", "11_hash_sensitivity_sequential.png"), ("random", "12_hash_sensitivity_random.png")):
        p = ex[ex["workload"] == wl].pivot(index="strategy", columns="hash", values="hit_probes").reindex(order)
        p = p[[c for c in ["djb2", "fnv1a", "sdbm", "pjw", "sum"] if c in p.columns]]
        ax = p.plot(kind="bar", figsize=(11, 6), width=0.8)
        ax.set_yscale("log")
        ax.set_ylabel("Avg probes per successful lookup (log)")
        ax.set_title(f"Hash-Function Sensitivity ({wl} identifiers)")
        plt.xticks(rotation=40, ha="right")
        plt.xlabel("")
        plt.grid(axis="y", alpha=0.3)
        plt.tight_layout()
        plt.savefig(fn, dpi=150)
        plt.close()

print("All plots generated.")
print(df.groupby("strategy")[["avg_insert_probes", "avg_search_probes_hit", "avg_search_probes_miss"]].mean().round(2))
