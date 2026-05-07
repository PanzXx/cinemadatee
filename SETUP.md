# 🎬 CinemaDate — Panduan Setup Lengkap

## Struktur File
```
cinemadate/
├── index.html        ← Halaman login
├── watch.html        ← Halaman nonton
├── vercel.json       ← Config Vercel
├── css/
│   ├── style.css     ← Style halaman login
│   └── watch.css     ← Style halaman nonton
└── js/
    ├── config.js     ← ⚠️ WAJIB DIISI (Firebase + Video URL)
    └── watch.js      ← Logic utama (jangan diubah)
```

---

## LANGKAH 1 — Setup Firebase (10 menit)

1. Buka https://console.firebase.google.com
2. Klik **"Create a project"** → beri nama misal `cinemadate-kalian`
3. **Nonaktifkan Google Analytics** (tidak perlu) → Create Project

### Enable Authentication:
1. Klik menu **Authentication** → Get Started
2. Tab **Sign-in method** → Enable **Anonymous** → Save

### Enable Realtime Database:
1. Klik menu **Realtime Database** → Create Database
2. Pilih lokasi: **asia-southeast1 (Singapore)** (paling dekat)
3. Pilih mode: **Start in test mode** → Enable
4. ⚠️ Ganti rules di tab "Rules" dengan ini agar aman:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    }
  }
}
```

### Dapatkan Config Firebase:
1. Klik ikon ⚙️ → **Project Settings**
2. Scroll ke bawah ke bagian **"Your apps"**
3. Klik ikon `</>` (Web) → Register app → nama bebas → Register
4. Copy nilai `firebaseConfig` → paste ke `js/config.js`

---

## LANGKAH 2 — Host Video (GRATIS)

### Opsi A: Internet Archive (TERBAIK, Unlimited, Permanen)
1. Buka https://archive.org/upload
2. Login/daftar gratis
3. Upload file MP4 kamu
4. Tunggu processing selesai
5. Buka halaman item → klik kanan video → "Copy video address"
6. Paste ke `VIDEO_URL` di `config.js`

### Opsi B: Google Drive (Mudah, untuk <100MB)
1. Upload MP4 ke Google Drive
2. Klik kanan → "Share" → "Anyone with the link" → Copy link
3. Ambil ID dari URL: `https://drive.google.com/file/d/[ID_INI]/view`
4. Format URL: `https://drive.google.com/uc?export=download&id=[ID_INI]`
5. ⚠️ Catatan: Google Drive sering block streaming untuk file besar karena "quota exceeded"

### Opsi C: Cloudflare Stream (Kualitas terbaik, gratis 1000 menit)
1. Daftar di https://dash.cloudflare.com
2. Menu **Stream** → Upload video
3. Setelah upload, copy **HLS URL** atau **MP4 URL**
4. Paste ke `VIDEO_URL` di `config.js`

---

## LANGKAH 3 — Isi config.js

Buka file `js/config.js` dan isi semua bagian yang ada tulisan `GANTI_`:

```js
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSy...",           // dari Firebase Console
  authDomain: "nama-project.firebaseapp.com",
  databaseURL: "https://nama-project-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "nama-project",
  storageBucket: "nama-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123:web:abc123"
};

export const ADMIN_PIN = "pin-rahasia-kamu";  // Tulis PIN yang mudah kamu ingat

export const VIDEO_URL = "https://archive.org/download/...";  // URL video kamu

export const MOVIE_TITLE = "Judul Film Kita 🎬";  // Nama filmnya

export const ROOM_ID = "our-private-cinema-room";  // Bisa dibiarkan default
```

---

## LANGKAH 4 — Deploy ke Vercel (Gratis)

1. Buat akun di https://vercel.com (login dengan GitHub)
2. Install Vercel CLI: `npm i -g vercel` (atau drag folder ke Vercel dashboard)
3. Di terminal, masuk ke folder project: `cd cinemadate`
4. Jalankan: `vercel`
5. Ikuti instruksi → pilih "deploy" → done!
6. Kamu akan dapat URL seperti: `https://cinemadate-xxx.vercel.app`

**Alternatif tanpa CLI:** Drag & drop folder ke https://vercel.com/new

---

## CARA PAKAI

### Kamu (Admin):
1. Buka URL website
2. Isi nama kamu
3. Pilih role **Admin**
4. Masukkan PIN yang sudah kamu set
5. Klik "Masuk ke Bioskop"
6. Kamu bisa kontrol video: play, pause, seek

### Pacar kamu (Viewer):
1. Buka URL yang sama
2. Isi namanya
3. Pilih role **Viewer** (tanpa PIN)
4. Klik masuk
5. Video akan tersinkronisasi otomatis mengikuti kontrol kamu

---

## FITUR YANG TERSEDIA

| Fitur | Admin | Viewer |
|-------|-------|--------|
| Play/Pause | ✅ | 🔒 (otomatis sinkron) |
| Seek/Geser Timeline | ✅ | 🔒 (otomatis sinkron) |
| Skip 10s | ✅ | 🔒 |
| Volume | ✅ | ✅ (lokal) |
| Chat | ✅ | ✅ |
| Send Hearts | ✅ | ✅ |
| Mood Reaction | ✅ | ✅ |
| Popcorn Break | ✅ | ✅ |
| Inline Reactions | ✅ | ✅ |
| Status Online | ✅ | ✅ |

---

## TROUBLESHOOTING

**Video tidak muncul?**
→ Cek URL di `config.js`, pastikan bisa diakses langsung di browser
→ Pastikan CORS diizinkan (Internet Archive & Cloudflare Stream sudah OK)

**Firebase error?**
→ Pastikan Anonymous Auth sudah diaktifkan
→ Cek Realtime Database rules sudah diubah
→ Pastikan `databaseURL` diisi dengan benar (lihat di console Firebase)

**Viewer tidak tersinkronisasi?**
→ Admin harus aktif di halaman (jangan minimize tab)
→ Pastikan keduanya sudah login dengan role yang benar

**Video Google Drive "quota exceeded"?**
→ Pindah ke Internet Archive — ini solusi terbaik untuk video besar

---

## KEAMANAN

- Website ini **TIDAK** memiliki password untuk masuk ke halaman (URL-nya yang jadi "kunci")
- Hanya Admin yang bisa kontrol video
- Firebase rules sudah dikonfigurasi agar hanya user yang ter-authenticated yang bisa akses data
- Jangan share URL ke orang lain selain pacar kamu 💕

---

*Dibuat dengan ❤️ — Selamat nonton bareng!*
