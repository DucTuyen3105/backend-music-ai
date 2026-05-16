const state = {
  token: localStorage.getItem('access_token'),
  conversations: [],
  activeConversationId: null,
  messages: [],
  previewUrl: null,
};

const els = {
  authView: document.querySelector('#authView'),
  appView: document.querySelector('#appView'),
  loginTab: document.querySelector('#loginTab'),
  registerTab: document.querySelector('#registerTab'),
  loginForm: document.querySelector('#loginForm'),
  registerForm: document.querySelector('#registerForm'),
  authMessage: document.querySelector('#authMessage'),
  currentUser: document.querySelector('#currentUser'),
  newConversationBtn: document.querySelector('#newConversationBtn'),
  conversationList: document.querySelector('#conversationList'),
  conversationTitle: document.querySelector('#conversationTitle'),
  connectionState: document.querySelector('#connectionState'),
  logoutBtn: document.querySelector('#logoutBtn'),
  messages: document.querySelector('#messages'),
  historyList: document.querySelector('#historyList'),
  historyCount: document.querySelector('#historyCount'),
  uploadForm: document.querySelector('#uploadForm'),
  audioInput: document.querySelector('#audioInput'),
  dropzone: document.querySelector('#dropzone'),
  selectedFileName: document.querySelector('#selectedFileName'),
  selectedFileDuration: document.querySelector('#selectedFileDuration'),
  localPreview: document.querySelector('#localPreview'),
  waveCanvas: document.querySelector('#waveCanvas'),
};

const clientLimits = {
  maxBytes: 50 * 1024 * 1024,
  audioMimePrefix: 'audio/',
};

function showAuth() {
  els.authView.classList.remove('hidden');
  els.appView.classList.add('hidden');
}

function showApp() {
  els.authView.classList.add('hidden');
  els.appView.classList.remove('hidden');
}

function setAuthMode(mode) {
  const isLogin = mode === 'login';
  els.loginTab.classList.toggle('active', isLogin);
  els.registerTab.classList.toggle('active', !isLogin);
  els.loginForm.classList.toggle('hidden', !isLogin);
  els.registerForm.classList.toggle('hidden', isLogin);
  els.authMessage.textContent = '';
}

function setStatus(message, isError = false) {
  els.connectionState.textContent = message;
  els.connectionState.style.borderColor = isError ? '#fed7aa' : '#b7ebe4';
  els.connectionState.style.background = isError ? '#fff7ed' : '#ecfdf9';
  els.connectionState.style.color = isError ? 'var(--danger)' : 'var(--mint-dark)';
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const hasFormData = options.body instanceof FormData;

  if (!hasFormData && options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (state.token) {
    headers.set('Authorization', `Bearer ${state.token}`);
  }

  const response = await fetch(path, { ...options, headers });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!response.ok) {
    throw new Error(formatApiError(data));
  }
  return data;
}

function formatApiError(data) {
  if (!data) {
    return 'Request failed';
  }
  if (Array.isArray(data.message)) {
    return data.message.join(', ');
  }
  return data.message || data.detail || data.error || 'Request failed';
}

function persistToken(accessToken) {
  state.token = accessToken;
  localStorage.setItem('access_token', accessToken);
}

function logout() {
  localStorage.removeItem('access_token');
  state.token = null;
  state.activeConversationId = null;
  state.conversations = [];
  state.messages = [];
  renderMessages();
  renderConversations();
  showAuth();
}

async function loadApp() {
  try {
    showApp();
    setStatus('Đang tải...');
    const me = await api('/auth/me');
    els.currentUser.textContent = me.username || me.email;
    await refreshConversations();

    if (state.conversations.length > 0) {
      await selectConversation(state.activeConversationId || state.conversations[0].id);
    } else {
      renderMessages();
    }
    setStatus('Sẵn sàng');
  } catch (error) {
    logout();
    els.authMessage.textContent = error.message;
  }
}

async function refreshConversations() {
  state.conversations = await api('/chat/conversations');
  if (
    state.activeConversationId &&
    !state.conversations.some((item) => item.id === state.activeConversationId)
  ) {
    state.activeConversationId = null;
  }
  renderConversations();
}

function renderConversations() {
  if (!state.conversations.length) {
    els.conversationList.innerHTML = `
      <div class="history-empty">Chưa có hội thoại</div>
    `;
    return;
  }

  els.conversationList.innerHTML = state.conversations
    .map((conversation) => {
      const active = conversation.id === state.activeConversationId ? 'active' : '';
      return `
        <button class="conversation-item ${active}" data-conversation-id="${escapeHtml(conversation.id)}" type="button">
          <strong>${escapeHtml(conversation.title)}</strong>
          <span>${conversation.message_count || 0} tin nhắn</span>
        </button>
      `;
    })
    .join('');
}

async function createConversation() {
  setStatus('Đang tạo hội thoại...');
  const conversation = await api('/chat/conversations', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  state.conversations.unshift({ ...conversation, message_count: 0 });
  await selectConversation(conversation.id);
  setStatus('Sẵn sàng');
}

async function selectConversation(conversationId) {
  state.activeConversationId = conversationId;
  renderConversations();
  const conversation = await api(`/chat/conversations/${conversationId}`);
  state.messages = conversation.messages || [];
  els.conversationTitle.textContent = conversation.title;
  renderMessages();
}

function renderMessages() {
  if (!state.activeConversationId) {
    els.conversationTitle.textContent = 'Cuộc hội thoại';
    els.messages.innerHTML = `
      <div class="empty-state">
        <h3>Không gian phân tích nhạc</h3>
        <p>Chưa có hội thoại đang mở.</p>
      </div>
    `;
    renderHistory();
    return;
  }

  if (!state.messages.length) {
    els.messages.innerHTML = `
      <div class="empty-state">
        <h3>Hội thoại trống</h3>
        <p>File nhạc đã upload sẽ xuất hiện tại đây.</p>
      </div>
    `;
    renderHistory();
    return;
  }

  els.messages.innerHTML = state.messages.map(renderMessage).join('');
  els.messages.scrollTop = els.messages.scrollHeight;
  renderHistory();
}

function renderMessage(message) {
  const audio = message.audio;
  const statusClass = message.status === 'failed' ? 'failed' : message.status;
  const createdAt = message.created_at
    ? new Date(message.created_at).toLocaleString('vi-VN')
    : '';

  return `
    <article class="message ${escapeHtml(message.role)} ${escapeHtml(statusClass)}">
      <div class="message-header">
        <strong>${message.role === 'user' ? 'Bạn' : 'AI'}</strong>
        <span>${statusLabel(message.status)} · ${escapeHtml(createdAt)}</span>
      </div>
      ${
        audio
          ? renderAudioBlock(message)
          : `<div class="audio-block"><p>${escapeHtml(message.content || '')}</p></div>`
      }
      ${
        message.status === 'failed'
          ? `<div class="audio-block"><p class="form-message">${escapeHtml(message.content || 'Có lỗi khi xử lý')}</p></div>`
          : ''
      }
    </article>
  `;
}

function renderAudioBlock(message) {
  const audio = message.audio;
  const durationSeconds = Number(audio.original_duration_seconds || 0);
  const defaultStart = Number(audio.start_time || 0);
  const defaultEnd = Number(
    audio.end_time || Math.min(durationSeconds || 30, 30),
  );

  return `
    <div class="audio-block">
      <div class="meta-grid">
        <div class="meta-tile">
          <strong>${escapeHtml(audio.original_name || 'Audio')}</strong>
          <span>${formatDuration(durationSeconds)}</span>
        </div>
        <div class="meta-tile">
          <strong>${formatBytes(audio.size_bytes || 0)}</strong>
          <span>${escapeHtml(audio.mime_type || 'audio')}</span>
        </div>
      </div>

      <audio controls src="${escapeHtml(audio.original_url)}"></audio>

      <form class="analyze-card analyze-form" data-message-id="${escapeHtml(message.id)}">
        <label>
          Bắt đầu (giây)
          <input name="start_time" type="number" min="0" max="${durationSeconds}" step="0.1" value="${defaultStart}" required />
        </label>
        <label>
          Kết thúc (giây)
          <input name="end_time" type="number" min="0.1" max="${durationSeconds}" step="0.1" value="${defaultEnd}" required />
        </label>
        <button type="submit">Cắt và dự đoán</button>
      </form>

      ${
        audio.cut_url
          ? `
            <p class="clip-title">Clip đã cắt · ${formatDuration(audio.clip_duration_seconds || 0)}</p>
            <audio controls src="${escapeHtml(audio.cut_url)}"></audio>
          `
          : ''
      }

      ${message.prediction ? renderPrediction(message.prediction) : ''}
    </div>
  `;
}

function renderPrediction(prediction) {
  const entries = Object.entries(prediction.top_three || {});
  return `
    <div class="prediction">
      <h4>Kết quả: ${escapeHtml(prediction.label)} (${Number(prediction.score).toFixed(2)}%)</h4>
      <div class="prediction-grid">
        ${entries.map(([label, score]) => renderPredictionBar(label, Number(score))).join('')}
      </div>
    </div>
  `;
}

function renderPredictionBar(label, score) {
  const safeScore = Math.max(0, Math.min(score, 100));
  return `
    <div class="bar">
      <span>${escapeHtml(label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${safeScore}%"></span></span>
      <strong>${safeScore.toFixed(1)}%</strong>
    </div>
  `;
}

function renderHistory() {
  const uploaded = state.messages.filter((message) => message.audio);
  els.historyCount.textContent = `${uploaded.length} file`;

  if (!uploaded.length) {
    els.historyList.innerHTML = `<div class="history-empty">Chưa có file</div>`;
    return;
  }

  els.historyList.innerHTML = uploaded
    .slice()
    .reverse()
    .map((message) => {
      const audio = message.audio;
      const prediction = message.prediction
        ? `${message.prediction.label} · ${Number(message.prediction.score).toFixed(2)}%`
        : statusLabel(message.status);
      return `
        <div class="history-item">
          <strong>${escapeHtml(audio.original_name || 'Audio')}</strong>
          <span>${formatDuration(audio.original_duration_seconds || 0)}</span>
          <span>${escapeHtml(prediction)}</span>
        </div>
      `;
    })
    .join('');
}

function statusLabel(status) {
  const map = {
    pending: 'Chờ xử lý',
    processing: 'Đang xử lý',
    completed: 'Hoàn tất',
    failed: 'Lỗi',
  };
  return map[status] || status;
}

function formatDuration(seconds) {
  const safeSeconds = Number(seconds || 0);
  return `${(safeSeconds / 60).toFixed(2)} phút, ${safeSeconds.toFixed(2)} giây`;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function readForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function validateClientFile(file) {
  if (!file) {
    throw new Error('Bạn cần chọn file nhạc trước');
  }
  if (file.size > clientLimits.maxBytes) {
    throw new Error('File vượt quá 50MB');
  }
  if (!file.type.startsWith(clientLimits.audioMimePrefix)) {
    throw new Error('File không đúng định dạng audio');
  }
}

async function handleAuthSubmit(form, path) {
  els.authMessage.textContent = '';
  try {
    const data = await api(path, {
      method: 'POST',
      body: JSON.stringify(readForm(form)),
    });
    persistToken(data.access_token);
    await loadApp();
  } catch (error) {
    els.authMessage.textContent = error.message;
  }
}

function clearPreview() {
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
  }
  els.selectedFileName.textContent = 'Chưa có file';
  els.selectedFileDuration.textContent = '0 phút, 0 giây';
  els.localPreview.classList.add('hidden');
  els.localPreview.removeAttribute('src');
  drawEmptyWave();
}

async function setSelectedFile(file) {
  validateClientFile(file);
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
  }

  state.previewUrl = URL.createObjectURL(file);
  els.selectedFileName.textContent = file.name;
  els.selectedFileDuration.textContent = 'Đang đọc duration...';
  els.localPreview.src = state.previewUrl;
  els.localPreview.classList.remove('hidden');
  els.localPreview.onloadedmetadata = () => {
    els.selectedFileDuration.textContent = formatDuration(
      els.localPreview.duration,
    );
  };

  await drawWaveform(file);
}

function drawEmptyWave() {
  const canvas = els.waveCanvas;
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#fbfdff';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#d9e1ec';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();
}

async function drawWaveform(file) {
  const canvas = els.waveCanvas;
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioContextClass();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const samples = audioBuffer.getChannelData(0);
    const step = Math.ceil(samples.length / width);
    const amp = height / 2;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#fbfdff';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#3478f6';
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let x = 0; x < width; x += 1) {
      let min = 1;
      let max = -1;
      for (let index = 0; index < step; index += 1) {
        const datum = samples[x * step + index] || 0;
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      ctx.moveTo(x, (1 + min) * amp);
      ctx.lineTo(x, (1 + max) * amp);
    }
    ctx.stroke();
    await audioContext.close();
  } catch {
    drawEmptyWave();
  }
}

els.loginTab.addEventListener('click', () => setAuthMode('login'));
els.registerTab.addEventListener('click', () => setAuthMode('register'));

els.loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  handleAuthSubmit(els.loginForm, '/auth/login');
});

els.registerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  handleAuthSubmit(els.registerForm, '/auth/register');
});

els.logoutBtn.addEventListener('click', logout);

els.newConversationBtn.addEventListener('click', async () => {
  try {
    await createConversation();
  } catch (error) {
    setStatus(error.message, true);
  }
});

els.conversationList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-conversation-id]');
  if (!button) {
    return;
  }
  try {
    setStatus('Đang mở hội thoại...');
    await selectConversation(button.dataset.conversationId);
    setStatus('Sẵn sàng');
  } catch (error) {
    setStatus(error.message, true);
  }
});

els.audioInput.addEventListener('change', async () => {
  const file = els.audioInput.files?.[0];
  if (!file) {
    clearPreview();
    return;
  }

  try {
    await setSelectedFile(file);
    setStatus('File đã sẵn sàng');
  } catch (error) {
    clearPreview();
    setStatus(error.message, true);
  }
});

['dragenter', 'dragover'].forEach((eventName) => {
  els.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropzone.classList.add('dragging');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  els.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropzone.classList.remove('dragging');
  });
});

els.dropzone.addEventListener('drop', async (event) => {
  const file = event.dataTransfer.files?.[0];
  if (!file) {
    return;
  }

  const transfer = new DataTransfer();
  transfer.items.add(file);
  els.audioInput.files = transfer.files;

  try {
    await setSelectedFile(file);
    setStatus('File đã sẵn sàng');
  } catch (error) {
    clearPreview();
    setStatus(error.message, true);
  }
});

els.uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = els.audioInput.files?.[0];

  try {
    validateClientFile(file);
    if (!state.activeConversationId) {
      await createConversation();
    }

    setStatus('Đang upload...');
    const formData = new FormData();
    formData.append('file', file);
    const message = await api(
      `/chat/conversations/${state.activeConversationId}/audio`,
      {
        method: 'POST',
        body: formData,
      },
    );

    state.messages.push(message);
    renderMessages();
    await refreshConversations();
    els.uploadForm.reset();
    clearPreview();
    setStatus('Upload xong');
  } catch (error) {
    setStatus(error.message, true);
  }
});

els.messages.addEventListener('submit', async (event) => {
  const form = event.target.closest('.analyze-form');
  if (!form) {
    return;
  }
  event.preventDefault();

  const button = form.querySelector('button');
  const previousText = button.textContent;
  const messageId = form.dataset.messageId;
  const payload = readForm(form);
  payload.start_time = Number(payload.start_time);
  payload.end_time = Number(payload.end_time);

  try {
    button.disabled = true;
    button.textContent = 'Đang chạy...';
    setStatus('Đang cắt audio và gọi FastAPI model...');
    const updatedMessage = await api(`/chat/messages/${messageId}/analyze`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    state.messages = state.messages.map((message) =>
      message.id === messageId ? updatedMessage : message,
    );
    renderMessages();
    await refreshConversations();
    setStatus('Đã có kết quả dự đoán');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = previousText;
  }
});

drawEmptyWave();

if (state.token) {
  loadApp();
} else {
  showAuth();
}
