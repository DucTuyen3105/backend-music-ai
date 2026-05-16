# FastAPI model endpoint

FastAPI service này chỉ load checkpoint từ thư mục repo-root `best_model`.
Các file trong `music_genre_classification` chỉ được dùng để đóng gói lại logic
preprocess, kiến trúc model, label map, stats và format output.

## Run

```bash
pip install -r music_genre_classification/requirements.txt
python -m uvicorn music_genre_classification.model_api:app --host 127.0.0.1 --port 8001
```

Hoặc chạy qua npm:

```bash
npm run model:api
```

## Endpoint

`POST /predict`

```json
{
  "audio_path": "C:/absolute/path/to/clip.mp3"
}
```

Response:

```json
{
  "ok": true,
  "prediction": {
    "label": "Hip-Hop",
    "score": 91.23,
    "top_three": {
      "Hip-Hop": 91.23,
      "Pop": 5.41,
      "Electronic": 3.36
    }
  }
}
```
