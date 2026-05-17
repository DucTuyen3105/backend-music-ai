import torch
import librosa
import numpy as np
import json
import os
import torch.nn as nn
import torch.nn.functional as F
import torchaudio.transforms as T

# Định nghĩa class (Giữ nguyên như cũ)
class MusicGenreCNNAttention(nn.Module):
    def __init__(self, num_classes=8):
        super(MusicGenreCNNAttention, self).__init__()
        # Augmentation
        self.freq_mask = T.FrequencyMasking(freq_mask_param=15)
        self.time_mask = T.TimeMasking(time_mask_param=30)
        
        # Khối trích xuất đặc trưng (CNN)
        self.conv1 = nn.Conv2d(1, 32, kernel_size=3, padding=1)
        self.bn1 = nn.BatchNorm2d(32)
        self.conv2 = nn.Conv2d(32, 64, kernel_size=3, padding=1)
        self.bn2 = nn.BatchNorm2d(64)
        self.conv3 = nn.Conv2d(64, 128, kernel_size=3, padding=1)
        self.bn3 = nn.BatchNorm2d(128)
        self.conv4 = nn.Conv2d(128, 256, kernel_size=3, padding=1)
        self.bn4 = nn.BatchNorm2d(256)
        
        self.pool = nn.MaxPool2d(2, 2)
        
        # --- KHỐI LỚP ATTENTION ---
        # embed_dim bằng số channel đầu ra của conv4 (256)
        self.attention = nn.MultiheadAttention(embed_dim=256, num_heads=4, batch_first=True)
        self.layer_norm = nn.LayerNorm(256)
        # ---------------------------
        
        self.classifier = nn.Sequential(
            nn.Linear(256, 128),
            nn.ReLU(),
            nn.Dropout(0.5),
            nn.Linear(128, num_classes)
        )

    def forward(self, x):
        if x.dim() == 3: x = x.unsqueeze(1)
        
        if self.training:
            x = self.freq_mask(x)
            x = self.time_mask(x)
            
        x = self.pool(F.relu(self.bn1(self.conv1(x))))
        x = self.pool(F.relu(self.bn2(self.conv2(x))))
        x = self.pool(F.relu(self.bn3(self.conv3(x))))
        x = self.pool(F.relu(self.bn4(self.conv4(x))))
        
        # --- BẮT ĐẦU XỬ LÝ ATTENTION ---
        # Hiện tại x có shape: (Batch, Channels=256, H, W)
        B, C, H, W = x.size()
        
        # 1. Ép trục Tần số (H) lại. Giữ nguyên trục Thời gian (W).
        # Cách tốt nhất: Lấy trung bình theo trục Tần số.
        # Shape mới: (Batch, Channels=256, Time=W)
        x_time = x.mean(dim=2) 
        
        # 2. Xoay trục để đưa vào Attention: (Batch, Time, Channels)
        # Lúc này: Chuỗi dài W bước, mỗi bước là 1 vector 256 chiều.
        x_seq = x_time.permute(0, 2, 1)
        
        # 3. Multi-head Attention
        attn_out, _ = self.attention(x_seq, x_seq, x_seq)
        x_seq = self.layer_norm(x_seq + attn_out)
        
        # 4. Global Average Pooling trên trục Thời gian (W)
        # Shape: (Batch, Time, Channels) -> Lấy trung bình dọc theo Time -> (Batch, Channels)
        x = x_seq.mean(dim=1) 
        # --- KẾT THÚC XỬ LÝ ATTENTION ---
        
        # Đưa thẳng vào Classifier
        x = self.classifier(x)
        return x

# 1. CẤU HÌNH
MODEL_PATH = "best_model_attention_v2.pth"
AUDIO_PATH = "./tests/rap_god.mp3"
LABEL_MAP_PATH = "./data/label_map.json"
STATS_PATH = "./data/stats.json"

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# 2. LOAD CONFIG & MODEL
with open(LABEL_MAP_PATH, 'r') as f:
    label_map = json.load(f)
inv_label_map = {v: k for k, v in label_map.items()}

with open(STATS_PATH, 'r') as f:
    stats = json.load(f)
means = np.array(stats['mean']).reshape(128, 1)
stds = np.array(stats['std']).reshape(128, 1)

model = MusicGenreCNNAttention(num_classes=8).to(device)
model.load_state_dict(torch.load(MODEL_PATH, map_location=device))
model.eval()

# 3. HÀM DỰ ĐOÁN 30 GIÂY (CHIA 4 ĐOẠN)
def predict_30s(audio_path, model, inv_label_map, offset=0.0):
    """
    Dự đoán genre từ đoạn âm thanh 30 giây.
    
    Logic: Chia 30 giây thành 4 đoạn 7.5s không overlap, 
    chạy model trên từng đoạn, lấy trung bình xác suất.
    
    Args:
        audio_path: Đường dẫn file âm thanh
        model: Model đã được load
        inv_label_map: Mapping từ index sang genre name
        offset: Thời gian bắt đầu (giây)
    
    Returns:
        List[(genre_name, percentage)] - Top 3 kết quả
    """
    # Load 30 giây từ offset
    y_full, sr = librosa.load(audio_path, sr=22050, offset=offset, duration=30.0)
    
    # Kiểm tra có đủ dữ liệu không (cần ít nhất 30 giây = 22050*30 samples)
    min_samples_needed = int(22050 * 30)
    if len(y_full) < min_samples_needed * 0.9:  # Allow 10% tolerance
        # Nếu không đủ 30s, pad để đủ
        y_full = np.pad(y_full, (0, min_samples_needed - len(y_full)))
    
    # Chia thành 4 đoạn bằng nhau: 7.5s mỗi đoạn (4 * 7.5 = 30s)
    segment_duration = 7.5  # Sửa từ 7.0 thành 7.5
    samples_per_segment = int(segment_duration * sr)  # ~165375 samples
    all_outputs = []

    for i in range(4):
        start_idx = i * samples_per_segment
        end_idx = start_idx + samples_per_segment
        
        # Lấy segment, nếu thiếu thì pad
        y_seg = y_full[start_idx:end_idx]
        if len(y_seg) < samples_per_segment:
            y_seg = np.pad(y_seg, (0, samples_per_segment - len(y_seg)))

        # Tính mel-spectrogram
        mel = librosa.feature.melspectrogram(
            y=y_seg, sr=sr, n_mels=128, n_fft=2048, hop_length=512
        )
        mel_db = librosa.power_to_db(mel, ref=np.max)
        
        # Chuẩn hóa về 300 frames
        if mel_db.shape[1] > 300:
            mel_db = mel_db[:, :300]
        else:
            mel_db = np.pad(mel_db, ((0, 0), (0, 300 - mel_db.shape[1])))

        # Normalize theo statistics
        mel_norm = (mel_db - means) / stds
        
        # Chạy model
        input_tensor = torch.tensor(mel_norm).float().unsqueeze(0).unsqueeze(0).to(device)
        with torch.no_grad():
            output = model(input_tensor)
            probs = torch.nn.functional.softmax(output, dim=1)
            all_outputs.append(probs)

    # Lấy trung bình xác suất của 4 đoạn
    final_probs = torch.mean(torch.stack(all_outputs), dim=0)  # Shape: (1, 8)
    
    # Lấy Top 3 kết quả cao nhất
    top_probs, top_indices = torch.topk(final_probs, k=3, dim=1)
    
    # Chuyển kết quả sang dạng List[(Genre, Percentage)]
    results = []
    for i in range(3):
        genre = inv_label_map[top_indices[0][i].item()]
        prob = top_probs[0][i].item() * 100
        results.append((genre, prob))
        
    return results

# --- PHẦN GỌI HÀM VÀ IN KẾT QUẢ ---
print(f"--- Đang phân tích file: {os.path.basename(AUDIO_PATH)} ---")
try:
    top3_results = predict_30s(AUDIO_PATH, model, inv_label_map, offset=268.0)
    
    print("\nKẾT QUẢ DỰ ĐOÁN (TOP 3):")
    for genre, prob in top3_results:
        print(f"{genre.upper()} - {prob:.2f}%")

except Exception as e:
    print(f"Lỗi: {e}")