"""Boundary-seeded, feature-grown soft regions with online confirmed updates.

Exploratory game experiment. Masks are formed without renderer labels. The
known target is supplied only after a successful in-game confirmation so that
memory updating is not driven by a self-fulfilling prediction.
"""

from __future__ import annotations

import argparse
import heapq
import json
from collections import defaultdict
from pathlib import Path

import cv2
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from dinov3_features import GRID, CELLS, PATCH, embed, load_dataset


ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent
SEED_COORDS = tuple(range(1, GRID, 2))
K = len(SEED_COORDS) ** 2
CHANGE_CAP = 0.30
SCORE_KEEP = 0.75
MODES = ("fixed", "grown_hard", "grown_soft", "grown_soft_evolving")


def feature_edges(tokens: np.ndarray, grid: int) -> np.ndarray:
    """Cosine-distance discontinuity between adjacent DINO patch features."""
    field = tokens.reshape(grid, grid, -1)
    horizontal = 1.0 - np.sum(field[:, :-1] * field[:, 1:], axis=-1)
    vertical = 1.0 - np.sum(field[:-1] * field[1:], axis=-1)
    score = np.zeros((grid, grid), np.float32)
    score[:, :-1] = np.maximum(score[:, :-1], horizontal)
    score[:, 1:] = np.maximum(score[:, 1:], horizontal)
    score[:-1] = np.maximum(score[:-1], vertical)
    score[1:] = np.maximum(score[1:], vertical)
    return score


def unit(values):
    return values / np.maximum(np.linalg.norm(values, axis=-1, keepdims=True), 1e-8)


def groups_of(records):
    groups = defaultdict(dict)
    for index, row in enumerate(records):
        groups[(row["split"], row["session"], row["level"],
                row["present"])][row["slot"]] = index
    return groups


def target_index(candidates, records):
    return next(i for i in candidates.values() if records[i]["target"])


def seed_positions(reference, strategy="edge"):
    """Select spatially distributed cores by grid, edge, or local feature medoid."""
    if strategy not in ("grid", "edge", "medoid"):
        raise ValueError(f"Unknown seed strategy: {strategy}")
    edge = (feature_edges(reference.reshape(CELLS, -1), GRID)
            if strategy == "edge" else None)
    feature = unit(reference.reshape(GRID, GRID, -1).astype(np.float32))
    seeds = []
    for sy in SEED_COORDS:
        for sx in SEED_COORDS:
            if strategy == "grid":
                y, x = sy, sx
            else:
                candidates = [(y, x)
                              for y in range(max(0, sy - 1), min(GRID, sy + 2))
                              for x in range(max(0, sx - 1), min(GRID, sx + 2))
                              if (y, x) not in seeds]
                if strategy == "edge":
                    y, x = min(candidates, key=lambda point:
                               (float(edge[point]), (point[0] - sy) ** 2 +
                                (point[1] - sx) ** 2, point))
                else:
                    # Choose the patch most representative of the local DINO
                    # feature cloud. No boundary/gradient value enters this rule.
                    neighborhood = []
                    weights = []
                    for ny in range(max(0, sy - 2), min(GRID, sy + 3)):
                        for nx in range(max(0, sx - 2), min(GRID, sx + 3)):
                            neighborhood.append(feature[ny, nx])
                            weights.append(np.exp(-((ny - sy) ** 2 +
                                                    (nx - sx) ** 2) / 4.0))
                    prototype = unit(np.average(np.stack(neighborhood), axis=0,
                                                weights=weights))
                    y, x = max(candidates, key=lambda point:
                               (float(feature[point] @ prototype) -
                                0.002 * ((point[0] - sy) ** 2 +
                                         (point[1] - sx) ** 2),
                                -((point[0] - sy) ** 2 +
                                  (point[1] - sx) ** 2), point))
            seeds.append((y, x))
    assert len(seeds) == K and len(set(seeds)) == K
    return seeds, edge


def grown_membership(reference, seeds):
    """Soft connected memberships: geodesic boundary cost + core similarity."""
    feature = unit(reference.reshape(CELLS, -1).astype(np.float32))
    neighbor_d = []
    for y in range(GRID):
        for x in range(GRID):
            i = y * GRID + x
            if x + 1 < GRID:
                neighbor_d.append(max(0.0, 1 - float(feature[i] @ feature[i + 1])))
            if y + 1 < GRID:
                neighbor_d.append(max(0.0, 1 - float(feature[i] @ feature[i + GRID])))
    edge_cutoff = float(np.quantile(neighbor_d, 0.75))
    raw = np.zeros((K, CELLS), np.float32)
    for rank, (sy, sx) in enumerate(seeds):
        start = sy * GRID + sx
        distance = np.full(CELLS, np.inf, np.float32)
        distance[start] = 0
        frontier = [(0.0, start)]
        while frontier:
            cost, i = heapq.heappop(frontier)
            if cost > float(distance[i]) + 1e-6 or cost > 1.4:
                continue
            y, x = divmod(i, GRID)
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if not (0 <= ny < GRID and 0 <= nx < GRID):
                    continue
                if (ny - sy) ** 2 + (nx - sx) ** 2 > 4 ** 2:
                    continue
                j = ny * GRID + nx
                difference = max(0.0, 1 - float(feature[i] @ feature[j]))
                barrier = 0.20 if difference > edge_cutoff else 0.0
                next_cost = cost + 0.025 + 1.6 * difference + barrier
                if next_cost < distance[j] and next_cost <= 0.9:
                    distance[j] = next_cost
                    heapq.heappush(frontier, (next_cost, j))
        core_difference = np.maximum(0.0, 1 - feature @ feature[start])
        membership = np.exp(-distance / 0.35 - core_difference / 0.20)
        membership[~np.isfinite(membership)] = 0
        membership[membership < 0.045] = 0
        raw[rank] = membership
    return raw


def normalize_masks(raw):
    return raw / np.maximum(raw.sum(axis=1, keepdims=True), 1e-8)


def make_masks(reference, strategy="edge"):
    seeds, edge = seed_positions(reference, strategy)
    raw = grown_membership(reference, seeds)
    yy, xx = np.mgrid[:GRID, :GRID]
    fixed = []
    for sy, sx in seeds:
        radius2 = (yy - sy) ** 2 + (xx - sx) ** 2
        fixed.append(np.exp(-radius2 / (2 * 1.25 ** 2)).reshape(-1))
    fixed = np.asarray(fixed, np.float32)
    fixed[fixed < 0.045] = 0
    fixed = normalize_masks(fixed)
    owner = np.argmax(raw, axis=0)
    hard = normalize_masks((owner[None, :] == np.arange(K)[:, None]).astype(np.float32))
    soft = normalize_masks(raw)
    return {"fixed": fixed, "grown_hard": hard, "grown_soft": soft,
            "grown_soft_evolving": soft.copy()}, raw, seeds, edge


def feature_map(feature):
    return unit(feature.reshape(CELLS, -1).astype(np.float32))


def rank_score(cosine):
    keep = int(round(CELLS * SCORE_KEEP))
    return float(np.sort(cosine)[-keep:].mean())


def paired_score(candidate, anchor, current, anchor_mask, current_mask):
    """Use an identical patch-level readout; only update zones differ by mode."""
    old_cosine = np.sum(candidate * anchor, axis=-1)
    new_cosine = np.sum(candidate * current, axis=-1)
    return rank_score(np.maximum(old_cosine, new_cosine))


def screen_scores(candidates, patches, mask, anchor, current):
    scores = {}
    for slot, index in candidates.items():
        scores[slot] = paired_score(feature_map(patches[index]), anchor,
                                    current, mask, mask)
    return scores


def select_update(delta, threshold):
    eligible = np.flatnonzero(delta > threshold)
    cap = max(1, int(round(K * CHANGE_CAP)))
    if len(eligible) > cap:
        eligible = eligible[np.argsort(delta[eligible])[-cap:]]
    selected = np.zeros(K, bool)
    selected[eligible] = True
    return selected


def validation_thresholds(records, patches, groups, strategy="edge"):
    sessions = sorted({r["session"] for r in records if r["split"] == "val"})
    normal_delta = {mode: [] for mode in MODES}
    for session in sessions:
        first = groups[("val", session, 2, True)]
        reference = patches[target_index(first, records)]
        masks, _, _, _ = make_masks(reference, strategy)
        for mode in MODES:
            old = feature_map(reference)
            for level in (5, 8, 10):
                current = patches[target_index(
                    groups[("val", session, level, True)], records)]
                patch_similarity = np.sum(old * feature_map(current), axis=-1)
                normal_delta[mode].extend((1 - masks[mode] @ patch_similarity).tolist())
    return {mode: float(np.quantile(values, 0.90))
            for mode, values in normal_delta.items()}


def tune_presence_cutoffs(records, patches, groups, strategy="edge"):
    """Calibrate no-target rejection by balanced accuracy on validation only."""
    sessions = sorted({r["session"] for r in records if r["split"] == "val"})
    observations = {mode: [] for mode in MODES}
    for session in sessions:
        first = groups[("val", session, 2, True)]
        reference = patches[target_index(first, records)]
        masks, _, _, _ = make_masks(reference, strategy)
        for mode in MODES:
            anchor = feature_map(reference)
            for level in (5, 8, 10):
                candidates = groups[("val", session, level, True)]
                values = screen_scores(candidates, patches, masks[mode], anchor, anchor)
                observations[mode].append((True, max(values.values())))
            absent = groups[("val", session, 10, False)]
            values = screen_scores(absent, patches, masks[mode], anchor, anchor)
            observations[mode].append((False, max(values.values())))
    cutoffs = {}
    for mode, values in observations.items():
        scores = sorted({x for _, x in values})
        candidates = [scores[0] - 1e-6] + [(a + b) / 2
                                           for a, b in zip(scores, scores[1:])] + [scores[-1] + 1e-6]
        ranked = []
        for cutoff in candidates:
            tp = sum(present and score >= cutoff for present, score in values)
            fp = sum(not present and score >= cutoff for present, score in values)
            fn = sum(present and score < cutoff for present, score in values)
            tn = sum(not present and score < cutoff for present, score in values)
            tpr = tp / max(tp + fn, 1)
            tnr = tn / max(tn + fp, 1)
            balanced_accuracy = (tpr + tnr) / 2
            ranked.append((balanced_accuracy, -fp, tp, cutoff))
        cutoffs[mode] = float(max(ranked)[-1])
    return cutoffs


def evaluate(records, patches, groups, change_threshold, presence_cutoff,
             strategy="edge"):
    sessions = sorted({r["session"] for r in records if r["split"] == "test"})
    result = {mode: {"top1_by_level": defaultdict(int),
                     "frozen_top1_by_level": defaultdict(int),
                     "post_update_top1_by_level": defaultdict(int),
                     "accepted_correct_by_level": defaultdict(int),
                     "absent_fp": 0, "old_level10_top1": 0, "updates_by_level": defaultdict(list),
                     "volatile_regions_by_level": defaultdict(list),
                     "repeat_updates_by_level": defaultdict(list),
                     "attempts": []} for mode in MODES}
    preview = None
    for session in sessions:
        candidates10 = groups[("test", session, 10, True)]
        old_index = target_index(candidates10, records)
        reference = patches[old_index]
        masks, raw, seeds, edge = make_masks(reference, strategy)
        if preview is None:
            preview = {"reference_index": old_index, "seeds": seeds,
                       "edge": edge, "raw": raw, "masks": masks,
                       "session": session}
        for mode in MODES:
            current_mask = masks[mode].copy()
            anchor_mask = masks[mode].copy()
            anchor = feature_map(reference)
            current = anchor.copy()
            volatility = np.zeros(K, np.float32)
            previous_selected = np.zeros(K, bool)
            for level in (11, 12, 16, 20):
                candidates = groups[("test", session, level, True)]
                truth_slot = next(slot for slot, index in candidates.items()
                                  if records[index]["target"])
                scored = {}
                for slot, index in candidates.items():
                    scored[slot] = paired_score(feature_map(patches[index]),
                                                anchor, current, anchor_mask,
                                                current_mask)
                ranked = sorted(scored, key=lambda slot: scored[slot], reverse=True)
                top = ranked[0]
                frozen_scored = {
                    slot: rank_score(np.sum(feature_map(patches[index]) * anchor, axis=-1))
                    for slot, index in candidates.items()
                }
                if max(frozen_scored, key=frozen_scored.get) == truth_slot:
                    result[mode]["frozen_top1_by_level"][str(level)] += 1
                if top == truth_slot:
                    result[mode]["top1_by_level"][str(level)] += 1
                # The synthetic game rejects wrong clicks; try remaining
                # candidates until it confirms the true target, then learn.
                result[mode]["attempts"].append(ranked.index(truth_slot) + 1)
                if top == truth_slot and scored[top] >= presence_cutoff[mode]:
                    result[mode]["accepted_correct_by_level"][str(level)] += 1
                correct_index = candidates[truth_slot]
                new_vector = feature_map(patches[correct_index])
                patch_similarity = np.sum(current * new_vector, axis=-1)
                delta = np.maximum(0, 1 - current_mask @ patch_similarity)
                volatility = 0.7 * volatility + 0.3 * delta
                selected = select_update(delta, change_threshold[mode])
                result[mode]["updates_by_level"][str(level)].append(int(selected.sum()))
                result[mode]["volatile_regions_by_level"][str(level)].append(
                    int((volatility > change_threshold[mode] * 0.5).sum()))
                result[mode]["repeat_updates_by_level"][str(level)].append(
                    int((selected & previous_selected).sum()))
                previous_selected = selected.copy()
                if mode == "grown_soft_evolving" and level == 11:
                    grown_now = grown_membership(patches[correct_index], seeds)
                    refreshed = normalize_masks(0.8 * raw + 0.2 * grown_now)
                    current_mask[selected] = refreshed[selected]
                selected_strength = (current_mask[selected].max(axis=0)
                                     if selected.any() else np.zeros(CELLS))
                strongest_strength = current_mask.max(axis=0)
                blend = 0.95 * np.clip(selected_strength /
                                       np.maximum(strongest_strength, 1e-8), 0, 1)
                current = unit((1 - blend[:, None]) * current +
                               blend[:, None] * new_vector)
                post_scores = {
                    slot: paired_score(feature_map(patches[index]), anchor, current,
                                       anchor_mask, current_mask)
                    for slot, index in candidates.items()
                }
                if max(post_scores, key=post_scores.get) == truth_slot:
                    result[mode]["post_update_top1_by_level"][str(level)] += 1
                if preview is not None and preview["session"] == session and level == 11:
                    preview.setdefault("level11_index", correct_index)
                    preview.setdefault("changed", {})[mode] = selected.copy()
                    preview.setdefault("delta", {})[mode] = delta.copy()
                    preview.setdefault("volatility", {})[mode] = volatility.copy()
            old_scores = {}
            for slot, index in candidates10.items():
                old_scores[slot] = paired_score(feature_map(patches[index]),
                                                anchor, current, anchor_mask,
                                                current_mask)
            old_truth = next(slot for slot, index in candidates10.items()
                             if records[index]["target"])
            if max(old_scores, key=old_scores.get) == old_truth:
                result[mode]["old_level10_top1"] += 1
            absent = groups[("test", session, 20, False)]
            absent_scores = [paired_score(feature_map(patches[index]),
                                          anchor, current, anchor_mask,
                                          current_mask)
                             for index in absent.values()]
            if max(absent_scores) >= presence_cutoff[mode]:
                result[mode]["absent_fp"] += 1
    serial = {}
    for mode, row in result.items():
        serial[mode] = {
            "top1_by_level_out_of_8": dict(row["top1_by_level"]),
            "frozen_top1_by_level_out_of_8": dict(row["frozen_top1_by_level"]),
            "post_update_top1_by_level_out_of_8": dict(row["post_update_top1_by_level"]),
            "future_top1_out_of_24": sum(row["top1_by_level"][str(level)]
                                          for level in (12, 16, 20)),
            "accepted_correct_by_level_out_of_8": dict(row["accepted_correct_by_level"]),
            "absent_false_positives_out_of_8": row["absent_fp"],
            "old_level10_top1_out_of_8": row["old_level10_top1"],
            "mean_click_attempts": round(float(np.mean(row["attempts"])), 3),
            "updates_by_level": dict(row["updates_by_level"]),
            "volatile_regions_by_level": dict(row["volatile_regions_by_level"]),
            "repeat_updates_by_level": dict(row["repeat_updates_by_level"]),
        }
    return serial, preview


def save_preview(crops, preview, output):
    old = np.asarray(crops[preview["reference_index"]])
    new = np.asarray(crops[preview["level11_index"]])
    edge = preview["edge"]
    raw = preview["raw"].reshape(K, GRID, GRID)
    seeds = preview["seeds"]
    central = min(range(K), key=lambda k: (seeds[k][0] - 14) ** 2 +
                  (seeds[k][1] - 14) ** 2)
    figure, axes = plt.subplots(2, 3, figsize=(9.3, 6.4), constrained_layout=True)
    axes[0, 0].imshow(old)
    axes[0, 0].set_title("Level 10")
    axes[0, 1].imshow(new)
    axes[0, 1].set_title("Level 11")
    axes[0, 2].imshow(old)
    if edge is not None:
        heat = cv2.resize(edge, (448, 448), interpolation=cv2.INTER_NEAREST)
        axes[0, 2].imshow(heat, cmap="magma", alpha=0.6)
        axes[0, 2].set_title("DINO feature boundary")
    else:
        axes[0, 2].set_title("No boundary used for seeds")
    axes[1, 0].imshow(old)
    membership = cv2.resize(raw[central], (448, 448), interpolation=cv2.INTER_NEAREST)
    axes[1, 0].imshow(membership, cmap="spring", alpha=np.clip(membership * 0.8, 0, 0.8))
    axes[1, 0].set_title("Core-grown soft membership")
    axes[1, 1].imshow(new)
    selected = preview["changed"]["grown_soft"]
    union = raw[selected].max(axis=0) if selected.any() else np.zeros((GRID, GRID))
    union = cv2.resize(union.astype(np.float32), (448, 448), interpolation=cv2.INTER_NEAREST)
    axes[1, 1].imshow(union, cmap="autumn", alpha=np.clip(union * 0.75, 0, 0.75))
    axes[1, 1].set_title(f"Updated regions: {selected.sum()}/{K}")
    axes[1, 2].imshow(new)
    hard = preview["masks"]["grown_hard"][central].reshape(GRID, GRID)
    hard = (hard > 0).astype(np.float32)
    hard = cv2.resize(hard, (448, 448), interpolation=cv2.INTER_NEAREST)
    axes[1, 2].imshow(hard, cmap="spring", alpha=hard * 0.7)
    axes[1, 2].set_title("Hard assignment, same core")
    for ax in axes.flat:
        ax.set_xticks([])
        ax.set_yticks([])
    figure.savefig(output, dpi=160)
    plt.close(figure)


def save_overlap_preview(crops, preview, output):
    old = np.asarray(crops[preview["reference_index"]])
    raw = preview["raw"].reshape(K, GRID, GRID)
    seeds = preview["seeds"]
    first = min(range(K), key=lambda k: (seeds[k][0] - 14) ** 2 +
                (seeds[k][1] - 14) ** 2)
    second = min((k for k in range(K) if k != first),
                 key=lambda k: (seeds[k][0] - seeds[first][0]) ** 2 +
                 (seeds[k][1] - seeds[first][1]) ** 2)
    a = cv2.resize(raw[first], (448, 448), interpolation=cv2.INTER_NEAREST)
    b = cv2.resize(raw[second], (448, 448), interpolation=cv2.INTER_NEAREST)
    overlap = np.minimum(a, b)
    crop = np.s_[145:320, 145:320]
    fig, axes = plt.subplots(1, 3, figsize=(9, 3.3), constrained_layout=True)
    for ax, strength, title, color in zip(
            axes, (a, b, overlap),
            ("Region A", "Region B", "Shared / overlapping area"),
            ("Reds", "Blues", "plasma")):
        ax.imshow(old[crop])
        ax.imshow(strength[crop], cmap=color,
                  alpha=np.clip(strength[crop] * 0.9, 0, 0.85), vmin=0, vmax=1)
        ax.set_title(title)
        ax.set_xticks([])
        ax.set_yticks([])
    fig.savefig(output, dpi=170)
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path,
                        default=PROJECT / "data" / "upgrade-confirmation-dataset.json")
    parser.add_argument("--out", type=Path, default=PROJECT / "results" / "generated" / "adaptive-soft-regions-dev")
    parser.add_argument("--seed-strategy", choices=("grid", "edge", "medoid"),
                        default="edge")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    crops, records = load_dataset(args.dataset)
    print(f"Loaded {len(crops)} crops", flush=True)
    patches = embed(crops)[3].astype(np.float32)
    groups = groups_of(records)
    thresholds = validation_thresholds(records, patches, groups, args.seed_strategy)
    cutoffs = tune_presence_cutoffs(records, patches, groups, args.seed_strategy)
    print("Validation thresholds", thresholds, "presence", cutoffs, flush=True)
    result, preview = evaluate(records, patches, groups, thresholds, cutoffs,
                               args.seed_strategy)
    save_preview(crops, preview, args.out / "soft-boundary-regions.png")
    save_overlap_preview(crops, preview, args.out / "overlap-example.png")
    report = {
        "protocol": {"dataset": str(args.dataset),
                     "seed_strategy": args.seed_strategy,
                     "model": "DINOv3 ViT-S/16, frozen, layer 3; 448 input, 28x28 patch map",
                     "boundary": "existing raw feature-neighbor cosine edge method, not PCA display colors",
                     "core": "14x14 regular sites snapped to local weak-edge interiors",
                     "region": "Dijkstra connected growth; feature distance to core and path edge cost produce overlapping soft membership; DINO patch-level memory and matching are retained rather than pooled into one feature per region",
                     "comparison": "196 seeds each: fixed Gaussian masks, hard assignment of grown masks, soft grown masks, soft grown masks refreshed at confirmed level 11",
                     "online": "known level-10 target; at each later level rank three candidate slots, game rejects wrong clicks until true slot confirmed; only then select regions beyond validation 90th-percentile normal change, capped at 30%, and blend aligned DINO patch memories according to overlapping membership; original anchor retained",
                     "presence": "validation-screen balanced-accuracy threshold; target-absent test screen evaluated",
                     "limitations": "same synthetic renderer; previously explored test sessions; fixed candidate slots and successful-click feedback; exploratory, not blind generalization"},
        "validation_change_threshold": thresholds,
        "validation_presence_cutoff": cutoffs,
        "results": result,
    }
    (args.out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2),
                                          encoding="utf-8")
    for mode, row in result.items():
        print(mode, "first11", row["top1_by_level_out_of_8"].get("11", 0),
              "future", row["future_top1_out_of_24"],
              "old", row["old_level10_top1_out_of_8"],
              "absent_fp", row["absent_false_positives_out_of_8"], flush=True)


if __name__ == "__main__":
    main()
