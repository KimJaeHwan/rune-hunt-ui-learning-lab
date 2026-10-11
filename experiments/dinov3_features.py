"""Load browser screenshots and frozen DINOv3 ViT-S/16 patch embeddings.

Download gated model weights yourself; they are intentionally not distributed
with this research repository. Set DINOV3_MODEL_DIR or use models/dinov3-vits16.
"""

from __future__ import annotations

import base64
import io
import json
import os
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from transformers import AutoImageProcessor, AutoModel


SIDE = 448
PATCH = 16
GRID = SIDE // PATCH
CELLS = GRID * GRID


def load_dataset(path: Path):
    payload = json.loads(path.read_text(encoding="utf-8"))
    crops, records = [], []
    for sample in payload["samples"]:
        if sample["split"] not in ("val", "test"):
            continue
        image = Image.open(io.BytesIO(base64.b64decode(
            sample["image"].split(",", 1)[1]))).convert("RGB")
        labels = {p["slot"]: p["id"] == "trait-upgrade" for p in sample["panels"]}
        for proposal in payload["proposals"]:
            x, y, w, h = proposal["bbox"]
            native = image.crop((x, y, x + w, y + h))
            side = max(w, h)
            square = Image.new("RGB", (side, side), (16, 30, 44))
            square.paste(native, ((side - w) // 2, (side - h) // 2))
            crops.append(square.resize((SIDE, SIDE), Image.Resampling.BICUBIC))
            records.append({"split": sample["split"], "session": sample["session"],
                            "level": sample["level"], "present": sample["target_present"],
                            "slot": proposal["slot"], "target": labels[proposal["slot"]]})
    return crops, records


def embed(crops):
    model_dir = Path(os.environ.get(
        "DINOV3_MODEL_DIR", Path(__file__).resolve().parent.parent / "models" / "dinov3-vits16"))
    if not model_dir.is_dir():
        raise FileNotFoundError(
            f"DINOv3 model not found: {model_dir}. Set DINOV3_MODEL_DIR to your local model directory.")
    torch.set_num_threads(4)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    processor = AutoImageProcessor.from_pretrained(str(model_dir), local_files_only=True)
    model = AutoModel.from_pretrained(str(model_dir), local_files_only=True).eval().to(device)
    registers = int(getattr(model.config, "num_register_tokens", 0))
    chunks = []
    for start in range(0, len(crops), 2):
        batch = processor(images=crops[start:start + 2], return_tensors="pt",
                          do_resize=False, do_center_crop=False)
        with torch.inference_mode():
            result = model(**{k: v.to(device) for k, v in batch.items()},
                           output_hidden_states=True)
            patch = result.hidden_states[3][:, 1 + registers:].float()
            if patch.shape[1] != CELLS:
                raise ValueError(f"Expected {GRID}x{GRID} map, got {patch.shape}")
            chunks.append(F.normalize(patch, dim=-1).cpu().numpy().reshape(
                -1, GRID, GRID, patch.shape[-1]).astype(np.float16))
        if (start + 2) % 40 == 0:
            print(f"DINOv3: {start + 2}/{len(crops)}", flush=True)
    return {3: np.concatenate(chunks)}
