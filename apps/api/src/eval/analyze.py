#!/usr/bin/env python3
"""Analyze one or more comparison runs.

    python3 apps/api/src/eval/analyze.py apps/api/eval-reports/comparison.json
    python3 apps/api/src/eval/analyze.py run1.json run2.json run3.json

`comparison.md` reports what happened in a single run. This answers two
questions that report cannot:

1. How much of the gap between two models is real, and how much is 63 samples?
   A pass rate with no interval around it invites a confidence the sample size
   does not support, so every rate here carries a Wilson score interval.

2. Does a case fail the same way every time? Pass a second run and the per case
   section shows the pattern across every trial in every run. A case that
   alternates is a different problem from one that never works, and only
   showing them together makes the difference visible.

Standard library only. If matplotlib happens to be installed, --plot writes a
chart of per case consistency; without it the text report is unchanged.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any


def wilson(hits: int, total: int, z: float = 1.96) -> tuple[float, float]:
    """95% Wilson score interval for a binomial proportion.

    Preferred over the normal approximation here because the proportions are
    near 0 and 1 and the samples are small, which is exactly where the normal
    interval misbehaves and can run past 0% or 100%.
    """
    if total == 0:
        return (0.0, 0.0)
    p = hits / total
    denom = 1 + z**2 / total
    center = (p + z**2 / (2 * total)) / denom
    margin = z * math.sqrt(p * (1 - p) / total + z**2 / (4 * total**2)) / denom
    return (max(0.0, center - margin), min(1.0, center + margin))


def pct(x: float) -> str:
    return f"{x * 100:.1f}%"


def load(path: Path) -> list[dict[str, Any]]:
    with path.open() as fh:
        data = json.load(fh)
    if not isinstance(data, list):
        raise SystemExit(f"{path}: expected a list of model comparisons")
    return data


def model_section(run_label: str, model: dict[str, Any]) -> None:
    backend = model["backend"]
    cases = model["casesPassed"]
    trials = model["trials"]
    runs = cases["of"] * trials

    hits = sum(c["passed"] for c in model["perCase"])
    lo, hi = wilson(hits, runs)

    print(f"\n  {backend['label']}  ({backend['model']})")
    print(f"    cases passed     {cases['mean']} / {cases['of']}   range {cases['min']}–{cases['max']}")
    print(f"    pass rate        {pct(hits / runs)}   95% CI {pct(lo)}–{pct(hi)}   n={runs}")
    print(f"    always passed    {model['alwaysPassed']} / {cases['of']}")
    print(f"    jagged           {model['flaky']}   (passed some trials, failed others)")
    print(f"    latency          {model['avgMs'] / 1000:.1f}s mean, {model['p95Ms'] / 1000:.1f}s p95")
    print(f"    errors           {model['errors']}")

    grounded = model["groundedPicks"]
    if grounded["total"]:
        g_lo, g_hi = wilson(grounded["hits"], grounded["total"])
        print(
            f"    grounded picks   {pct(grounded['hits'] / grounded['total'])}"
            f"   95% CI {pct(g_lo)}–{pct(g_hi)}   n={grounded['total']} picks"
        )
    else:
        print("    grounded picks   no picks produced")


def checks_section(models: list[dict[str, Any]]) -> None:
    """Which constraints were actually evaluated, and how often they passed.

    A check missing for a model was never run, because the agent produced no
    picks to run it against. That is not a zero and it is not a pass, and
    collapsing the two is how a model that produces nothing ends up looking
    like it satisfies every rule.
    """
    names = sorted({name for m in models for name in m["checkPassRates"]})
    if not names:
        return

    print("\n  Constraint pass rates, with intervals")
    width = max(len(n) for n in names)
    for name in names:
        print(f"    {name:<{width}}", end="")
        for m in models:
            rate = m["checkPassRates"].get(name)
            if not rate or not rate["total"]:
                print(f"   {'not evaluated':>24}", end="")
                continue
            lo, hi = wilson(rate["passed"], rate["total"])
            cell = f"{pct(rate['passed'] / rate['total'])} [{pct(lo)}–{pct(hi)}] n={rate['total']}"
            print(f"   {cell:>24}", end="")
        print()
    print(f"    {'':<{width}}", end="")
    for m in models:
        print(f"   {m['backend']['label'][:24]:>24}", end="")
    print()


def consistency_section(runs: list[tuple[str, list[dict[str, Any]]]]) -> None:
    """Per case outcomes pooled across every run, keyed by model label."""
    # label -> case id -> (prompt, passed, trials)
    tally: dict[str, dict[str, list[Any]]] = defaultdict(lambda: defaultdict(lambda: [None, 0, 0]))
    for _, models in runs:
        for m in models:
            label = m["backend"]["label"]
            for case in m["perCase"]:
                entry = tally[label][case["id"]]
                entry[0] = case["prompt"]
                entry[1] += case["passed"]
                entry[2] += case["trials"]

    for label, cases in tally.items():
        jagged = {cid: e for cid, e in cases.items() if 0 < e[1] < e[2]}
        never = [e[0] for e in cases.values() if e[1] == 0]
        always = [e[0] for e in cases.values() if e[1] == e[2]]

        print(f"\n  {label} across {len(runs)} run{'' if len(runs) == 1 else 's'}")
        print(f"    always passed    {len(always)}")
        print(f"    never passed     {len(never)}")
        print(f"    jagged           {len(jagged)}")

        if jagged:
            print("\n    Cases that pass sometimes:")
            for _, (prompt, passed, trials) in sorted(jagged.items(), key=lambda kv: -kv[1][1]):
                lo, hi = wilson(passed, trials)
                print(f"      {passed}/{trials}  [{pct(lo)}–{pct(hi)}]  {prompt}")
            print(
                "\n    These are the interesting ones. A capability that appears"
                "\n    intermittently is harder to design around than a missing one,"
                "\n    because the failure does not announce itself."
            )


def plot(runs: list[tuple[str, list[dict[str, Any]]]], out: Path) -> None:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("\n  (matplotlib not installed, skipping --plot)", file=sys.stderr)
        return

    tally: dict[str, dict[str, list[Any]]] = defaultdict(lambda: defaultdict(lambda: [None, 0, 0]))
    for _, models in runs:
        for m in models:
            label = m["backend"]["label"]
            for case in m["perCase"]:
                entry = tally[label][case["id"]]
                entry[0] = case["prompt"]
                entry[1] += case["passed"]
                entry[2] += case["trials"]

    labels = list(tally)
    case_ids = list(tally[labels[0]]) if labels else []
    prompts = [tally[labels[0]][cid][0] for cid in case_ids]

    fig, ax = plt.subplots(figsize=(10, max(4, len(case_ids) * 0.3)))
    height = 0.8 / max(1, len(labels))
    for i, label in enumerate(labels):
        rates = [tally[label][cid][1] / max(1, tally[label][cid][2]) for cid in case_ids]
        ys = [y + i * height for y in range(len(case_ids))]
        ax.barh(ys, rates, height=height, label=label)

    ax.set_yticks([y + 0.4 - height / 2 for y in range(len(case_ids))])
    ax.set_yticklabels(prompts, fontsize=8)
    ax.set_xlabel("Share of trials passed")
    ax.set_xlim(0, 1)
    # A strong model's bars span the full width, so there is no empty space
    # inside the axes for a legend to sit without covering a result.
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.08 - 2.0 / max(6, len(case_ids))), ncol=len(labels), frameon=False)
    ax.set_title("Per case consistency across all trials")
    fig.tight_layout()
    fig.savefig(out, dpi=150)
    print(f"\n  Chart written to {out}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("reports", nargs="+", type=Path, help="one or more comparison.json files")
    parser.add_argument("--plot", type=Path, metavar="OUT.png", help="also write a per case chart")
    args = parser.parse_args()

    runs: list[tuple[str, list[dict[str, Any]]]] = []
    for path in args.reports:
        if not path.exists():
            raise SystemExit(f"{path}: no such file. Run `npm run eval:compare` first.")
        runs.append((path.name, load(path)))

    total_runs = sum(m["casesPassed"]["of"] * m["trials"] for _, models in runs for m in models)
    print(f"\n{len(runs)} report{'' if len(runs) == 1 else 's'} · {total_runs} case runs\n")
    print("Intervals are 95% Wilson score. They are wide because the samples are")
    print("small, which is the point: a pass rate from 63 observations should not")
    print("be read as a precise number.")

    for name, models in runs:
        print(f"\n{'─' * 60}\n{name}")
        for m in models:
            model_section(name, m)
        checks_section(models)

    print(f"\n{'─' * 60}\nPer case consistency")
    consistency_section(runs)

    if args.plot:
        plot(runs, args.plot)
    print()


if __name__ == "__main__":
    main()
