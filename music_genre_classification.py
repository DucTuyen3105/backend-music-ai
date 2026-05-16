import os
import json
import zipfile
import tempfile
import librosa
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from pathlib import Path
from collections import OrderedDict

# Define the models
class MusicGenreCNNAttention(nn.Module):
    def __init__(self, num_classes=8):
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
        
        self.attention = nn.MultiheadAttention(embed_dim=256, num_heads=4, batch_first=True)
        self.layer_norm = nn.LayerNorm(256)
        
        self.gap = nn.AdaptiveAvgPool2d(1)
        
        self.classifier = nn.Sequential(
            nn.Linear(256, 128),
            nn.ReLU(),
            nn.Dropout(0.5),
            nn.Linear(128, num_classes)
        )

    def forward(self, x):
        if x.dim() == 3: x = x.unsqueeze(1)
        
        x = self.pool(F.relu(self.bn1(self.conv1(x))))
        x = self.pool(F.relu(self.bn2(self.conv2(x))))
        x = self.pool(F.relu(self.bn3(self.conv3(x))))
        x = self.pool(F.relu(self.bn4(self.conv4(x))))
        
        B, C, H, W = x.size()
        x_seq = x.view(B, C, H * W).permute(0, 2, 1)
        
        attn_out, _ = self.attention(x_seq, x_seq, x_seq)
        x_seq = self.layer_norm(x_seq + attn_out)
        
        x = x_seq.permute(0, 2, 1).view(B, C, H, W)
        
        x = self.gap(x)
        x = x.view(x.size(0), -1) 
        x = self.classifier(x)
        return x

class MusicGenreCNN(nn.Module):
    def __init__(self, num_classes=8):
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
            nn.Linear(128, num_classes)
        )

    def forward(self, x):
        if x.dim() == 3: x = x.unsqueeze(1)
        
        x = self.pool(F.relu(self.bn1(self.conv1(x))))
        x = self.pool(F.relu(self.bn2(self.conv2(x))))
        x = self.pool(F.relu(self.bn3(self.conv3(x))))
        x = self.pool(F.relu(self.bn4(self.conv4(x))))
        x = self.gap(x)
        x = x.view(x.size(0), -1)
        return self.classifier(x)

def archive_checkpoint(directory: Path, include_root: bool) -> Path:
    cache_dir = Path(tempfile.gettempdir()) / "music-ai-model-cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    suffix = "root" if include_root else "flat"
    archive_path = cache_dir / f"{directory.name}-{suffix}.pth"

    if archive_path.exists():
        archive_path.unlink()

    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_STORED, strict_timestamps=False) as zf:
        for file_path in directory.rglob("*"):
            if not file_path.is_file():
                continue
            relative = file_path.relative_to(directory)
            arcname = Path(directory.name) / relative if include_root else relative
            zf.write(file_path, str(arcname).replace(os.sep, "/"))

    return archive_path

def normalize_state_dict(checkpoint) -> OrderedDict:
    if isinstance(checkpoint, nn.Module):
        return checkpoint.state_dict()
    if isinstance(checkpoint, dict):
        for key in ("state_dict", "model_state_dict", "model"):
            if key in checkpoint and isinstance(checkpoint[key], dict):
                checkpoint = checkpoint[key]
                break
    normalized = OrderedDict()
    for key, value in checkpoint.items():
        clean_key = key[7:] if key.startswith("module.") else key
        normalized[clean_key] = value
    return normalized

def load_model(model_path: str, num_classes: int, device: torch.device) -> nn.Module:
    path = Path(model_path)
    if path.is_dir():
        model_file = archive_checkpoint(path, include_root=True)
    else:
        model_file = path

    try:
        checkpoint = torch.load(model_file, map_location=device, weights_only=False)
    except TypeError:
        checkpoint = torch.load(model_file, map_location=device)

    state_dict = normalize_state_dict(checkpoint)
    has_attention = any(key.startswith("attention.") or key.startswith("layer_norm.") for key in state_dict)
    
    model_class = MusicGenreCNNAttention if has_attention else MusicGenreCNN
    model = model_class(num_classes=num_classes).to(device)
    model.load_state_dict(state_dict)
    model.eval()
    return model

# Setup paths
BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "best_model"
LABEL_MAP_PATH = BASE_DIR / "best_model" / "label_map.json"
STATS_PATH = BASE_DIR / "best_model" / "stats.json"

# FastAPI setup
app = FastAPI(title="Music Genre Model API")

class PredictRequest(BaseModel):
    audio_path: str

class PredictResponse(BaseModel):
    ok: bool
    prediction: dict

# Global state
model = None
inv_label_map = {}
means = None
stds = None
device = None

@app.on_event("startup")
def startup_event():
    global model, inv_label_map, means, stds, device
    
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    
    with open(LABEL_MAP_PATH, 'r') as f:
        label_map = json.load(f)
    inv_label_map = {int(v): k for k, v in label_map.items()}
    
    with open(STATS_PATH, 'r') as f:
        stats = json.load(f)
    means = np.array(stats['mean']).reshape(128, 1)
    stds = np.array(stats['std']).reshape(128, 1)
    stds = np.where(stds == 0, 1e-8, stds)
    
    model = load_model(str(MODEL_PATH), num_classes=len(label_map), device=device)

@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "loaded": model is not None,
        "device": str(device) if device else None,
        "model_path": str(MODEL_PATH),
    }

@app.post("/predict", response_model=PredictResponse)
def predict(request: PredictRequest):
    audio_path = request.audio_path
    if not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail="Audio file not found")
        
    try:
        y_full, sr = librosa.load(audio_path, sr=22050, duration=30.0)
        if y_full.size == 0:
            raise ValueError("Audio clip contains no decodable samples")

        segment_duration = 7.0 
        samples_per_segment = int(segment_duration * sr)
        all_outputs = []

        for i in range(4):
            start = i * samples_per_segment
            y_seg = y_full[start : start + samples_per_segment]
            if len(y_seg) < samples_per_segment:
                y_seg = np.pad(y_seg, (0, samples_per_segment - len(y_seg)))

            mel = librosa.feature.melspectrogram(y=y_seg, sr=sr, n_mels=128, n_fft=2048, hop_length=512)
            mel_db = librosa.power_to_db(mel, ref=np.max)
            
            if mel_db.shape[1] > 300: 
                mel_db = mel_db[:, :300]
            else: 
                mel_db = np.pad(mel_db, ((0,0), (0, 300 - mel_db.shape[1])))

            mel_norm = (mel_db - means) / stds
            input_tensor = torch.tensor(mel_norm).float().unsqueeze(0).unsqueeze(0).to(device)

            with torch.no_grad():
                output = model(input_tensor)
                probs = torch.nn.functional.softmax(output, dim=1)
                all_outputs.append(probs)

        final_probs = torch.mean(torch.stack(all_outputs), dim=0)
        top_probs, top_indices = torch.topk(final_probs, k=3, dim=1)
        
        results = []
        for i in range(3):
            genre = inv_label_map[top_indices[0][i].item()]
            prob = float(top_probs[0][i].item() * 100)
            results.append((genre, prob))
            
        top_three = {genre: round(prob, 2) for genre, prob in results}
        label, score = results[0]
        
        return PredictResponse(
            ok=True, 
            prediction={
                "label": label,
                "score": round(score, 2),
                "top_three": top_three
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
