"""Compare three seed-selection rules with identical soft-region learning.

This is an exploratory within-renderer ablation, not a blind benchmark.
The only algorithmic switch is the source of the 196 initial region cores.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

import adaptive_soft_regions as region


ROOT = Path(__file__).resolve().parent
STRATEGIES = ("grid", "edge", "medoid")
LABELS = {"grid": "Regular grid", "edge": "Weak-edge core",
          "medoid": "DINO feature medoid"}


def chosen_mode(row):
    result = row["grown_soft"]
    return {
        "first_level11_top1_out_of_8": result["top1_by_level_out_of_8"].get("11", 0),
        "future_top1_out_of_24": result["future_top1_out_of_24"],
        "frozen_future_top1_out_of_24": sum(
            result["frozen_top1_by_level_out_of_8"].get(str(level), 0)
            for level in (12, 16, 20)),
        "future_top1_by_level_out_of_8": {
            str(level): result["top1_by_level_out_of_8"].get(str(level), 0)
            for level in (12, 16, 20)},
        "old_level10_top1_out_of_8": result["old_level10_top1_out_of_8"],
        "absent_false_positives_out_of_8": result["absent_false_positives_out_of_8"],
        "mean_click_attempts": result["mean_click_attempts"],
        "level11_updates_by_session": result["updates_by_level"]["11"],
    }


def preview_figure(crops, previews, output):
    fig, axes = plt.subplots(2, 3, figsize=(11.4, 7.4), constrained_layout=True)
    crop = np.s_[82:394, 82:394]
    for col, strategy in enumerate(STRATEGIES):
        preview = previews[strategy]
        old = np.asarray(crops[preview["reference_index"]])
        new = np.asarray(crops[preview["level11_index"]])
        raw = preview["raw"].reshape(region.K, region.GRID, region.GRID)
        seeds = preview["seeds"]
        central = min(range(region.K), key=lambda k:
                      (seeds[k][0] - 14) ** 2 + (seeds[k][1] - 14) ** 2)
        membership = cv2.resize(raw[central], (448, 448),
                                interpolation=cv2.INTER_NEAREST)
        ax = axes[0, col]
        ax.imshow(old[crop])
        ax.imshow(membership[crop], cmap="winter",
                  alpha=np.clip(membership[crop] * 0.85, 0, 0.8), vmin=0, vmax=1)
        sites = np.array(seeds)
        inside = ((sites[:, 1] * 16 >= 82) & (sites[:, 1] * 16 < 394) &
                  (sites[:, 0] * 16 >= 82) & (sites[:, 0] * 16 < 394))
        ax.scatter(sites[inside, 1] * 16 - 82, sites[inside, 0] * 16 - 82,
                   s=7, c="white", alpha=0.65, linewidths=0)
        ax.scatter(seeds[central][1] * 16 - 82,
                   seeds[central][0] * 16 - 82, s=70, c="#ffdd42",
                   marker="x", linewidths=2)
        ax.set_title(LABELS[strategy] + " · one grown zone")
        selected = preview["changed"]["grown_soft"]
        union = raw[selected].max(axis=0) if selected.any() else np.zeros(
            (region.GRID, region.GRID), dtype=np.float32)
        union = cv2.resize(union.astype(np.float32), (448, 448),
                           interpolation=cv2.INTER_NEAREST)
        ax = axes[1, col]
        ax.imshow(new[crop])
        ax.imshow(union[crop], cmap="autumn",
                  alpha=np.clip(union[crop] * 0.7, 0, 0.75), vmin=0, vmax=1)
        ax.set_title(f"Updated after confirmation · {selected.sum()}/196 zones")
    for ax in axes.flat:
        ax.set_xticks([])
        ax.set_yticks([])
    fig.savefig(output, dpi=160)
    plt.close(fig)


def run_one(dataset, destination):
    destination.mkdir(parents=True, exist_ok=True)
    crops, records = region.load_dataset(dataset)
    print(f"Loaded {len(crops)} crops from {dataset.name}", flush=True)
    patches = region.embed(crops)[3].astype(np.float32)
    groups = region.groups_of(records)
    summaries = {}
    previews = {}
    first_reference = None
    seed_choices = {}
    for strategy in STRATEGIES:
        print("Seed strategy", strategy, flush=True)
        thresholds = region.validation_thresholds(records, patches, groups, strategy)
        cutoffs = region.tune_presence_cutoffs(records, patches, groups, strategy)
        results, preview = region.evaluate(records, patches, groups,
                                           thresholds, cutoffs, strategy)
        previews[strategy] = preview
        if first_reference is None:
            first_reference = patches[preview["reference_index"]]
        seed_choices[strategy] = region.seed_positions(first_reference, strategy)[0]
        summaries[strategy] = {
            "metrics": chosen_mode(results),
            "validation_change_threshold": thresholds["grown_soft"],
            "validation_presence_cutoff": cutoffs["grown_soft"],
        }
        print(strategy, summaries[strategy]["metrics"], flush=True)
    grid = np.array(seed_choices["grid"])
    for strategy in STRATEGIES:
        sites = np.array(seed_choices[strategy])
        summaries[strategy]["seed_geometry_first_test_session"] = {
            "same_as_grid_out_of_196": int(np.all(sites == grid, axis=1).sum()),
            "mean_displacement_from_grid_patches": round(float(np.linalg.norm(
                sites - grid, axis=1).mean()), 3),
        }
    edge = np.array(seed_choices["edge"])
    medoid = np.array(seed_choices["medoid"])
    comparison = {
        "dataset": str(dataset),
        "model": "frozen DINOv3 ViT-S/16 layer 3, 448x448 input, 28x28 patches",
        "control": "196 cores, identical feature growth, soft membership, patch-level score, validation calibration, online update, three candidate proposals",
        "rules": {
            "grid": "every second patch, no image-dependent choice",
            "edge": "within 3x3 around each grid site, lowest maximum neighbor DINO cosine difference",
            "medoid": "within the same 3x3, highest similarity to weighted 5x5 local DINO feature prototype; no edge calculation in selection",
        },
        "edge_vs_medoid_identical_sites_first_test_session_out_of_196": int(
            np.all(edge == medoid, axis=1).sum()),
        "results": summaries,
        "limitations": "Synthetic game; known proposals and game confirmation feedback; datasets were explored before; not a fresh blind holdout",
    }
    (destination / "comparison.json").write_text(
        json.dumps(comparison, ensure_ascii=False, indent=2), encoding="utf-8")
    preview_figure(crops, previews, destination / "seed-comparison.png")
    return comparison


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path,
                        default=ROOT.parent / "data" / "upgrade-confirmation-dataset.json")
    parser.add_argument("--out", type=Path,
                        default=ROOT.parent / "results" / "generated" / "seed-selection-comparison-dev")
    args = parser.parse_args()
    run_one(args.dataset, args.out)


if __name__ == "__main__":
    main()
