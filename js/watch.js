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

// Elemen untuk fitur Danmaku & Toggle Sidebar
const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
const appShell = document.getElementById('appShell');
const danmakuContainer = document.getElementById('danmakuContainer');
let seenMessages = new Set(); // Buat nyatet ID pesan yang udah masuk (mencegah duplikat Danmaku)
let isFirstLoad = true; // Biar pas baru buka room, chat lama ga meluncur semua sebagai Danmaku

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

// ================================================================
// KEYBOARD SHORTCUTS (SPACEBAR PLAY / PAUSE UNTUK ADMIN & MODERATOR)
// ================================================================
window.addEventListener('keydown', (e) => {
  // 1. Deteksi penekanan tombol Spasi pada keyboard
  if (e.code === 'Space' || e.key === ' ') {
    // Hindari pemanggilan saat sedang mengetik pesan obrolan (input/textarea)
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
      return;
    }

    // 2. Pengecekan role pengguna: HANYA untuk Admin atau Moderator
    const isAuthorized = myRole === 'admin' || myRole === 'moderator' || isAdmin;
    if (!isAuthorized) {
      // 3. Untuk penonton biasa, abaikan agar tidak memicu play/pause
      return;
    }

    // 4. Mencegah halaman otomatis bergulir (scroll) ke bawah
    e.preventDefault();

    // Eksekusi Play/Pause & sinkronisasi video Firebase
    if (video.paused) {
      video.play();
      pushVideoState({ playing: true, currentTime: video.currentTime });
      showToast('▶ Diputar');
    } else {
      video.pause();
      pushVideoState({ playing: false, currentTime: video.currentTime });
      showToast('⏸ Dijeda');
    }
  }
});

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

// ================================================================
// PURE CLEAN FULLSCREEN & AUTO-HIDE CONTROLS
// ================================================================
const videoSection = document.querySelector('.video-section');
let fsHideTimer = null;

function hideFullscreenControls() {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    videoSection.classList.add('controls-hidden');
  }
}

function revealFullscreenControls() {
  videoSection.classList.remove('controls-hidden');
  if (fsHideTimer) clearTimeout(fsHideTimer);
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    fsHideTimer = setTimeout(hideFullscreenControls, 3000);
  }
}

fullscreenBtn.addEventListener('click', () => {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  } else {
    if (videoSection.requestFullscreen) videoSection.requestFullscreen();
    else if (videoSection.webkitRequestFullscreen) videoSection.webkitRequestFullscreen();
  }
});

function onFullscreenChange() {
  const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (isFS) {
    // 2. Langsung sembunyikan semua elemen UI begitu masuk mode full screen
    videoSection.classList.add('controls-hidden');
  } else {
    videoSection.classList.remove('controls-hidden');
    if (fsHideTimer) clearTimeout(fsHideTimer);
  }
}

document.addEventListener('fullscreenchange', onFullscreenChange);
document.addEventListener('webkitfullscreenchange', onFullscreenChange);

// 3. Munculkan kembali kontrol saat mouse bergerak (atau layar disentuh)
videoSection.addEventListener('mousemove', () => {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    revealFullscreenControls();
  }
});

videoSection.addEventListener('touchstart', () => {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    revealFullscreenControls();
  }
}, { passive: true });

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
  let wasPartnerOnline = null;
  let offlineModalShown = false;

  onValue(ref(db, `rooms/${ROOM_ID}/presence/${partnerRole}`), (snapshot) => {
    const data = snapshot.val();
    const partnerName = data?.name || (partnerRole === 'viewer' ? 'zizahh' : 'Apri Panji');

    if (data && data.online) {
      partnerDot.className = 'status-dot online';
      partnerNameEl.textContent = `${partnerName} — Online`;
      connStatusDisplay.textContent = 'Online 🟢';
      connStatusDisplay.className = 'sync-value good';

      // Jika sebelumnya offline lalu kembali online
      if (wasPartnerOnline === false) {
        showToast(`🟢 ${partnerName} kembali online!`);
      }
      wasPartnerOnline = true;
      offlineModalShown = false;
    } else {
      partnerDot.className = 'status-dot offline';
      partnerNameEl.textContent = `${partnerName} — Offline`;
      connStatusDisplay.textContent = 'Offline 🔴';
      connStatusDisplay.className = 'sync-value warn';

      // Deteksi transisi offline: munculkan pop-up peringatan interaktif
      if (wasPartnerOnline === true && !offlineModalShown) {
        offlineModalShown = true;
        showModal(
          '⚠️ Koneksi Pasangan Terputus',
          `${partnerName} sedang offline. Apakah kamu ingin menjeda video untuk menunggu ${partnerName} kembali online atau tetap melanjutkan menonton?`,
          () => {
            // Tombol "Pause" diklik
            if (!video.paused) {
              video.pause();
              pushVideoState({ playing: false, currentTime: video.currentTime });
            }
            showToast(`⏸ Video dijeda menunggu ${partnerName} kembali online`);
          },
          'Pause',     // confirmText (tombol eksekusi jeda)
          'Lanjutkan'  // cancelText (tombol lanjut tonton)
        );
      }
      wasPartnerOnline = false;
    }
  });
}

// ================================================================
// CHAT
// ================================================================
let isChatInitialized = false;
const seenDanmakuSignatures = new Map();

function setupChat() {
  if (isChatInitialized) return;
  isChatInitialized = true;

  // 1. Listen to messages & Danmaku
  onValue(chatRef, (snapshot) => {
    const data = snapshot.val();
    // Hapus pesan lama biar gak dobel (kecuali typing indicator)
    chatMessages.querySelectorAll('.chat-msg').forEach(el => el.remove());
    
    if (!data) {
      isFirstLoad = false;
      return;
    }
    
    const msgs = Object.entries(data)
      .map(([key, val]) => ({ key, ...val }))
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      
    const now = Date.now();

    msgs.forEach(msg => {
      renderChatMessage(msg);
      
      // TRIGGER DANMAKU: Proteksi ganda (ID pesan & signatur waktu) agar Admin tidak double-render
      if (!isFirstLoad && !seenMessages.has(msg.key)) {
        if (msg.type !== 'system' && !msg.deletedForAll && !localDeletedKeys.has(msg.key)) {
          const sig = `${msg.name}:${(msg.text || '').trim()}`;
          const lastSeenTime = seenDanmakuSignatures.get(sig) || 0;
          if (now - lastSeenTime > 3500) {
            seenDanmakuSignatures.set(sig, now);
            spawnDanmaku(msg);
          }
        }
      }
      
      // Catat pesan ini biar ga di-spawn ulang
      seenMessages.add(msg.key);
    });

    // Load pertama beres, setel false biar pesan berikutnya bisa jadi Danmaku
    isFirstLoad = false;
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });

  // 2. Fungsi Tombol Kirim & Input
  chatSendBtn.addEventListener('click', sendMessage);
  
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { 
      e.preventDefault(); 
      sendMessage(); 
      return; 
    }
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
function showModal(title, desc, onConfirm, confirmText = 'Hapus', cancelText = 'Batal') {
  modalTitle.textContent = title;
  modalDesc.textContent = desc;
  modalConfirm.textContent = confirmText;
  modalCancel.textContent = cancelText;
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
// NAVIGATION GUARD (Mencegah Back langsung ke Login)
// ================================================================
let isExitingRoom = false;

function setupNavigationGuard() {
  // Sisipkan state riwayat baru agar tombol Back browser tertahan
  history.pushState(null, '', window.location.href);

  window.addEventListener('popstate', (e) => {
    if (isExitingRoom) return;

    // Tahan pengguna agar tetap berada di watch.html
    history.pushState(null, '', window.location.href);

    // Tampilkan modal konfirmasi hangat
    showModal(
      'Ingin Keluar dari Ruang Bioskop?',
      'Jika kamu keluar sekarang, sesi nonton dan koneksi dengan pasanganmu akan terputus.',
      () => {
        isExitingRoom = true;
        window.location.href = 'index.html';
      },
      'Ya, Keluar',
      'Tidak, Tetap di Sini'
    );
  });
}

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
    // 1. Kirim sinyal real-time ke Firebase agar diterima Admin
    push(reactionsRef, {
      type: 'popcorn_request',
      from: myName,
      timestamp: serverTimestamp()
    });
    push(chatRef, {
      name: myName, type: 'system',
      text: `🍿 ${myName} meminta jeda sebentar`,
      timestamp: serverTimestamp()
    });
    // Jika admin sendiri yang menekan, langsung pause
    if (isAdmin) {
      video.pause();
      pushVideoState({ playing: false, currentTime: video.currentTime });
    }
    showToast('🍿 Permintaan jeda dikirim ke Admin');
  });

  // Mood buttons — emoji only, send as floating emoji
  document.querySelectorAll('.mood-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const emoji = btn.dataset.mood;
      createEmojiBurst(btn);
      push(reactionsRef, { type: 'emoji', from: myName, emoji, timestamp: serverTimestamp() });
      spawnFloatingEmoji(emoji, 4);
    });
  });

  // Inline reaction buttons
  document.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const emoji = btn.dataset.reaction;
      createEmojiBurst(btn);
      push(reactionsRef, { type: 'emoji', from: myName, emoji, timestamp: serverTimestamp() });
      spawnFloatingEmoji(emoji, 4);
    });
  });

  // Listen to partner reactions & real-time requests
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
      spawnFloatingEmoji(latest.emoji, 6);
      showToast(`${latest.from}: ${latest.emoji}`);
    } else if (latest.type === 'popcorn_request') {
      // 2. Jika pengakses adalah Admin, tampilkan Pop-up konfirmasi Popcorn Break
      if (isAdmin) {
        showModal(
          '🍿 Permintaan Jeda Sebentar',
          `${latest.from} (pacar) sedang minta jeda nonton sebentar. Apakah kamu ingin menjeda video sekarang?`,
          () => {
            // 3. Admin memilih "OK" -> Jeda video & sinkronisasi ke layar Pacar
            if (!video.paused) {
              video.pause();
              pushVideoState({ playing: false, currentTime: video.currentTime });
            }
            push(chatRef, {
              name: myName, type: 'system',
              text: `🍿 Admin menyetujui jeda sebentar`,
              timestamp: serverTimestamp()
            });
            showToast('⏸ Video dijeda untuk Popcorn Break');
          },
          'OK, Jeda Sekarang',
          'Tidak'
        );
      } else {
        showToast(`🍿 ${latest.from} meminta jeda sebentar`);
      }
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

function createEmojiBurst(btnEl) {
  if (!btnEl) return;
  const rect = btnEl.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const colors = ['#D88C9A', '#DDAF6C', '#FFFBF5', '#E5A9B4'];

  for (let i = 0; i < 8; i++) {
    const dot = document.createElement('div');
    dot.className = 'emoji-burst-dot';
    const angle = (i * 45) * (Math.PI / 180);
    const dist = 24 + Math.random() * 14;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    dot.style.cssText = `
      position: fixed;
      left: ${centerX}px;
      top: ${centerY}px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: ${colors[i % colors.length]};
      pointer-events: none;
      z-index: 9999;
      --dx: ${dx}px;
      --dy: ${dy}px;
    `;
    document.body.appendChild(dot);
    dot.addEventListener('animationend', () => dot.remove());
  }
}

function spawnFloatingEmoji(emoji, count = 4) {
  const wrapper = document.querySelector('.video-wrapper');
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'floating-emoji-pop';
      el.textContent = emoji;
      const leftPos = 18 + Math.random() * 64;
      const swayX = (Math.random() > 0.5 ? 1 : -1) * (20 + Math.random() * 45);
      const rot = -22 + Math.random() * 44;
      const scale = 1.05 + Math.random() * 0.45;
      const duration = 2.4 + Math.random() * 0.8;
      el.style.cssText = `
        left: ${leftPos}%;
        bottom: 74px;
        font-size: 26px;
        --sway-x: ${swayX}px;
        --rot: ${rot}deg;
        --pop-scale: ${scale};
        animation-duration: ${duration}s;
      `;
      wrapper.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    }, i * 95);
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
// ANTI-COLLISION 8-LANE DANMAKU SYSTEM
// ================================================================
const DANMAKU_LANES_COUNT = 8;
const danmakuLaneLastUsed = new Array(DANMAKU_LANES_COUNT).fill(0);

function getAvailableDanmakuLane() {
  const now = Date.now();
  // Cari jalur (lane) yang sudah kosong minimal 1,5 detik
  for (let i = 0; i < DANMAKU_LANES_COUNT; i++) {
    if (now - danmakuLaneLastUsed[i] > 1500) {
      danmakuLaneLastUsed[i] = now;
      return i;
    }
  }
  // Jika semua sibuk, pilih jalur yang paling lama tidak dipakai
  let oldestLane = 0;
  let oldestTime = danmakuLaneLastUsed[0];
  for (let i = 1; i < DANMAKU_LANES_COUNT; i++) {
    if (danmakuLaneLastUsed[i] < oldestTime) {
      oldestTime = danmakuLaneLastUsed[i];
      oldestLane = i;
    }
  }
  danmakuLaneLastUsed[oldestLane] = now;
  return oldestLane;
}

function spawnDanmaku(msg) {
  if (!danmakuContainer || !msg || !msg.text) return;

  const el = document.createElement('div');
  const isAdminMsg = msg.role === 'admin';
  el.className = `danmaku-msg ${isAdminMsg ? 'is-admin-danmaku' : ''}`;

  // Pill struktur visual: Nama + Isi Pesan
  el.innerHTML = `
    <span class="danmaku-badge">${isAdminMsg ? '👑 Admin' : '💬'} ${escapeHtml(msg.name)}</span>
    <span class="danmaku-content">${escapeHtml(msg.text)}</span>
  `;

  // Alokasi ke jalur vertikal anti-collision
  const laneIndex = getAvailableDanmakuLane();
  const topPercent = 10 + laneIndex * 8.5; // Jarak rapi antar jalur
  el.style.top = `${topPercent}%`;

  // Durasi mulus (6 sampai 8,5 detik agar mudah dibaca)
  const duration = 6.2 + Math.random() * 1.8;
  el.style.animationDuration = `${duration}s`;

  danmakuContainer.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

// Logika Tombol Toggle Sidebar
if(toggleSidebarBtn) {
    toggleSidebarBtn.addEventListener('click', () => {
      appShell.classList.toggle('hide-sidebar');
      if(appShell.classList.contains('hide-sidebar')) {
        toggleSidebarBtn.style.opacity = '0.5'; // Agak redup kalau chat ditutup
      } else {
        toggleSidebarBtn.style.opacity = '1';
      }
    });
}

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
  setupNavigationGuard();

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