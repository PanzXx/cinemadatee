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

// State
let myName = sessionStorage.getItem('cdName') || 'Anonymous';
let myRole = sessionStorage.getItem('cdRole') || 'viewer';
let isAdmin = myRole === 'admin';
let isSyncing = false; // Flag agar tidak infinite-loop sync
let typingTimeout = null;

// Firebase Refs
const roomRef = ref(db, `rooms/${ROOM_ID}`);
const videoStateRef = ref(db, `rooms/${ROOM_ID}/videoState`);
const chatRef = ref(db, `rooms/${ROOM_ID}/chat`);
const presenceRef = ref(db, `rooms/${ROOM_ID}/presence`);
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
  // Set video source
  video.src = VIDEO_URL;
  movieTitleText.textContent = MOVIE_TITLE;

  // Role UI
  if (isAdmin) {
    roleBadge.textContent = '🎮 Admin';
    roleBadge.classList.add('admin');
    document.body.classList.remove('is-viewer');
  } else {
    roleBadge.textContent = '💕 Viewer';
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
  const ctrls = [playPauseBtn, skipBackBtn, skipFwdBtn];
  ctrls.forEach(btn => {
    if (locked) {
      btn.classList.add('locked');
      btn.disabled = true;
    } else {
      btn.classList.remove('locked');
      btn.disabled = false;
    }
  });
  progressBarWrapper.style.pointerEvents = locked ? 'none' : 'auto';
}

// ================================================================
// VIDEO CONTROLS (ADMIN ONLY)
// ================================================================

// Play/Pause button
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

// Update button icon on video state change
video.addEventListener('play', () => { playPauseBtn.textContent = '⏸'; });
video.addEventListener('pause', () => { playPauseBtn.textContent = '▶'; });

// Skip buttons
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

// Progress bar click (admin seek)
progressBarWrapper.addEventListener('click', (e) => {
  if (!isAdmin) return;
  const rect = progressBarWrapper.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  const t = ratio * (video.duration || 0);
  video.currentTime = t;
  pushVideoState({ playing: !video.paused, currentTime: t });
});

// Volume
volumeSlider.addEventListener('input', () => {
  video.volume = volumeSlider.value;
});

// Time update → update progress bar
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

// Fullscreen
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
// LISTEN TO VIDEO STATE (Both admin & viewer)
// ================================================================
onValue(videoStateRef, (snapshot) => {
  if (isSyncing) return; // Admin sedang push, skip listener

  const state = snapshot.val();
  if (!state) return;

  const diff = Math.abs(video.currentTime - state.currentTime);

  // Sync waktu jika selisih > 2 detik
  if (diff > 2) {
    showSyncOverlay(true);
    video.currentTime = state.currentTime;
    video.addEventListener('seeked', () => {
      showSyncOverlay(false);
    }, { once: true });
  }

  // Sync play/pause
  if (state.playing && video.paused) {
    video.play().catch(() => {});
  } else if (!state.playing && !video.paused) {
    video.pause();
  }

  // Update sync status display
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

  // Set online
  set(myPresenceRef, {
    name: myName,
    role: myRole,
    online: true,
    lastSeen: serverTimestamp()
  });

  // Auto set offline on disconnect
  onDisconnect(myPresenceRef).set({
    name: myName,
    role: myRole,
    online: false,
    lastSeen: serverTimestamp()
  });

  // Listen to partner status
  const partnerRole = isAdmin ? 'viewer' : 'admin';
  const partnerRef = ref(db, `rooms/${ROOM_ID}/presence/${partnerRole}`);

  onValue(partnerRef, (snapshot) => {
    const data = snapshot.val();
    if (data && data.online) {
      partnerDot.className = 'status-dot online';
      partnerNameEl.textContent = `${data.name} — Online 💚`;
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
function setupChat() {
  // Listen to chat messages
  onValue(chatRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    // Clear and re-render (for simplicity; in prod use child_added)
    const msgEls = chatMessages.querySelectorAll('.chat-msg');
    msgEls.forEach(el => el.remove());

    const msgs = Object.values(data).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    msgs.forEach(msg => renderChatMessage(msg));
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });

  // Send button
  chatSendBtn.addEventListener('click', sendMessage);

  // Enter to send (Shift+Enter for newline)
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
    // Typing indicator
    clearTimeout(typingTimeout);
    set(typingRef, { user: myName, typing: true });
    typingTimeout = setTimeout(() => {
      set(typingRef, { user: myName, typing: false });
    }, 2000);
  });

  // Listen to typing
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
    chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
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

  const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';

  if (!isSystem) {
    div.innerHTML = `
      <div class="chat-msg-name">${isMe ? 'Kamu' : escapeHtml(msg.name)}</div>
      <div class="chat-msg-bubble">${escapeHtml(msg.text)}</div>
      <div class="chat-msg-time">${time}</div>
    `;
  } else {
    div.innerHTML = `<div class="chat-msg-bubble">${escapeHtml(msg.text)}</div>`;
  }

  // Insert before typing indicator
  chatMessages.insertBefore(div, typingIndicator);
}

// ================================================================
// HEARTS & REACTIONS
// ================================================================
function setupReactions() {
  // Big heart button
  bigHeartBtn.addEventListener('click', () => {
    triggerHearts(15);
    push(reactionsRef, {
      type: 'hearts',
      from: myName,
      timestamp: serverTimestamp()
    });
    showToast(`${myName} mengirim ❤️❤️❤️`);
  });

  // Popcorn button
  popcornBtn.addEventListener('click', () => {
    push(chatRef, {
      name: myName,
      type: 'system',
      text: `🍿 ${myName} minta jeda popcorn!`,
      timestamp: serverTimestamp()
    });
    // Also pause video if admin
    if (isAdmin) {
      video.pause();
      pushVideoState({ playing: false, currentTime: video.currentTime });
    }
    showToast('🍿 Jeda popcorn diminta!');
  });

  // Mood buttons
  document.querySelectorAll('.mood-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mood = btn.dataset.mood;
      push(reactionsRef, {
        type: 'mood',
        from: myName,
        mood: mood,
        timestamp: serverTimestamp()
      });
      push(chatRef, {
        name: myName,
        type: 'system',
        text: `${myName}: ${mood}`,
        timestamp: serverTimestamp()
      });
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
    });
  });

  // Listen to reactions from partner
  // Use child_added for new reactions only
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
      showToast(`${latest.from}: ${latest.mood}`);
    }
  });
}

function triggerHearts(count = 10) {
  const wrapper = document.querySelector('.video-wrapper');
  const wRect = wrapper.getBoundingClientRect();

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
// BOOT — Check Auth then Init
// ================================================================
onAuthStateChanged(auth, (user) => {
  if (!user) {
    // Not logged in, redirect
    window.location.href = 'index.html';
    return;
  }

  // Logged in — initialize everything
  setupUI();
  setupPresence();
  setupChat();
  setupReactions();

  // Push system message that user joined
  push(chatRef, {
    name: myName,
    type: 'system',
    text: `${myName} bergabung ke bioskop 🎬`,
    timestamp: serverTimestamp()
  });

  // If admin and video is playing, resync on join
  if (!isAdmin) {
    // Viewer: get current state immediately
    get(videoStateRef).then((snapshot) => {
      const state = snapshot.val();
      if (state) {
        video.currentTime = state.currentTime;
        if (state.playing) {
          video.play().catch(() => {});
        }
      }
    });
  }
});

// Admin: periodically sync video position so viewer stays in sync
if (isAdmin) {
  setInterval(() => {
    if (!video.paused && !isSyncing) {
      // Soft sync every 5 seconds
      set(videoStateRef, {
        playing: true,
        currentTime: video.currentTime,
        updatedAt: serverTimestamp(),
        updatedBy: myName
      });
    }
  }, 5000);
}
