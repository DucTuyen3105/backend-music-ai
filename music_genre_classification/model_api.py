from __future__ import annotations

import os
from pathlib import Path
from threading import Lock

import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .predict_genre import load_json, load_model, predict_30s


BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_MODEL_PATH = BASE_DIR / "best_model"
DEFAULT_LABEL_MAP_PATH = (
    BASE_DIR / "music_genre_classification" / "data_pipeline" / "data" / "label_map.json"
)
DEFAULT_STATS_PATH = (
    BASE_DIR / "music_genre_classification" / "data_pipeline" / "data" / "stats.json"
)
ALLOWED_AUDIO_EXTENSIONS = {
    ".mp3",
    ".wav",
    ".flac",
    ".m4a",
    ".aac",
    ".ogg",
    ".oga",
    ".webm",
}


class PredictRequest(BaseModel):
    audio_path: str = Field(..., min_length=1)


class PredictResponse(BaseModel):
    ok: bool
    prediction: dict


class ModelRuntime:
    def __init__(self) -> None:
        self._lock = Lock()
        self._loaded = False
        self.device: torch.device | None = None
        self.model = None
        self.inv_label_map: dict[int, str] = {}
        self.means: np.ndarray | None = None
        self.stds: np.ndarray | None = None

    def load(self) -> None:
        with self._lock:
            if self._loaded:
                return

            label_map_path = os.getenv("LABEL_MAP_PATH", str(DEFAULT_LABEL_MAP_PATH))
            stats_path = os.getenv("STATS_PATH", str(DEFAULT_STATS_PATH))

            label_map = load_json(label_map_path)
            stats = load_json(stats_path)
            self.inv_label_map = {int(value): key for key, value in label_map.items()}
            self.means = np.array(stats["mean"]).reshape(128, 1)
            stds = np.array(stats["std"]).reshape(128, 1)
            self.stds = np.where(stds == 0, 1e-8, stds)
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            self.model = load_model(
                str(DEFAULT_MODEL_PATH),
                num_classes=len(label_map),
                device=self.device,
            )
            self._loaded = True

    @property
    def loaded(self) -> bool:
        return self._loaded

    def predict(self, audio_path: str) -> dict:
        self.load()
        if self.model is None or self.device is None:
            raise RuntimeError("Model is not loaded")
        if self.means is None or self.stds is None:
            raise RuntimeError("Model statistics are not loaded")

        top_results = predict_30s(
            audio_path,
            self.model,
            self.inv_label_map,
            self.means,
            self.stds,
            self.device,
        )
        label, score = top_results[0]
        return {
            "label": label,
            "score": round(score, 2),
            "top_three": {
                genre: round(probability, 2)
                for genre, probability in top_results
            },
        }


runtime = ModelRuntime()
app = FastAPI(title="Music Genre Model API", version="1.0.0")


@app.on_event("startup")
def preload_model() -> None:
    if os.getenv("MODEL_PRELOAD", "true").lower() == "true":
        runtime.load()


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "loaded": runtime.loaded,
        "device": str(runtime.device) if runtime.device else None,
        "model_path": str(DEFAULT_MODEL_PATH),
    }


@app.post("/predict", response_model=PredictResponse)
def predict(request: PredictRequest) -> PredictResponse:
    audio_path = Path(request.audio_path).resolve()
    if not audio_path.exists() or not audio_path.is_file():
        raise HTTPException(status_code=404, detail="Audio file not found")
    if audio_path.suffix.lower() not in ALLOWED_AUDIO_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported audio file extension")

    try:
        prediction = runtime.predict(str(audio_path))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return PredictResponse(ok=True, prediction=prediction)
