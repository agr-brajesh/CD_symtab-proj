#!/bin/sh
# Reproduces every number in the revised manuscript (run from the repository root; needs g++, make, python3 with pandas/matplotlib/scipy).
set -e
make all experiments test_correctness
./test_correctness
[ -d corpora/lua ] || sh fetch_corpora.sh
mkdir -p results && cd results
../experiments sweep --hash djb2  --trials 30 --out exp_a_trials_djb2.csv
../experiments sweep --hash fnv1a --trials 30 --out exp_a_trials_fnv1a.csv
../experiments dist   --trials 30 --out exp_dist.csv
../experiments hybrid --out exp_hybrid.csv
../experiments scopes --reps 15 --out exp_scopes.csv
../experiments trace  --corpora ../corpora --reps 5 --out exp_trace.csv --stats exp_trace_corpora.csv
../experiments extb   --corpora ../corpora --n 30000 --reps 5 --reps-sum 3 --out exp_b_reps.csv
cd .. && python3 analysis/analyze.py
