// ================================================================
// watch.js — CinemaDate Logic Utama
// ================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase, ref, onValue, set, push,
  serverTimestamp, onDisconnect, get, remove, update
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { FIREBASE_CONFIG, VIDEO_URL, MOVIE_TITLE, ROOM_ID } from "./config.js";

// ================================================================
// INIT
// ================================================================
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getDatabase(app);

let myName = sessionStorage.getItem('cdName') || 'Anonim';
let myRole = sessionStorage.getItem('cdRole') || 'viewer';
let isAdmin = myRole === 'admin';
let isSyncing = false;
let typingTimeout = null;
let activeCtxMsgKey = null; // key pesan yang sedang dibuka context menu-nya
let localDeletedKeys = new Set(); // pesan yang dihapus "untuk saya"
let pendingModalAction = null;

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
const ctxMenu = document.getElementById('ctxMenu');
const ctxDeleteForMe = document.getElementById('ctxDeleteForMe');
const ctxDeleteForAll = document.getElementById('ctxDeleteForAll');
const ctxDivider = document.getElementById('ctxDivider');
const modalBackdrop = document.getElementById('modalBackdrop');
const modalTitle = document.getElementById('modalTitle');
const modalDesc = document.getElementById('modalDesc');
const modalCancel = document.getElementById('modalCancel');
const modalConfirm = document.getElementById('modalConfirm');
const clearAllChatBtn = document.getElementById('clearAllChatBtn');
const chatActionsBar = document.getElementById('chatActionsBar');
const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
const appShell = document.getElementById('appShell');
const danmakuContainer = document.getElementById('danmakuContainer');
let lastDanmakuTime = Date.now(); // Buat ngecek pesan baru

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
    chatActionsBar.style.display = 'flex';
  } else {
    roleBadge.textContent = '💕 Penonton';
    document.body.classList.add('is-viewer');
    lockControls(true);
    chatActionsBar.style.display = 'none';
    // Viewer: hide "delete for all" option
    ctxDeleteForAll.style.display = 'none';
    ctxDivider.style.display = 'none';
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
// VIDEO CONTROLS
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

progressBarWrapper.addEventListener('click', (e) => {
  if (!isAdmin) return;
  const rect = progressBarWrapper.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  const t = ratio * (video.duration || 0);
  video.currentTime = t;
  pushVideoState({ playing: !video.paused, currentTime: t });
});

volumeSlider.addEventListener('input', () => { video.volume = volumeSlider.value; });

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
  if (document.fullscreenElement) document.exitFullscreen();
  else document.getElementById('appShell').requestFullscreen?.();
});

// ================================================================
// FIREBASE VIDEO SYNC
// ================================================================
function pushVideoState(state) {
  if (!isAdmin) return;
  isSyncing = true;
  set(videoStateRef, {
    playing: state.playing,
    currentTime: state.currentTime,
    updatedAt: serverTimestamp(),
    updatedBy: myName
  }).then(() => { setTimeout(() => { isSyncing = false; }, 500); });
}

onValue(videoStateRef, (snapshot) => {
  if (isSyncing) return;
  const state = snapshot.val();
  if (!state) return;

  const diff = Math.abs(video.currentTime - state.currentTime);
  if (diff > 2) {
    showSyncOverlay(true);
    video.currentTime = state.currentTime;
    video.addEventListener('seeked', () => showSyncOverlay(false), { once: true });
  }

  if (state.playing && video.paused) video.play().catch(() => {});
  else if (!state.playing && !video.paused) video.pause();

  syncStatusDisplay.textContent = diff < 2 ? 'Tersinkron ✓' : 'Menyinkronkan...';
  syncStatusDisplay.className = 'sync-value ' + (diff < 2 ? 'good' : 'warn');
});

// Admin: heartbeat setiap 5 detik
if (isAdmin) {
  setInterval(() => {
    if (!video.paused && !isSyncing) {
      set(videoStateRef, {
        playing: true, currentTime: video.currentTime,
        updatedAt: serverTimestamp(), updatedBy: myName
      });
    }
  }, 5000);
}

function showSyncOverlay(v) { syncOverlay.classList.toggle('visible', v); }

// ================================================================
// PRESENCE
// ================================================================
function setupPresence() {
  const myPresenceRef = ref(db, `rooms/${ROOM_ID}/presence/${myRole}`);
  set(myPresenceRef, { name: myName, role: myRole, online: true, lastSeen: serverTimestamp() });
  onDisconnect(myPresenceRef).set({ name: myName, role: myRole, online: false, lastSeen: serverTimestamp() });

  const partnerRole = isAdmin ? 'viewer' : 'admin';
  onValue(ref(db, `rooms/${ROOM_ID}/presence/${partnerRole}`), (snapshot) => {
    const data = snapshot.val();
    if (data && data.online) {
      partnerDot.className = 'status-dot online';
      partnerNameEl.textContent = `${data.name} — Online`;
      connStatusDisplay.textContent = 'Online 🟢';
      connStatusDisplay.className = 'sync-value good';
    } else {
      partnerDot.className = 'status-dot offline';
      partnerNameEl.textContent = data?.name ? `${data.name} — Offline` : 'Menunggu...';
      connStatusDisplay.textContent = 'Offline 🔴';
      connStatusDisplay.className = 'sync-value warn';
    }
  });
}

// ================================================================
// CHAT
// ================================================================
function setupChat() {
  // 1. Listen to messages & Trigger Danmaku
  onValue(chatRef, (snapshot) => {
    const data = snapshot.val();
    // Remove existing messages (keep typing indicator)
    chatMessages.querySelectorAll('.chat-msg').forEach(el => el.remove());
    if (!data) return;
    
    const msgs = Object.entries(data)
      .map(([key, val]) => ({ key, ...val }))
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      
    msgs.forEach(msg => {
      renderChatMessage(msg);
      
      // TRIGGER DANMAKU: Cek kalau ini pesan baru, bukan pesan lama
      if (msg.timestamp && msg.timestamp > lastDanmakuTime) {
        if (msg.type !== 'system' && !msg.deletedForAll && !localDeletedKeys.has(msg.key)) {
          spawnDanmaku(msg);
        }
      }
    });

    // Update waktu ke pesan terakhir biar gak spam pas reload
    if (msgs.length > 0) {
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg.timestamp > lastDanmakuTime) {
        lastDanmakuTime = lastMsg.timestamp;
      }
    }
    
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });

  // ==========================================
  // BAGIAN YANG SEMPET ILANG: LOGIKA KIRIM PESAN
  // ==========================================
  
  chatSendBtn.addEventListener('click', sendMessage);
  
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); return; }
    clearTimeout(typingTimeout);
    set(typingRef, { user: myName, typing: true });
    typingTimeout = setTimeout(() => set(typingRef, { user: myName, typing: false }), 2000);
  });

  onValue(typingRef, (snapshot) => {
    const data = snapshot.val();
    typingIndicator.style.display = (data && data.typing && data.user !== myName) ? 'flex' : 'none';
  });

  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 80) + 'px';
  });

  // Clear all chat (admin only)
  clearAllChatBtn.addEventListener('click', () => {
    showModal(
      'Hapus Semua Obrolan',
      'Seluruh riwayat percakapan akan dihapus untuk kedua pihak. Tindakan ini tidak dapat dibatalkan.',
      () => { remove(chatRef); }
    );
  });
}
  // Clear all chat (admin only)
  clearAllChatBtn.addEventListener('click', () => {
    showModal(
      'Hapus Semua Obrolan',
      'Seluruh riwayat percakapan akan dihapus untuk kedua pihak. Tindakan ini tidak dapat dibatalkan.',
      () => { remove(chatRef); }
    );
  });
}

function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;
  push(chatRef, {
    name: myName, role: myRole, text,
    timestamp: serverTimestamp(), deletedFor: {}
  });
  chatInput.value = '';
  chatInput.style.height = 'auto';
  set(typingRef, { user: myName, typing: false });
}

function renderChatMessage(msg) {
  if (!msg.text && !msg.type) return;

  // Skip if deleted for me locally
  if (localDeletedKeys.has(msg.key)) return;

  // Skip if deleted for all (Firebase)
  if (msg.deletedForAll) {
    // Show "pesan dihapus" placeholder
    const div = document.createElement('div');
    const isMe = msg.name === myName;
    div.className = `chat-msg ${isMe ? 'is-mine' : 'is-theirs'}`;
    div.dataset.msgKey = msg.key;
    div.innerHTML = `
      <div class="chat-msg-inner">
        <div class="chat-msg-bubble deleted">🚫 Pesan telah dihapus</div>
      </div>`;
    chatMessages.insertBefore(div, typingIndicator);
    return;
  }

  const isMe = msg.name === myName;
  const isSystem = msg.type === 'system';

  const div = document.createElement('div');
  div.className = `chat-msg ${isSystem ? 'is-system' : isMe ? 'is-mine' : 'is-theirs'}`;
  div.dataset.msgKey = msg.key;

  const time = msg.timestamp
    ? new Date(msg.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    : '';

  if (!isSystem) {
    div.innerHTML = `
      <div class="chat-msg-name">${isMe ? 'Anda' : escapeHtml(msg.name)}</div>
      <div class="chat-msg-inner">
        <div class="chat-msg-bubble">${escapeHtml(msg.text)}</div>
        <div class="chat-msg-time">${time}</div>
      </div>`;

    // Long press / right click → context menu
    const inner = div.querySelector('.chat-msg-inner');
    inner.addEventListener('contextmenu', (e) => { e.preventDefault(); openCtxMenu(e, msg.key, isMe); });

    // Mobile long press
    let pressTimer;
    inner.addEventListener('touchstart', () => { pressTimer = setTimeout(() => openCtxMenu(null, msg.key, isMe, div), 500); }, { passive: true });
    inner.addEventListener('touchend', () => clearTimeout(pressTimer));
    inner.addEventListener('touchmove', () => clearTimeout(pressTimer));
  } else {
    div.innerHTML = `<div class="chat-msg-bubble">${escapeHtml(msg.text)}</div>`;
  }

  chatMessages.insertBefore(div, typingIndicator);
}

// ================================================================
// CONTEXT MENU (Delete message)
// ================================================================
function openCtxMenu(e, msgKey, isOwner, refEl) {
  activeCtxMsgKey = msgKey;
  ctxMenu.style.display = 'block';

  if (e) {
    // Desktop: position at cursor
    let x = e.clientX, y = e.clientY;
    if (x + 175 > window.innerWidth) x = window.innerWidth - 180;
    if (y + 100 > window.innerHeight) y = window.innerHeight - 110;
    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top = y + 'px';
  } else if (refEl) {
    // Mobile: position above element
    const rect = refEl.getBoundingClientRect();
    let x = rect.left, y = rect.top - 90;
    if (x + 175 > window.innerWidth) x = window.innerWidth - 180;
    if (y < 0) y = rect.bottom + 4;
    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top = y + 'px';
  }

  // Show "delete for all" only if admin or owner
  const canDeleteForAll = isAdmin || isOwner;
  ctxDeleteForAll.style.display = canDeleteForAll ? 'flex' : 'none';
  ctxDivider.style.display = canDeleteForAll ? 'block' : 'none';
}

ctxDeleteForMe.addEventListener('click', () => {
  if (!activeCtxMsgKey) return;
  localDeletedKeys.add(activeCtxMsgKey);
  // Remove from DOM immediately
  document.querySelector(`[data-msg-key="${activeCtxMsgKey}"]`)?.remove();
  closeCtxMenu();
});

ctxDeleteForAll.addEventListener('click', () => {
  if (!activeCtxMsgKey) return;
  const key = activeCtxMsgKey;
  closeCtxMenu();
  showModal(
    'Hapus untuk Semua',
    'Pesan ini akan dihapus di kedua sisi percakapan. Tindakan ini tidak dapat dibatalkan.',
    () => {
      update(ref(db, `rooms/${ROOM_ID}/chat/${key}`), { deletedForAll: true });
    }
  );
});

function closeCtxMenu() {
  ctxMenu.style.display = 'none';
  activeCtxMsgKey = null;
}

// Close context menu on outside click/touch
document.addEventListener('click', (e) => {
  if (!ctxMenu.contains(e.target)) closeCtxMenu();
});
document.addEventListener('touchstart', (e) => {
  if (!ctxMenu.contains(e.target)) closeCtxMenu();
}, { passive: true });

// ================================================================
// MODAL
// ================================================================
function showModal(title, desc, onConfirm) {
  modalTitle.textContent = title;
  modalDesc.textContent = desc;
  pendingModalAction = onConfirm;
  modalBackdrop.classList.add('visible');
}

modalCancel.addEventListener('click', () => {
  modalBackdrop.classList.remove('visible');
  pendingModalAction = null;
});

modalConfirm.addEventListener('click', () => {
  modalBackdrop.classList.remove('visible');
  if (pendingModalAction) { pendingModalAction(); pendingModalAction = null; }
});

modalBackdrop.addEventListener('click', (e) => {
  if (e.target === modalBackdrop) { modalBackdrop.classList.remove('visible'); pendingModalAction = null; }
});

// ================================================================
// HEARTS & REACTIONS
// ================================================================
function setupReactions() {
  bigHeartBtn.addEventListener('click', () => {
    triggerHearts(14);
    push(reactionsRef, { type: 'hearts', from: myName, timestamp: serverTimestamp() });
    showToast(`${myName} mengirim ❤️`);
  });

  popcornBtn.addEventListener('click', () => {
    push(chatRef, {
      name: myName, type: 'system',
      text: `🍿 ${myName} meminta jeda sebentar`,
      timestamp: serverTimestamp()
    });
    if (isAdmin) { video.pause(); pushVideoState({ playing: false, currentTime: video.currentTime }); }
    showToast('🍿 Permintaan jeda dikirim');
  });

  // Mood buttons — emoji only, send as floating emoji
  document.querySelectorAll('.mood-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const emoji = btn.dataset.mood;
      push(reactionsRef, { type: 'emoji', from: myName, emoji, timestamp: serverTimestamp() });
      // Spawn locally too
      spawnFloatingEmoji(emoji);
    });
  });

  // Inline reaction buttons
  document.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const emoji = btn.dataset.reaction;
      push(reactionsRef, { type: 'emoji', from: myName, emoji, timestamp: serverTimestamp() });
      spawnFloatingEmoji(emoji);
    });
  });

  // Listen to partner reactions
  let loaded = false;
  onValue(reactionsRef, (snapshot) => {
    if (!loaded) { loaded = true; return; }
    const data = snapshot.val();
    if (!data) return;
    const entries = Object.values(data);
    const latest = entries[entries.length - 1];
    if (!latest || latest.from === myName) return;

    if (latest.type === 'hearts') {
      triggerHearts(14);
      showToast(`${latest.from} mengirim ❤️`);
    } else if (latest.type === 'emoji') {
      spawnFloatingEmoji(latest.emoji, 6); // lebih banyak untuk partner
      showToast(`${latest.from}: ${latest.emoji}`);
    }
  });
}

function triggerHearts(count = 10) {
  const wrapper = document.querySelector('.video-wrapper');
  const emojis = ['❤️','🧡','💕','💝','💖','💗','💓','💞','🌹'];
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'floating-heart';
      el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      el.style.cssText = `left:${8+Math.random()*84}%;bottom:${55+Math.random()*35}px;font-size:${16+Math.random()*18}px;--rot:${-20+Math.random()*40}deg;--rot2:${-30+Math.random()*60}deg;`;
      wrapper.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    }, i * 75);
  }
}

function spawnFloatingEmoji(emoji, count = 1) {
  const wrapper = document.querySelector('.video-wrapper');
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'floating-heart';
      el.textContent = emoji;
      el.style.cssText = `left:${15+Math.random()*70}%;bottom:${60+Math.random()*30}px;font-size:${20+Math.random()*16}px;--rot:${-15+Math.random()*30}deg;--rot2:${-25+Math.random()*50}deg;`;
      wrapper.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    }, i * 60);
  }
}

let toastTimeout;
function showToast(msg) {
  const toast = document.getElementById('reactionToast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ================================================================
// UTILITY
// ================================================================
// Fungsi spawn Danmaku
function spawnDanmaku(msg) {
  const el = document.createElement('div');
  el.className = 'danmaku-msg';
  el.textContent = `${msg.name}: ${msg.text}`; // Format: "Panji: halo"
  
  // Posisi vertikal random biar ga numpuk (10% sampai 80% dari atas)
  const topPos = 10 + Math.random() * 70;
  el.style.top = topPos + '%';
  
  // Kecepatan jalan random (5 - 9 detik)
  const duration = 5 + Math.random() * 4;
  el.style.animationDuration = duration + 's';
  
  danmakuContainer.appendChild(el);
  
  // Langsung hapus elemen kalau udah selesai jalan
  el.addEventListener('animationend', () => el.remove());
}

// Logika Tombol Toggle Sidebar
toggleSidebarBtn.addEventListener('click', () => {
  appShell.classList.toggle('hide-sidebar');
  if(appShell.classList.contains('hide-sidebar')) {
    toggleSidebarBtn.style.opacity = '0.5'; // Agak redup kalau chat ditutup
  } else {
    toggleSidebarBtn.style.opacity = '1';
  }
});

function formatTime(secs) {
  if (isNaN(secs) || secs === Infinity) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str));
  return d.innerHTML;
}

// ================================================================
// BOOT
// ================================================================
onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = 'index.html'; return; }

  setupUI();
  setupPresence();
  setupChat();
  setupReactions();

  push(chatRef, {
    name: myName, type: 'system',
    text: `${myName} telah bergabung ke ruang nonton`,
    timestamp: serverTimestamp()
  });

  // Viewer: ambil state video saat ini
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
