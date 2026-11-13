# Pasang Aplikasi Kursi Bus Santri Lirboyo

Pola sama dengan web Bani Ilyas: halaman statis di GitHub Pages + Google Apps Script sebagai server + Google Sheet sebagai database.

## 1. Server (Google Apps Script)
1. Buat Google Sheet baru (nama bebas, mis. "Kursi Bus Santri").
2. Menu **Extensions > Apps Script**. Hapus isi bawaan, tempel seluruh isi `Code.gs`, simpan.
3. **Project Settings > Script Properties > Add**:
   - `PIN_PENGURUS` = PIN rahasia panitia (jangan dibagikan ke santri)
   - `EMAIL_PANITIA` = email panitia untuk pemberitahuan otomatis (opsional)
4. **Deploy > New deployment > Web app**: Execute as **Me**, Who has access **Anyone**. Izinkan akses saat diminta. Salin **URL Web app** (berakhiran `/exec`).

## 2. Halaman web
1. Buka `index.html`, ganti `GANTI_DENGAN_URL_APPS_SCRIPT` dengan URL tadi.
2. Unggah folder ini ke repo GitHub sebagai folder `bus/` (berisi index.html, manifest.webmanifest, sw.js, icons/).
3. Alamat: alamat web Bani Ilyas diikuti `/bus/`.

## 3. Pengaturan awal
Buka halaman, tekan **Panel pengurus**, masukkan PIN. Isi nomor WA panitia, biaya, rekening, dan atur bus (nama, tujuan, jumlah baris x 4 kursi). Tekan **Simpan pengaturan**.

## 4. Tahun berikutnya
Panel pengurus > ketik tahun baru > **Tambah** > **Simpan pengaturan**. Data tiap tahun terpisah dalam satu Sheet.

## 5. APK
Bungkus alamat `/bus/` dengan cara yang sama seperti BaniIlyas.apk.

## Alur pembayaran
Santri memesan (status *belum*) > menekan "Saya sudah bayar" (status *lapor*, email otomatis ke panitia; tombol WA opsional) > panitia mengecek lalu mengubah status menjadi *lunas* di Panel pengurus.

## Catatan keamanan
- PIN diperiksa di server; tidak ada di kode halaman.
- Santri hanya bisa melihat kursi terisi/kosong dan pesanannya sendiri (lewat nomor kartu). Nama dan kartu orang lain hanya terlihat di Panel pengurus.
- Jika kode `Code.gs` diubah, buat **New deployment** lagi (atau Manage deployments > Edit > New version).
