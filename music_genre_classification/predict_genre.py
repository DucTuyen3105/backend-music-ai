from __future__ import annotations

import argparse
import json
import math
import os
import sys
import tempfile
import zipfile
from collections import OrderedDict
from pathlib import Path

import librosa
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchaudio.transforms as T


class MusicGenreCNNAttention(nn.Module):
    def __init__(self, num_classes: int = 8):
        super().__init__()
        # Augmentation
        self.freq_mask = T.FrequencyMasking(freq_mask_param=15)
        self.time_mask = T.TimeMasking(time_mask_param=30)

        # CNN feature extraction blocks
        self.conv1 = nn.Conv2d(1, 32, kernel_size=3, padding=1)
        self.bn1 = nn.BatchNorm2d(32)
        self.conv2 = nn.Conv2d(32, 64, kernel_size=3, padding=1)
        self.bn2 = nn.BatchNorm2d(64)
        self.conv3 = nn.Conv2d(64, 128, kernel_size=3, padding=1)
        self.bn3 = nn.BatchNorm2d(128)
        self.conv4 = nn.Conv2d(128, 256, kernel_size=3, padding=1)
        self.bn4 = nn.BatchNorm2d(256)

        self.pool = nn.MaxPool2d(2, 2)

        # --- POSITIONAL ENCODING INITIALIZATION ---
        d_model = 256
        max_len = 500
        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
        div_term = torch.exp(
            torch.arange(0, d_model, 2).float()
            * (-math.log(10000.0) / d_model)
        )
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        pe = pe.unsqueeze(0)  # Shape: (1, max_len, 256)
        # Register as buffer - PyTorch auto manages device (CPU/GPU)
        self.register_buffer("pe", pe)
        # ----------------------------------------

        # --- ATTENTION LAYERS ---
        self.attention = nn.MultiheadAttention(
            embed_dim=256, num_heads=4, batch_first=True
        )
        self.layer_norm = nn.LayerNorm(256)
        # ---------------------------

        self.classifier = nn.Sequential(
            nn.Linear(256, 128),
            nn.ReLU(),
            nn.Dropout(0.5),
            nn.Linear(128, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        if x.dim() == 3:
            x = x.unsqueeze(1)

        if self.training:
            x = self.freq_mask(x)
            x = self.time_mask(x)

        x = self.pool(F.relu(self.bn1(self.conv1(x))))
        x = self.pool(F.relu(self.bn2(self.conv2(x))))
        x = self.pool(F.relu(self.bn3(self.conv3(x))))
        x = self.pool(F.relu(self.bn4(self.conv4(x))))

        # --- ATTENTION PROCESSING ---
        # Current shape: (Batch, Channels=256, H, W)
        B, C, H, W = x.size()

        # 1. Average across frequency dimension (H), keep time dimension (W)
        # New shape: (Batch, Channels=256, Time=W)
        x_time = x.mean(dim=2)

        # 2. Permute to (Batch, Time, Channels) for attention
        # This gives us a sequence of W timesteps, each with 256-dim vector
        x_seq = x_time.permute(0, 2, 1)

        # 3. Add Positional Encoding directly from buffer
        # Only take matching length from pe buffer
        x_seq = x_seq + self.pe[:, : x_seq.size(1), :]

        # 4. Multi-head Attention
        attn_out, _ = self.attention(x_seq, x_seq, x_seq)
        x_seq = self.layer_norm(x_seq + attn_out)

        # 5. Global Average Pooling on time dimension (W)
        # (Batch, Time, Channels) -> (Batch, Channels)
        x = x_seq.mean(dim=1)
        # --- END ATTENTION PROCESSING ---

        # Pass directly to classifier
        return self.classifier(x)



class MusicGenreCNN(nn.Module):
    def __init__(self, num_classes: int = 8):
        super().__init__()
        self.freq_mask = nn.Identity()
        self.time_mask = nn.Identity()

        self.conv1 = nn.Conv2d(1, 32, kernel_size=3, padding=1)
        self.bn1 = nn.BatchNorm2d(32)
        self.conv2 = nn.Conv2d(32, 64, kernel_size=3, padding=1)
        self.bn2 = nn.BatchNorm2d(64)
        self.conv3 = nn.Conv2d(64, 128, kernel_size=3, padding=1)
        self.bn3 = nn.BatchNorm2d(128)
        self.conv4 = nn.Conv2d(128, 256, kernel_size=3, padding=1)
        self.bn4 = nn.BatchNorm2d(256)

        self.pool = nn.MaxPool2d(2, 2)
        self.gap = nn.AdaptiveAvgPool2d(1)
        self.classifier = nn.Sequential(
            nn.Linear(256, 128),
            nn.ReLU(),
            nn.Dropout(0.5),
            nn.Linear(128, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        if x.dim() == 3:
            x = x.unsqueeze(1)

        if self.training:
            x = self.freq_mask(x)
            x = self.time_mask(x)

        x = self.pool(F.relu(self.bn1(self.conv1(x))))
        x = self.pool(F.relu(self.bn2(self.conv2(x))))
        x = self.pool(F.relu(self.bn3(self.conv3(x))))
        x = self.pool(F.relu(self.bn4(self.conv4(x))))
        x = self.gap(x)
        x = x.view(x.size(0), -1)
        return self.classifier(x)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--label-map", required=True)
    parser.add_argument("--stats", required=True)
    return parser.parse_args()


def newest_mtime(directory: Path) -> float:
    return max(path.stat().st_mtime for path in directory.rglob("*") if path.is_file())


def archive_names(directory: Path, include_root: bool) -> set[str]:
    names = set()
    for file_path in directory.rglob("*"):
        if not file_path.is_file():
            continue
        relative = file_path.relative_to(directory)
        if include_root:
            arcname = Path(directory.name) / relative
        else:
            arcname = relative
        names.add(str(arcname).replace(os.sep, "/"))
    return names


def archive_matches_source(
    directory: Path,
    archive_path: Path,
    include_root: bool,
) -> bool:
    if not zipfile.is_zipfile(archive_path):
        return False
    with zipfile.ZipFile(archive_path, "r") as zf:
        return set(zf.namelist()) == archive_names(directory, include_root)


def archive_checkpoint(directory: Path, include_root: bool) -> Path:
    cache_dir = Path(tempfile.gettempdir()) / "music-ai-model-cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    suffix = "root" if include_root else "flat"
    archive_path = cache_dir / f"{directory.name}-{suffix}.pth"
    source_mtime = newest_mtime(directory)

    if archive_path.exists():
        archive_path.unlink()

    with zipfile.ZipFile(
        archive_path,
        "w",
        compression=zipfile.ZIP_STORED,
        strict_timestamps=False,
    ) as zf:
        for file_path in directory.rglob("*"):
            if not file_path.is_file():
                continue
            relative = file_path.relative_to(directory)
            if include_root:
                arcname = Path(directory.name) / relative
            else:
                arcname = relative
            zf.write(file_path, str(arcname).replace(os.sep, "/"))

    os.utime(archive_path, (source_mtime, source_mtime))
    return archive_path


def checkpoint_candidates(model_path: str):
    path = Path(model_path)
    if path.is_file():
        yield path
        return
    if not path.is_dir():
        raise FileNotFoundError(f"Model path not found: {model_path}")
    
    # Try best_model_an_attention.pth first (highest priority)
    an_model = path / "best_model_an_attention.pth"
    if an_model.is_file():
        yield an_model
    
    # Try best_model_attention_v2.pth second
    v2_model = path / "best_model_attention_v2.pth"
    if v2_model.is_file():
        yield v2_model
    
    # Try best_model_lam.pth third
    lam_model = path / "best_model_lam.pth"
    if lam_model.is_file():
        yield lam_model
    
    # Fallback to archive approach
    yield archive_checkpoint(path, include_root=True)


def torch_load(path: Path, device: torch.device):
    try:
        return torch.load(path, map_location=device, weights_only=False)
    except TypeError:
        return torch.load(path, map_location=device)


def normalize_state_dict(checkpoint) -> OrderedDict:
    if isinstance(checkpoint, nn.Module):
        return checkpoint.state_dict()

    if isinstance(checkpoint, dict):
        for key in ("state_dict", "model_state_dict", "model"):
            value = checkpoint.get(key)
            if isinstance(value, dict):
                checkpoint = value
                break

    if not isinstance(checkpoint, dict):
        raise TypeError("Unsupported checkpoint format")

    normalized = OrderedDict()
    for key, value in checkpoint.items():
        clean_key = key[7:] if key.startswith("module.") else key
        normalized[clean_key] = value
    return normalized


def load_model(model_path: str, num_classes: int, device: torch.device) -> nn.Module:
    errors: list[str] = []
    for candidate in checkpoint_candidates(model_path):
        try:
            checkpoint = torch_load(candidate, device)
            state_dict = normalize_state_dict(checkpoint)
            has_attention = any(
                key.startswith("attention.") or key.startswith("layer_norm.")
                for key in state_dict
            )
            model_class = MusicGenreCNNAttention if has_attention else MusicGenreCNN
            model = model_class(num_classes=num_classes).to(device)
            model.load_state_dict(state_dict)
            model.eval()
            return model
        except Exception as exc:
            errors.append(f"{candidate}: {exc}")

    raise RuntimeError(f"Could not load model checkpoint: {' | '.join(errors)}")


def load_json(path: str):
    with open(path, "r", encoding="utf-8") as file:
        return json.load(file)


def predict_30s(
    audio_path: str,
    model: nn.Module,
    inv_label_map: dict[int, str],
    means: np.ndarray,
    stds: np.ndarray,
    device: torch.device,
    offset: float = 0.0,
) -> list[tuple[str, float]]:
    """
    Predict music genre from a 30-second audio clip.
    
    Args:
        audio_path: Path to audio file
        model: Loaded model
        inv_label_map: Mapping from index to genre name
        means: Normalization means
        stds: Normalization stds
        device: Torch device (cpu/cuda)
        offset: Start time in seconds (default: 0)
    
    Returns:
        List of (genre_name, probability%) tuples - Top 3 results
    """
    # Load 30 seconds of audio starting from offset
    y_full, sr = librosa.load(
        audio_path, sr=22050, offset=offset, duration=30.0
    )
    if y_full.size == 0:
        raise ValueError("Audio clip contains no decodable samples")

    # Chia 30s thành 4 đoạn 7.5s mỗi cái (4 * 7.5 = 30s)
    segment_duration = 7.5  # Changed from 7.0 to 7.5
    samples_per_segment = int(segment_duration * sr)
    
    # Pad audio nếu không đủ 30 giây
    min_samples_needed = samples_per_segment * 4
    if len(y_full) < min_samples_needed:
        y_full = np.pad(y_full, (0, min_samples_needed - len(y_full)))
    
    outputs = []

    for index in range(4):
        start = index * samples_per_segment
        end = start + samples_per_segment
        y_segment = y_full[start:end]
        
        # Ensure segment has correct length
        if len(y_segment) < samples_per_segment:
            y_segment = np.pad(
                y_segment,
                (0, samples_per_segment - len(y_segment)),
            )

        # Compute mel-spectrogram
        mel = librosa.feature.melspectrogram(
            y=y_segment,
            sr=sr,
            n_mels=128,
            n_fft=2048,
            hop_length=512,
        )
        mel_db = librosa.power_to_db(mel, ref=np.max)

        # Normalize to 300 frames
        if mel_db.shape[1] > 300:
            mel_db = mel_db[:, :300]
        else:
            mel_db = np.pad(mel_db, ((0, 0), (0, 300 - mel_db.shape[1])))

        # Normalize using statistics
        mel_norm = (mel_db - means) / stds
        input_tensor = (
            torch.tensor(mel_norm).float().unsqueeze(0).unsqueeze(0).to(device)
        )

        # Run inference
        with torch.no_grad():
            output = model(input_tensor)
            outputs.append(torch.nn.functional.softmax(output, dim=1))

    # Average predictions across all 4 segments
    final_probs = torch.mean(torch.stack(outputs), dim=0)
    top_probs, top_indices = torch.topk(final_probs, k=3, dim=1)

    # Format results
    results = []
    for index in range(3):
        genre = inv_label_map[int(top_indices[0][index].item())]
        probability = float(top_probs[0][index].item() * 100)
        results.append((genre, probability))
    return results


def main() -> int:
    args = parse_args()
    label_map = load_json(args.label_map)
    stats = load_json(args.stats)
    inv_label_map = {int(value): key for key, value in label_map.items()}
    means = np.array(stats["mean"]).reshape(128, 1)
    stds = np.array(stats["std"]).reshape(128, 1)
    stds = np.where(stds == 0, 1e-8, stds)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = load_model(args.model, num_classes=len(label_map), device=device)
    top_results = predict_30s(args.audio, model, inv_label_map, means, stds, device)
    top_three = {genre: round(score, 2) for genre, score in top_results}
    label, score = top_results[0]

    print(
        json.dumps(
            {
                "ok": True,
                "prediction": {
                    "label": label,
                    "score": round(score, 2),
                    "top_three": top_three,
                },
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        raise SystemExit(1)
