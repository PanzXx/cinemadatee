// ================================================================
// watch.js — Logic utama CinemaDate
// Firebase Realtime Database untuk sinkronisasi
// ================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  onValue,
  set,
  push,
  remove,
  serverTimestamp,
  onDisconnect,
  get
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { FIREBASE_CONFIG, VIDEO_URL, MOVIE_TITLE, ROOM_ID } from "./config.js";

// ================================================================
// INIT
// ================================================================
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getDatabase(app);

let myName = sessionStorage.getItem('cdName') || 'Anonymous';
let myRole = sessionStorage.getItem('cdRole') || 'viewer';
let isAdmin = myRole === 'admin';
let isSyncing = false;
let typingTimeout = null;

// Local deleted message keys (for "delete for me")
const LOCAL_DELETED_KEY = `cd_deleted_${ROOM_ID}`;
let localDeletedIds = new Set(JSON.parse(localStorage.getItem(LOCAL_DELETED_KEY) || '[]'));

// Firebase Refs
const videoStateRef = ref(db, `rooms/${ROOM_ID}/videoState`);
const chatRef = ref(db, `rooms/${ROOM_ID}/chat`);
const reactionsRef = ref(db, `rooms/${ROOM_ID}/reactions`);
const typingRef = ref(db, `rooms/${ROOM_ID}/typing`);

// DOM Elements
const video = document.getElementById('mainVideo');
const playPauseBtn = document.getElementById('playPauseBtn');
const skipBackBtn = document.getElementById('skipBackBtn');
const skipFwdBtn = document.getElementById('skipFwdBtn');
const progressBarWrapper = document.getElementById('progressBarWrapper');
const progressFill = document.getElementById('progressFill');
const timeCurrentDisplay = document.getElementById('timeCurrentDisplay');
const timeDurationDisplay = document.getElementById('timeDurationDisplay');
const volumeSlider = document.getElementById('volumeSlider');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
const chatClearBtn = document.getElementById('chatClearBtn');
const bigHeartBtn = document.getElementById('bigHeartBtn');
const popcornBtn = document.getElementById('popcornBtn');
const partnerDot = document.getElementById('partnerDot');
const partnerNameEl = document.getElementById('partnerName');
const roleBadge = document.getElementById('roleBadge');
const syncOverlay = document.getElementById('syncOverlay');
const syncPosDisplay = document.getElementById('syncPosDisplay');
const syncStatusDisplay = document.getElementById('syncStatusDisplay');
const connStatusDisplay = document.getElementById('connStatusDisplay');
const reactionToast = document.getElementById('reactionToast');
const typingIndicator = document.getElementById('typingIndicator');
const movieTitleText = document.getElementById('movieTitleText');

// ================================================================
// SETUP UI
// ================================================================
function setupUI() {
  video.src = VIDEO_URL;
  movieTitleText.textContent = MOVIE_TITLE;

  if (isAdmin) {
    roleBadge.textContent = '🎮 Admin';
    roleBadge.classList.add('admin');
    document.body.classList.remove('is-viewer');
  } else {
    roleBadge.textContent = '💕 Penonton';
    document.body.classList.add('is-viewer');
    lockControls(true);
  }

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${tab}`).classList.add('active');
    });
  });
}

function lockControls(locked) {
  [playPauseBtn, skipBackBtn, skipFwdBtn].forEach(btn => {
    btn.classList.toggle('locked', locked);
    btn.disabled = locked;
  });
  progressBarWrapper.style.pointerEvents = locked ? 'none' : 'auto';
}

// ================================================================
// VIDEO CONTROLS (ADMIN ONLY)
// ================================================================
playPauseBtn.addEventListener('click', () => {
  if (!isAdmin) return;
  if (video.paused) {
    video.play();
    pushVideoState({ playing: true, currentTime: video.currentTime });
  } else {
    video.pause();
    pushVideoState({ playing: false, currentTime: video.currentTime });
  }
});

video.addEventListener('play', () => { playPauseBtn.textContent = '⏸'; });
video.addEventListener('pause', () => { playPauseBtn.textContent = '▶'; });

skipBackBtn.addEventListener('click', () => {
  if (!isAdmin) return;
  const t = Math.max(0, video.currentTime - 10);
  video.currentTime = t;
  pushVideoState({ playing: !video.paused, currentTime: t });
});

skipFwdBtn.addEventListener('click', () => {
  if (!isAdmin) return;
  const t = Math.min(video.duration || Infinity, video.currentTime + 10);
  video.currentTime = t;
  pushVideoState({ playing: !video.paused, currentTime: t });
});

// Progress bar — support both click and touch
progressBarWrapper.addEventListener('click', (e) => {
  if (!isAdmin) return;
  seekFromEvent(e.clientX);
});

// Touch drag for progress bar
let isDraggingProgress = false;
progressBarWrapper.addEventListener('touchstart', (e) => {
  if (!isAdmin) return;
  isDraggingProgress = true;
}, { passive: true });
progressBarWrapper.addEventListener('touchmove', (e) => {
  if (!isAdmin || !isDraggingProgress) return;
  seekFromEvent(e.touches[0].clientX);
}, { passive: true });
progressBarWrapper.addEventListener('touchend', () => {
  if (!isAdmin) return;
  isDraggingProgress = false;
  pushVideoState({ playing: !video.paused, currentTime: video.currentTime });
});

function seekFromEvent(clientX) {
  const rect = progressBarWrapper.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const t = ratio * (video.duration || 0);
  video.currentTime = t;
  pushVideoState({ playing: !video.paused, currentTime: t });
}

volumeSlider.addEventListener('input', () => {
  video.volume = volumeSlider.value;
});

video.addEventListener('timeupdate', () => {
  const dur = video.duration || 0;
  const cur = video.currentTime;
  const pct = dur ? (cur / dur) * 100 : 0;
  progressFill.style.width = pct + '%';
  timeCurrentDisplay.textContent = formatTime(cur);
  timeDurationDisplay.textContent = formatTime(dur);
  syncPosDisplay.textContent = formatTime(cur);
});

video.addEventListener('loadedmetadata', () => {
  timeDurationDisplay.textContent = formatTime(video.duration);
});

fullscreenBtn.addEventListener('click', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.getElementById('appShell').requestFullscreen?.();
  }
});

// ================================================================
// PUSH VIDEO STATE TO FIREBASE (Admin only)
// ================================================================
function pushVideoState(state) {
  if (!isAdmin) return;
  isSyncing = true;
  set(videoStateRef, {
    playing: state.playing,
    currentTime: state.currentTime,
    updatedAt: serverTimestamp(),
    updatedBy: myName
  }).then(() => {
    setTimeout(() => { isSyncing = false; }, 500);
  });
}

// ================================================================
// LISTEN TO VIDEO STATE
// ================================================================
onValue(videoStateRef, (snapshot) => {
  if (isSyncing) return;
  const state = snapshot.val();
  if (!state) return;

  const diff = Math.abs(video.currentTime - state.currentTime);

  if (diff > 2) {
    showSyncOverlay(true);
    video.currentTime = state.currentTime;
    video.addEventListener('seeked', () => { showSyncOverlay(false); }, { once: true });
  }

  if (state.playing && video.paused) {
    video.play().catch(() => {});
  } else if (!state.playing && !video.paused) {
    video.pause();
  }

  syncStatusDisplay.textContent = diff < 2 ? 'Tersinkron ✓' : 'Menyinkronkan...';
  syncStatusDisplay.className = 'sync-value ' + (diff < 2 ? 'good' : 'warn');
});

function showSyncOverlay(visible) {
  syncOverlay.classList.toggle('visible', visible);
}

// ================================================================
// PRESENCE / ONLINE STATUS
// ================================================================
function setupPresence() {
  const myPresenceRef = ref(db, `rooms/${ROOM_ID}/presence/${myRole}`);

  set(myPresenceRef, {
    name: myName,
    role: myRole,
    online: true,
    lastSeen: serverTimestamp()
  });

  onDisconnect(myPresenceRef).set({
    name: myName,
    role: myRole,
    online: false,
    lastSeen: serverTimestamp()
  });

  const partnerRole = isAdmin ? 'viewer' : 'admin';
  const partnerRef = ref(db, `rooms/${ROOM_ID}/presence/${partnerRole}`);

  onValue(partnerRef, (snapshot) => {
    const data = snapshot.val();
    if (data && data.online) {
      partnerDot.className = 'status-dot online';
      partnerNameEl.textContent = `${data.name} — Online`;
      connStatusDisplay.textContent = 'Online 🟢';
      connStatusDisplay.className = 'sync-value good';
    } else {
      partnerDot.className = 'status-dot offline';
      partnerNameEl.textContent = data?.name ? `${data.name} — Offline` : 'Menunggu pasangan...';
      connStatusDisplay.textContent = 'Offline 🔴';
      connStatusDisplay.className = 'sync-value warn';
    }
  });
}

// ================================================================
// CHAT
// ================================================================

// Store current message keys with their data for delete functionality
let currentMessages = {}; // { firebaseKey: msgData }

function setupChat() {
  // Listen to chat messages
  onValue(chatRef, (snapshot) => {
    const data = snapshot.val();

    // Clear rendered messages
    chatMessages.querySelectorAll('.chat-msg').forEach(el => el.remove());

    if (!data) return;

    currentMessages = data;

    const msgs = Object.entries(data)
      .map(([key, val]) => ({ key, ...val }))
      .filter(msg => !localDeletedIds.has(msg.key))
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    msgs.forEach(msg => renderChatMessage(msg));
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });

  // Send button
  chatSendBtn.addEventListener('click', sendMessage);

  // Enter to send
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
    clearTimeout(typingTimeout);
    set(typingRef, { user: myName, typing: true });
    typingTimeout = setTimeout(() => {
      set(typingRef, { user: myName, typing: false });
    }, 2000);
  });

  // Typing listener
  onValue(typingRef, (snapshot) => {
    const data = snapshot.val();
    if (data && data.typing && data.user !== myName) {
      typingIndicator.style.display = 'flex';
    } else {
      typingIndicator.style.display = 'none';
    }
  });

  // Auto-resize textarea
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 96) + 'px';
  });

  // Clear chat button
  chatClearBtn.addEventListener('click', () => {
    showClearChatModal();
  });
}

function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  push(chatRef, {
    name: myName,
    role: myRole,
    text: text,
    timestamp: serverTimestamp()
  });

  chatInput.value = '';
  chatInput.style.height = 'auto';
  set(typingRef, { user: myName, typing: false });
}

function renderChatMessage(msg) {
  if (!msg.text) return;

  const isMe = msg.name === myName;
  const isSystem = msg.type === 'system';

  const div = document.createElement('div');
  div.className = `chat-msg ${isSystem ? 'is-system' : isMe ? 'is-mine' : 'is-theirs'}`;
  div.dataset.key = msg.key;

  const time = msg.timestamp
    ? new Date(msg.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    : '';

  if (!isSystem) {
    div.innerHTML = `
      <div class="chat-msg-name">${isMe ? 'Anda' : escapeHtml(msg.name)}</div>
      <div class="chat-msg-bubble">${escapeHtml(msg.text)}</div>
      <div class="chat-msg-time">${time}</div>
      <button class="chat-msg-delete" data-key="${msg.key}" title="Hapus pesan">Hapus</button>
    `;
  } else {
    div.innerHTML = `<div class="chat-msg-bubble">${escapeHtml(msg.text)}</div>`;
  }

  // Delete button logic
  const deleteBtn = div.querySelector('.chat-msg-delete');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = deleteBtn.dataset.key;
      showDeleteMessageModal(key, isMe);
    });
  }

  chatMessages.insertBefore(div, typingIndicator);
}

// ================================================================
// CHAT DELETE FUNCTIONALITY
// ================================================================

function showDeleteMessageModal(msgKey, isMyMessage) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const actions = isMyMessage
    ? `
      <button class="modal-btn danger" id="deleteForAll">Hapus untuk Semua</button>
      <button class="modal-btn danger" id="deleteForMe">Hapus untuk Saya</button>
      <button class="modal-btn" id="cancelDelete">Batal</button>
    `
    : `
      <button class="modal-btn danger" id="deleteForMe">Hapus untuk Saya</button>
      <button class="modal-btn" id="cancelDelete">Batal</button>
    `;

  overlay.innerHTML = `
    <div class="modal-card">
      <div class="modal-title">Hapus Pesan</div>
      <div class="modal-desc">
        ${isMyMessage
          ? 'Pilih opsi penghapusan. "Hapus untuk Semua" akan menghapus pesan dari semua pengguna.'
          : 'Pesan ini hanya akan dihapus dari tampilan Anda.'
        }
      </div>
      <div class="modal-actions" style="flex-direction:column; gap:8px;">
        ${actions}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#cancelDelete')?.addEventListener('click', () => overlay.remove());

  overlay.querySelector('#deleteForAll')?.addEventListener('click', () => {
    const msgRef = ref(db, `rooms/${ROOM_ID}/chat/${msgKey}`);
    remove(msgRef);
    overlay.remove();
  });

  overlay.querySelector('#deleteForMe')?.addEventListener('click', () => {
    localDeletedIds.add(msgKey);
    localStorage.setItem(LOCAL_DELETED_KEY, JSON.stringify([...localDeletedIds]));
    const el = chatMessages.querySelector(`[data-key="${msgKey}"]`);
    if (el) el.remove();
    overlay.remove();
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

function showClearChatModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const adminOptions = isAdmin
    ? `<button class="modal-btn danger" id="clearForAll">Hapus untuk Semua</button>`
    : '';

  overlay.innerHTML = `
    <div class="modal-card">
      <div class="modal-title">Hapus Riwayat Percakapan</div>
      <div class="modal-desc">
        ${isAdmin
          ? '"Hapus untuk Semua" akan menghapus seluruh percakapan dari database. "Hapus untuk Saya" hanya menyembunyikan pesan di perangkat Anda.'
          : 'Seluruh riwayat percakapan akan disembunyikan di perangkat Anda.'
        }
      </div>
      <div class="modal-actions" style="flex-direction:column; gap:8px;">
        ${adminOptions}
        <button class="modal-btn danger" id="clearForMe">Hapus untuk Saya</button>
        <button class="modal-btn" id="cancelClear">Batal</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#cancelClear')?.addEventListener('click', () => overlay.remove());

  overlay.querySelector('#clearForAll')?.addEventListener('click', () => {
    if (!isAdmin) return;
    remove(chatRef);
    overlay.remove();
  });

  overlay.querySelector('#clearForMe')?.addEventListener('click', () => {
    // Add all current message keys to local deleted list
    Object.keys(currentMessages).forEach(key => localDeletedIds.add(key));
    localStorage.setItem(LOCAL_DELETED_KEY, JSON.stringify([...localDeletedIds]));
    chatMessages.querySelectorAll('.chat-msg').forEach(el => el.remove());
    overlay.remove();
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

// ================================================================
// HEARTS & REACTIONS
// ================================================================
function setupReactions() {
  bigHeartBtn.addEventListener('click', () => {
    triggerHearts(15);
    push(reactionsRef, {
      type: 'hearts',
      from: myName,
      timestamp: serverTimestamp()
    });
    showToast(`${myName} mengirim ❤️❤️❤️`);
  });

  popcornBtn.addEventListener('click', () => {
    push(chatRef, {
      name: myName,
      type: 'system',
      text: `🍿 ${myName} meminta jeda sebentar`,
      timestamp: serverTimestamp()
    });
    if (isAdmin) {
      video.pause();
      pushVideoState({ playing: false, currentTime: video.currentTime });
    }
    showToast('🍿 Permintaan jeda terkirim!');
  });

  // Mood buttons — emoji only
  document.querySelectorAll('.mood-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mood = btn.dataset.mood;
      push(reactionsRef, {
        type: 'mood',
        from: myName,
        mood: mood,
        timestamp: serverTimestamp()
      });
      spawnSingleEmoji(mood);
      showToast(`${myName} bereaksi ${mood}`);
    });
  });

  // Inline reaction buttons
  document.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const emoji = btn.dataset.reaction;
      push(reactionsRef, {
        type: 'reaction',
        from: myName,
        emoji: emoji,
        timestamp: serverTimestamp()
      });
      spawnSingleEmoji(emoji);
    });
  });

  // Listen to partner reactions
  let reactionsLoaded = false;
  onValue(reactionsRef, (snapshot) => {
    if (!reactionsLoaded) { reactionsLoaded = true; return; }
    const data = snapshot.val();
    if (!data) return;
    const entries = Object.values(data);
    const latest = entries[entries.length - 1];
    if (!latest || latest.from === myName) return;

    if (latest.type === 'hearts') {
      triggerHearts(15);
      showToast(`${latest.from} mengirim ❤️❤️❤️`);
    } else if (latest.type === 'reaction') {
      showToast(`${latest.from}: ${latest.emoji}`);
      spawnSingleEmoji(latest.emoji);
    } else if (latest.type === 'mood') {
      showToast(`${latest.from} bereaksi ${latest.mood}`);
      spawnSingleEmoji(latest.mood);
    }
  });
}

function triggerHearts(count = 10) {
  const wrapper = document.querySelector('.video-wrapper');
  const heartEmojis = ['❤️', '🧡', '💕', '💝', '💖', '💗', '💓', '💞', '🌹'];
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const heart = document.createElement('div');
      heart.className = 'floating-heart';
      heart.textContent = heartEmojis[Math.floor(Math.random() * heartEmojis.length)];
      heart.style.cssText = `
        left: ${10 + Math.random() * 80}%;
        bottom: ${60 + Math.random() * 30}px;
        font-size: ${18 + Math.random() * 20}px;
        --rot: ${-20 + Math.random() * 40}deg;
        --rot2: ${-30 + Math.random() * 60}deg;
      `;
      wrapper.appendChild(heart);
      heart.addEventListener('animationend', () => heart.remove());
    }, i * 80);
  }
}

function spawnSingleEmoji(emoji) {
  const wrapper = document.querySelector('.video-wrapper');
  const el = document.createElement('div');
  el.className = 'floating-heart';
  el.textContent = emoji;
  el.style.cssText = `
    left: ${20 + Math.random() * 60}%;
    bottom: 80px;
    font-size: 2rem;
    --rot: ${-10 + Math.random() * 20}deg;
    --rot2: ${-20 + Math.random() * 40}deg;
  `;
  wrapper.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

function showToast(msg) {
  reactionToast.textContent = msg;
  reactionToast.classList.add('show');
  setTimeout(() => reactionToast.classList.remove('show'), 2500);
}

// ================================================================
// UTILITY
// ================================================================
function formatTime(secs) {
  if (isNaN(secs) || secs === Infinity) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

// ================================================================
// BOOT
// ================================================================
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }

  setupUI();
  setupPresence();
  setupChat();
  setupReactions();

  push(chatRef, {
    name: myName,
    type: 'system',
    text: `${myName} bergabung ke ruang nonton 🎬`,
    timestamp: serverTimestamp()
  });

  if (!isAdmin) {
    get(videoStateRef).then((snapshot) => {
      const state = snapshot.val();
      if (state) {
        video.currentTime = state.currentTime;
        if (state.playing) video.play().catch(() => {});
      }
    });
  }
});

// Admin: periodic sync
if (isAdmin) {
  setInterval(() => {
    if (!video.paused && !isSyncing) {
      set(videoStateRef, {
        playing: true,
        currentTime: video.currentTime,
        updatedAt: serverTimestamp(),
        updatedBy: myName
      });
    }
  }, 5000);
}
