#!/usr/bin/env python3
"""Builds lab/index.html - a single self-contained file (no internet needed) from lab/src/*."""
import pathlib, re, sys
here = pathlib.Path(__file__).resolve().parent
src = here / "src"
read = lambda p: p.read_text(encoding="utf-8")
parts = {
    "CSS": read(src / "style.css"),
    "CHARTJS": read(here / "vendor" / "chart.umd.js"),
    "ENGINE": read(src / "engine.js"), "LEXER": read(src / "lexer.js"), "COMMON": read(src / "common.js"),
    "VIZ": read(src / "viz.js"), "BENCH": read(src / "bench.js"), "COMPILER": read(src / "compiler.js"),
    "HASHLAB": read(src / "hashlab.js"), "TESTS": read(src / "tests.js"), "GUIDE": read(src / "guide.js"), "HOME": read(src / "home.js"), "MAIN": read(src / "main.js"),
}
csv = here.parent / "data" / "results.csv"
parts["RESULTS_CSV"] = read(csv) if csv.exists() else ""
html = read(src / "template.html")
for k, v in parts.items():
    if "</script" in v.lower() and k != "CSS":
        v = re.sub(r"</(script)", r"<\\/\1", v, flags=re.I)         # never let content close the tag
    html = html.replace("/*@@%s@@*/" % k, v)
out = here / "index.html"
out.write_text(html, encoding="utf-8")
print("wrote %s (%.0f KB)" % (out, out.stat().st_size / 1024))
