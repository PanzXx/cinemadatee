// ================================================================
// 🔧 CONFIG FILE — WAJIB DIISI SEBELUM DEPLOY!
// ================================================================
// Ikuti panduan SETUP.md untuk mendapatkan nilai-nilai ini.

export const FIREBASE_CONFIG = {
    apiKey: "AIzaSyB_NfgytlcpIHwxI8lgFz8_lfgLODNT8ek",
    authDomain: "cinemadate-3d85a.firebaseapp.com",
    databaseURL: "https://cinemadate-3d85a-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "cinemadate-3d85a",
    storageBucket: "cinemadate-3d85a.firebasestorage.app",
    messagingSenderId: "865797642348",
    appId: "1:865797642348:web:f03b9d69c8d7065f86e049"
};

// PIN untuk masuk sebagai Admin (kamu yang pegang remote)
// Ganti dengan PIN yang kamu inginkan!
export const ADMIN_PIN = "121230";

// URL video kamu
// Cara dapat URL Google Drive:
// 1. Upload MP4 ke Google Drive
// 2. Klik kanan → "Get link" → "Anyone with the link"
// 3. Copy ID dari URL: https://drive.google.com/file/d/[INI_ID_NYA]/view
// 4. Format URL streaming: https://drive.google.com/uc?export=download&id=ID_KAMU
//    (untuk file <100MB) ATAU gunakan embedded player untuk file besar:
//    https://drive.google.com/file/d/ID_KAMU/preview
//
// REKOMENDASI TERBAIK: Gunakan Cloudflare Stream (gratis 1000 menit)
// Atau letakkan MP4 di folder /public project Vercel kamu (max 4.5MB per file... kurang ya)
// Solusi TERBAIK untuk file besar: archive.org (Internet Archive) - GRATIS UNLIMITED!
// Upload di: https://archive.org/upload
// Lalu copy direct link MP4-nya

//export const VIDEO_URL = "https://ia601805.us.archive.org/9/items/d-21-fun-lust-caution-2007/D21_FUN-Lust-caution-2007.mp4";
export const VIDEO_URL = "https://ia601804.us.archive.org/4/items/family-switch-2023-webdl_X_c9a477a7/family-switch-2023-webdl_X_c9a477a7.mp4";

// Nama film (untuk ditampilkan di UI)
export const MOVIE_TITLE = "Family Switch";

// Room ID (ubah jika ingin sesi baru)
export const ROOM_ID = "2032023";
