'use client';

import {
  LogOut,
  Plus,
  Search,
  Sparkles,
  Trash2,
  UploadCloud,
  Wand2,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ||
  'http://localhost:3000';
const MAX_AUDIO_DURATION_SECONDS = 10 * 60;

type User = {
  userId: string;
  username: string;
  email: string;
};

type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
};

type MusicMessage = {
  id: string;
  role: string;
  content: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
  audio: null | {
    original_name: string;
    original_url: string;
    cut_url: string | null;
    mime_type: string;
    size_bytes: number;
    start_time: number;
    end_time: number | null;
    original_duration_seconds: number;
    original_duration_minutes: number;
    original_duration_text: string;
    clip_duration_seconds: number | null;
    clip_duration_minutes: number | null;
  };
  prediction: null | {
    label: string;
    score: number;
    top_three: Record<string, number>;
    song_name?: string | null;
    artist?: string | null;
  };
};

type ConversationDetail = Conversation & {
  messages: MusicMessage[];
};

function formatDuration(seconds = 0) {
  const safeSeconds = Number.isFinite(seconds) ? seconds : 0;
  return `${(safeSeconds / 60).toFixed(2)} phút (${safeSeconds.toFixed(0)}s)`;
}

function parseTimeInput(value: string) {
  if (value.trim() === '') return NaN;
  return Number(value);
}

function absoluteMediaUrl(path?: string | null) {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return `${API_BASE}${path}`;
}

function statusText(status?: string) {
  const map: Record<string, string> = {
    pending: 'Đã upload',
    processing: 'Đang xử lý',
    completed: 'Hoàn thành',
    failed: 'Lỗi xử lý',
  };
  return map[status || ''] || status || 'Chưa có';
}

function statusPillClass(status?: string) {
  const map: Record<string, string> = {
    pending: 'status-pending',
    processing: 'status-processing',
    completed: 'status-completed',
    failed: 'status-failed',
  };
  return map[status || ''] || 'status-default';
}

function getPageStatusClass(status: string) {
  if (status.includes('thất bại') || status.includes('lỗi')) return 'status-failed';
  if (status.includes('Đang')) return 'status-processing';
  if (status.includes('Đã có')) return 'status-completed';
  return 'status-default';
}

export default function MusicWorkspace() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authMessage, setAuthMessage] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null,
  );
  const [messages, setMessages] = useState<MusicMessage[]>([]);
  const [search, setSearch] = useState('');
  const [isTitleDialogOpen, setIsTitleDialogOpen] = useState(false);
  const [conversationTitle, setConversationTitle] = useState('');
  const [titleError, setTitleError] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewDuration, setPreviewDuration] = useState(0);
  const [startTime, setStartTime] = useState('0');
  const [endTime, setEndTime] = useState('0');
  const [status, setStatus] = useState('Sẵn sàng');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const latestAudio = useMemo(
    () => [...messages].reverse().find((item) => item.audio) || null,
    [messages],
  );

  const latestResult = useMemo(
    () => [...messages].reverse().find((item) => item.prediction) || latestAudio,
    [messages, latestAudio],
  );

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId) || null,
    [activeConversationId, conversations],
  );

  const filteredConversations = useMemo(
    () =>
      conversations.filter((item) =>
        item.title.toLowerCase().includes(search.toLowerCase()),
      ),
    [conversations, search],
  );

  const currentDuration =
    previewDuration || latestAudio?.audio?.original_duration_seconds || 0;

  useEffect(() => {
    if (!previewUrl && latestAudio?.audio?.original_duration_seconds) {
      setStartTime('0');
      setEndTime(latestAudio.audio.original_duration_seconds.toFixed(1));
    }
  }, [previewUrl, latestAudio]);
  useEffect(() => {
    const savedToken = localStorage.getItem('access_token');
    if (savedToken) {
      setToken(savedToken);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    void bootstrap();
  }, [token]);

  async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
    const isFormData = options.body instanceof FormData;
    const headers = new Headers(options.headers);
    if (!isFormData) {
      headers.set('Content-Type', 'application/json');
    }
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const message = Array.isArray(data?.message)
        ? data.message.join(', ')
        : data?.message || data?.detail || 'Request failed';
      throw new Error(message);
    }
    return data as T;
  }

  async function bootstrap() {
    try {
      setStatus('Đang tải dữ liệu...');
      const profile = await api<User>('/auth/me');
      setUser(profile);
      const items = await api<Conversation[]>('/chat/conversations');
      setConversations(items);
      if (items[0]) {
        await openConversation(items[0].id);
      } else {
        setMessages([]);
        setActiveConversationId(null);
      }
      setStatus('Sẵn sàng');
    } catch (error) {
      logout();
      setAuthMessage(error instanceof Error ? error.message : 'Không thể tải');
    }
  }

  async function openConversation(id: string) {
    setStatus('Đang mở hội thoại...');
    const detail = await api<ConversationDetail>(`/chat/conversations/${id}`);
    setActiveConversationId(id);
    setMessages(detail.messages || []);
    setStatus('Sẵn sàng');
  }

  async function refreshConversations() {
    const items = await api<Conversation[]>('/chat/conversations');
    setConversations(items);
  }

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthMessage('');
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const data = await api<{ access_token: string }>(
        authMode === 'login' ? '/auth/login' : '/auth/register',
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      );
      localStorage.setItem('access_token', data.access_token);
      setToken(data.access_token);
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : 'Auth failed');
    }
  }

  function openCreateConversationDialog() {
    setConversationTitle('');
    setTitleError('');
    setIsTitleDialogOpen(true);
  }

  async function handleCreateConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = conversationTitle.trim();
    if (!title) {
      setTitleError('Bạn cần nhập tiêu đề cuộc hội thoại');
      return;
    }

    try {
      const item = await api<Conversation>('/chat/conversations', {
        method: 'POST',
        body: JSON.stringify({ title }),
      });
      setConversationTitle('');
      setTitleError('');
      setIsTitleDialogOpen(false);
      setConversations((current) => [item, ...current]);
      await openConversation(item.id);
    } catch (error) {
      setTitleError(
        error instanceof Error ? error.message : 'Không thể tạo hội thoại',
      );
    }
  }

  async function deleteConversation(id: string) {
    await api(`/chat/conversations/${id}`, { method: 'DELETE' });
    const next = conversations.filter((item) => item.id !== id);
    setConversations(next);
    if (id === activeConversationId) {
      if (next[0]) {
        await openConversation(next[0].id);
      } else {
        setActiveConversationId(null);
        setMessages([]);
      }
    }
  }

  function logout() {
    localStorage.removeItem('access_token');
    setToken(null);
    setUser(null);
    setConversations([]);
    setActiveConversationId(null);
    setMessages([]);
  }

  function onFileSelected(file: File | null) {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(file);
    setPreviewDuration(0);
    if (!file) {
      setPreviewUrl('');
      return;
    }
    setPreviewUrl(URL.createObjectURL(file));
  }

  async function uploadAndAnalyze() {
    try {
      const parsedStartTime = parseTimeInput(startTime);
      const parsedEndTime = parseTimeInput(endTime);

      if (!Number.isFinite(parsedStartTime) || !Number.isFinite(parsedEndTime)) {
        throw new Error('Bạn cần nhập thời gian bắt đầu và kết thúc');
      }
      if (parsedStartTime < 0 || parsedEndTime <= 0) {
        throw new Error('Khoảng thời gian không hợp lệ');
      }
      if (parsedEndTime <= parsedStartTime) {
        throw new Error('Thời gian kết thúc phải lớn hơn bắt đầu');
      }
      if (currentDuration && parsedEndTime > currentDuration) {
        throw new Error('Thời gian kết thúc vượt quá độ dài file');
      }
      if (selectedFile && currentDuration > MAX_AUDIO_DURATION_SECONDS) {
        throw new Error('File âm thanh không được dài quá 10 phút');
      }

      setStatus('Đang upload và xử lý...');
      let targetMessage = latestAudio;

      if (selectedFile) {
        if (!selectedFile.type.startsWith('audio/')) {
          throw new Error('File upload phải là audio');
        }
        if (!activeConversationId) {
          throw new Error('Bạn cần tạo cuộc hội thoại trước khi upload');
        }
        const formData = new FormData();
        formData.append('file', selectedFile);
        targetMessage = await api<MusicMessage>(
          `/chat/conversations/${activeConversationId}/audio`,
          {
            method: 'POST',
            body: formData,
          },
        );
      }

      if (!targetMessage) {
        throw new Error('Bạn cần chọn file âm thanh');
      }

      const updated = await api<MusicMessage>(
        `/chat/messages/${targetMessage.id}/analyze`,
        {
          method: 'POST',
          body: JSON.stringify({
            start_time: parsedStartTime,
            end_time: parsedEndTime,
          }),
        },
      );

      setMessages((current) => {
        const withoutOld = current.filter((item) => item.id !== updated.id);
        return [...withoutOld, updated];
      });
      onFileSelected(null);
      await refreshConversations();
      setStatus('Đã có kết quả');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Xử lý thất bại');
    }
  }

  if (!token) {
    return (
      <main className="auth-screen">
        <section className="auth-panel">
          <div className="auth-brand">
            <span>Music GPT</span>
            <strong>AI nhận diện nhạc</strong>
          </div>
          <div className="auth-tabs">
            <button
              className={authMode === 'login' ? 'active' : ''}
              onClick={() => setAuthMode('login')}
              type="button"
            >
              Đăng nhập
            </button>
            <button
              className={authMode === 'register' ? 'active' : ''}
              onClick={() => setAuthMode('register')}
              type="button"
            >
              Đăng ký
            </button>
          </div>
          <form className="auth-form" onSubmit={handleAuth}>
            {authMode === 'register' && (
              <input name="username" placeholder="Tên người dùng" required />
            )}
            <input name="email" type="email" placeholder="Email" required />
            <input
              name="password"
              type="password"
              placeholder="Mật khẩu"
              minLength={6}
              required
            />
            {authMode === 'register' && (
              <input
                name="retype_password"
                type="password"
                placeholder="Nhập lại mật khẩu"
                minLength={6}
                required
              />
            )}
            <button type="submit">
              {authMode === 'login' ? 'Vào Music GPT' : 'Tạo tài khoản'}
            </button>
          </form>
          {authMessage && <p className="auth-error">{authMessage}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="sidebar-top">
          <h1>Music GPT</h1>
          <button onClick={logout} type="button">
            <LogOut size={15} />
            Đăng xuất
          </button>
        </div>

        <label className="search-box">
          <Search size={16} />
          <input
            placeholder="Tìm kiếm cuộc hội thoại"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <button
          className="new-conversation"
          onClick={openCreateConversationDialog}
          type="button"
        >
          <Plus size={17} />
          Cuộc hội thoại mới
        </button>

        <div className="conversation-list">
          {filteredConversations.map((item) => (
            <article
              className={`conversation-card ${
                item.id === activeConversationId ? 'active' : ''
              }`}
              key={item.id}
            >
              <button type="button" onClick={() => openConversation(item.id)}>
                <strong>{item.title}</strong>
              </button>
              <button
                className="delete-button"
                onClick={() => deleteConversation(item.id)}
                type="button"
              >
                <Trash2 size={14} />
                Xóa
              </button>
            </article>
          ))}
        </div>

      </aside>

      <section className="workspace">
        <header className="page-head">
          <div>
            <h2>{activeConversation?.title || 'Chưa có hội thoại'}</h2>
            <p>Chọn hoặc tạo hội thoại để bắt đầu nhận diện nhạc</p>
          </div>
          <span className={`status-pill ${getPageStatusClass(status)}`}>{status}</span>
        </header>

        <section className="main-grid">
          <section className="upload-column">
            <div className="section-title">
              <UploadCloud size={20} />
              <h3>Upload file âm thanh</h3>
            </div>

            <label className="file-row">
              <span>Chọn file</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={(event) =>
                  onFileSelected(event.target.files?.[0] || null)
                }
              />
            </label>

            <div className="file-info">
              <p>
                <strong>Tên file:</strong>{' '}
                {selectedFile?.name || latestAudio?.audio?.original_name || 'Chưa chọn'}
              </p>
              <p>
                <strong>Tổng thời lượng file:</strong>{' '}
                {formatDuration(currentDuration)}
              </p>
              <p>
                <strong>Phần gửi:</strong> {startTime || '--'}s - {endTime || '--'}s
              </p>
            </div>

            <div className="time-grid">
              <label>
                <span>Bắt đầu (s)</span>
                <input
                  min={0}
                  type="number"
                  step="0.1"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                />
              </label>
              <label>
                <span>Kết thúc (s)</span>
                <input
                  min={0.1}
                  type="number"
                  step="0.1"
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                />
              </label>
            </div>

            <div className="audio-zone">
              <span>Nghe file gốc:</span>
              {previewUrl ? (
                <audio
                  controls
                  src={previewUrl}
                  onLoadedMetadata={(event) => {
                    const duration = event.currentTarget.duration || 0;
                    setPreviewDuration(duration);
                    setStartTime('0');
                    setEndTime(duration.toFixed(1));
                    if (duration > MAX_AUDIO_DURATION_SECONDS) {
                      setStatus('File âm thanh không được dài quá 10 phút');
                    }
                  }}
                />
              ) : latestAudio?.audio?.original_url ? (
                <audio controls src={absoluteMediaUrl(latestAudio.audio.original_url)} />
              ) : (
                <div className="empty-audio">Chưa có file để nghe</div>
              )}
              <p>
                {Math.min(
                  parseTimeInput(endTime) || 0,
                  currentDuration,
                ).toFixed(0)}s /{' '}
                {currentDuration.toFixed(0)}s
              </p>
            </div>

            <button className="process-button" onClick={uploadAndAnalyze} type="button">
              <Wand2 size={18} />
              Upload & xử lý
            </button>
          </section>

          <aside className="result-column">
            <ResultPanel title="Kết quả mới nhất" message={latestResult} />

            <section className="history-panel">
              <h3>Lịch sử upload</h3>
              <div className="history-list">
                {messages.filter((item) => item.audio).length === 0 && (
                  <p className="empty-history">Chưa có lịch sử upload</p>
                )}
                {messages
                  .filter((item) => item.audio)
                  .slice()
                  .reverse()
                  .map((item) => (
                    <ResultPanel compact key={item.id} message={item} />
                  ))}
              </div>
            </section>
          </aside>
        </section>
      </section>

      {isTitleDialogOpen && (
        <div className="dialog-backdrop">
          <form className="title-dialog" onSubmit={handleCreateConversation}>
            <h3>Tạo cuộc hội thoại mới</h3>
            <label>
              <span>Tiêu đề</span>
              <input
                autoFocus
                maxLength={120}
                placeholder="Ví dụ: Nhận diện đoạn guitar"
                value={conversationTitle}
                onChange={(event) => {
                  setConversationTitle(event.target.value);
                  setTitleError('');
                }}
              />
            </label>
            {titleError && <p>{titleError}</p>}
            <div className="dialog-actions">
              <button
                className="ghost-button"
                onClick={() => setIsTitleDialogOpen(false)}
                type="button"
              >
                Hủy
              </button>
              <button type="submit">Tạo mới</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function ResultPanel({
  title,
  message,
  compact = false,
}: {
  title?: string;
  message: MusicMessage | null;
  compact?: boolean;
}) {
  const topThree = message?.prediction?.top_three || {};
  const clipDuration = message?.audio?.clip_duration_seconds || 0;

  return (
    <section className={`result-card ${compact ? 'compact' : ''}`}>
      {title && (
        <div className="section-title">
          <Sparkles size={18} />
          <h3>{title}</h3>
        </div>
      )}
      {!message?.audio ? (
        <p className="empty-history">Chưa có kết quả</p>
      ) : (
        <>
          <div className="result-head">
            <span className={`status-pill ${statusPillClass(message.status)}`}>
              {statusText(message.status)}
            </span>
            <p>Upload file âm nhạc và cắt từ {message.audio.start_time || 0}s đến {message.audio.end_time || 0}s</p>
          </div>

          <p>
            <strong>Phát đoạn:</strong> {message.audio.start_time || 0}s -{' '}
            {message.audio.end_time || 0}s
          </p>
          <p>
            <strong>Tổng thời lượng đã cắt:</strong>{' '}
            {formatDuration(clipDuration)}
          </p>

          {message.audio.cut_url ? (
            <audio controls src={absoluteMediaUrl(message.audio.cut_url)} />
          ) : (
            <audio controls src={absoluteMediaUrl(message.audio.original_url)} />
          )}

          {message.prediction ? (
            <div className="prediction-container">
              {Object.entries(topThree).map(([label, score]) => (
                <div key={label} className="prediction-row">
                  <div className="prediction-label">
                    <span>{label}</span>
                    <span className="prediction-value">{Number(score).toFixed(1)}%</span>
                  </div>
                  <div className="prediction-bar-bg">
                    <div
                      className="prediction-bar-fill"
                      style={{ width: `${score}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="prediction-container">
              <p className="empty-history">Chưa có kết quả phân tích</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
