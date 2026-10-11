"""Paired frozen/one-confirmation/continual-memory re-detection ablation.

All policies see exactly the same synthetic screenshots and DINOv3 features.
The game-provided identity is disclosed only after that screen's ranking.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

import adaptive_soft_regions as region


ROOT = Path(__file__).resolve().parent
DATASETS = (ROOT.parent / "data" / "upgrade-confirmation-dataset.json",
            ROOT.parent / "data" / "upgrade-replication-dataset.json")
STRATEGIES = ("grid", "edge", "medoid")
POLICIES = {"frozen": frozenset(), "level11_once": frozenset((11,)),
            "continual": frozenset((11, 12, 16, 20))}
LEVELS = (11, 12, 16, 20)
FUTURE = (12, 16, 20)


def candidate_scores(candidates, patches, anchor, current, mask):
    return {slot: region.paired_score(region.feature_map(patches[index]),
                                      anchor, current, mask, mask)
            for slot, index in candidates.items()}


def update_memory(current, mask, confirmed, threshold):
    patch_similarity = np.sum(current * confirmed, axis=-1)
    delta = np.maximum(0, 1 - mask @ patch_similarity)
    selected = region.select_update(delta, threshold)
    selected_strength = (mask[selected].max(axis=0) if selected.any()
                         else np.zeros(region.CELLS))
    strongest_strength = mask.max(axis=0)
    blend = 0.95 * np.clip(selected_strength /
                           np.maximum(strongest_strength, 1e-8), 0, 1)
    return region.unit((1 - blend[:, None]) * current +
                       blend[:, None] * confirmed), int(selected.sum())


def run_dataset(path):
    crops, records = region.load_dataset(path)
    print(f"Loaded {len(crops)} crops from {path.name}", flush=True)
    patches = region.embed(crops)[3].astype(np.float32)
    groups = region.groups_of(records)
    sessions = sorted({row["session"] for row in records if row["split"] == "test"})
    result = {}
    for strategy in STRATEGIES:
        threshold = region.validation_thresholds(records, patches, groups,
                                                 strategy)["grown_soft"]
        cutoff = region.tune_presence_cutoffs(records, patches, groups,
                                              strategy)["grown_soft"]
        print("Strategy", strategy, "threshold", threshold,
              "presence", cutoff, flush=True)
        observations = defaultdict(list)
        absent_fp = defaultdict(int)
        old_top1 = defaultdict(int)
        update_counts = defaultdict(list)
        for session in sessions:
            old_group = groups[("test", session, 10, True)]
            old_index = region.target_index(old_group, records)
            anchor = region.feature_map(patches[old_index])
            masks, _, _, _ = region.make_masks(patches[old_index], strategy)
            mask = masks["grown_soft"]
            for policy, update_levels in POLICIES.items():
                current = anchor.copy()
                for level in LEVELS:
                    candidates = groups[("test", session, level, True)]
                    truth = next(slot for slot, index in candidates.items()
                                 if records[index]["target"])
                    scores = candidate_scores(candidates, patches, anchor,
                                              current, mask)
                    best = max(scores, key=scores.get)
                    margin = scores[truth] - max(value for slot, value
                                                 in scores.items() if slot != truth)
                    observations[policy].append({
                        "session": session, "level": level,
                        "top1": bool(best == truth),
                        "accepted_correct": bool(best == truth and
                                                 scores[best] >= cutoff),
                        "target_margin": round(float(margin), 6),
                    })
                    # Simulated game confirmation supplies the true slot only
                    # after this screen's pre-update decision is recorded.
                    if level in update_levels:
                        confirmed = region.feature_map(patches[candidates[truth]])
                        current, count = update_memory(current, mask, confirmed,
                                                       threshold)
                        update_counts[policy].append(count)
                old_scores = candidate_scores(old_group, patches, anchor,
                                              current, mask)
                old_truth = next(slot for slot, index in old_group.items()
                                 if records[index]["target"])
                old_top1[policy] += int(max(old_scores, key=old_scores.get) ==
                                        old_truth)
                absent = groups[("test", session, 20, False)]
                absent_scores = candidate_scores(absent, patches, anchor,
                                                  current, mask)
                absent_fp[policy] += int(max(absent_scores.values()) >= cutoff)
        policy_results = {}
        for policy in POLICIES:
            rows = observations[policy]
            future = [row for row in rows if row["level"] in FUTURE]
            policy_results[policy] = {
                "top1_future_out_of_24": sum(row["top1"] for row in future),
                "accepted_correct_future_out_of_24": sum(
                    row["accepted_correct"] for row in future),
                "top1_by_level_out_of_8": {
                    str(level): sum(row["top1"] for row in rows
                                    if row["level"] == level)
                    for level in LEVELS},
                "accepted_correct_by_level_out_of_8": {
                    str(level): sum(row["accepted_correct"] for row in rows
                                    if row["level"] == level)
                    for level in LEVELS},
                "old_level10_top1_out_of_8": old_top1[policy],
                "absent_false_positives_out_of_8": absent_fp[policy],
                "mean_updated_regions_per_confirmation": (
                    round(float(np.mean(update_counts[policy])), 2)
                    if update_counts[policy] else 0),
                "screens": rows,
            }
        frozen = {(r["session"], r["level"]): r for r in
                  observations["frozen"] if r["level"] in FUTURE}
        for policy in ("level11_once", "continual"):
            future = [r for r in observations[policy] if r["level"] in FUTURE]
            policy_results[policy]["vs_frozen_future"] = {
                "wrong_to_right": sum(not frozen[(r["session"], r["level"])]["top1"]
                                      and r["top1"] for r in future),
                "right_to_wrong": sum(frozen[(r["session"], r["level"])]["top1"]
                                      and not r["top1"] for r in future),
            }
        result[strategy] = {"policies": policy_results,
                            "validation_change_threshold": threshold,
                            "validation_presence_cutoff": cutoff}
        print(strategy, {policy: policy_results[policy]["top1_future_out_of_24"]
                         for policy in POLICIES}, flush=True)
    return {"dataset": str(path), "results": result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path,
                        default=ROOT.parent / "results" / "generated" / "learning-gain-analysis")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    datasets = [run_dataset(path) for path in DATASETS]
    report = {
        "protocol": {
            "model": "frozen DINOv3 ViT-S/16 layer 3; weights never updated",
            "learning": "only confirmed target's patch-feature memory is blended in selected overlapping regions",
            "policies": {"frozen": "no confirmed update",
                         "level11_once": "update after confirmed level 11 only",
                         "continual": "update after confirmed levels 11, 12, 16, 20"},
            "metric": "pre-update top1 among three known candidates at levels 12, 16, 20; accepted_correct additionally requires validation-calibrated presence threshold",
            "limitation": "same synthetic renderer; known proposals; confirmation oracle; previously explored sessions, not blind holdout",
        },
        "datasets": datasets,
    }
    (args.out / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
