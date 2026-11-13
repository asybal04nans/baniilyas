/**
 * Kursi Bus Kepulangan Santri Lirboyo - backend Google Apps Script.
 * Data disimpan di Google Sheet (tab "Pesanan"). Pengaturan di Script Properties.
 * Properti yang perlu diisi (Project Settings > Script Properties):
 *   PIN_PENGURUS  = PIN rahasia panitia (wajib)
 *   EMAIL_PANITIA = email penerima pemberitahuan pesanan baru/laporan bayar (opsional)
 */
const NAMA_SHEET = 'Pesanan';

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let s = ss.getSheetByName(NAMA_SHEET);
  if (!s) {
    s = ss.insertSheet(NAMA_SHEET);
    s.appendRow(['Tahun', 'Bus', 'Kursi', 'Nama', 'Kartu', 'Hash', 'Status', 'Kode', 'Waktu']);
    s.setFrozenRows(1);
    s.getRange('A:I').setNumberFormat('@');
  }
  return s;
}
function props_() { return PropertiesService.getScriptProperties(); }
function cfgDefault_() {
  const y = new Date().getFullYear();
  const b = {}; b[y] = [{ id: 'bus1', nama: 'Bus 1', tujuan: '', baris: 10 }];
  return { tahun: [y], aktif: y, bus: b, wa: '', harga: '', infoBayar: '' };
}
function cfg_() {
  const raw = props_().getProperty('CONFIG');
  return raw ? JSON.parse(raw) : cfgDefault_();
}
function hash_(tahun, kartu) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    'lirboyo|' + tahun + '|' + String(kartu).trim().toLowerCase());
  return d.map(function (x) { return ('0' + (x & 0xff).toString(16)).slice(-2); }).join('');
}
function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function rows_(tahun) {
  const v = sheet_().getDataRange().getValues();
  v.shift();
  const out = [];
  v.forEach(function (r, i) {
    if (String(r[0]) === String(tahun)) {
      out.push({ row: i + 2, tahun: String(r[0]), bus: String(r[1]), no: Number(r[2]), nama: String(r[3]),
        kartu: String(r[4]), h: String(r[5]), status: String(r[6]), kode: String(r[7]), ts: String(r[8]) });
    }
  });
  return out;
}
function kirimEmail_(judul, isi) {
  const to = props_().getProperty('EMAIL_PANITIA');
  if (!to) return;
  try { MailApp.sendEmail(to, judul, isi); } catch (e) {}
}
function cekAdmin_(b) {
  const pin = props_().getProperty('PIN_PENGURUS');
  if (!pin || String(b.pin) !== String(pin)) { Utilities.sleep(1500); throw new Error('PIN salah'); }
}

function doGet(e) {
  try {
    const c = cfg_();
    const tahun = (e.parameter && e.parameter.tahun) || c.aktif;
    const kursi = rows_(tahun).map(function (r) { return { bus: r.bus, no: r.no, status: r.status }; });
    return out_({ ok: true, config: c, tahun: Number(tahun), kursi: kursi });
  } catch (err) { return out_({ ok: false, error: String(err.message || err) }); }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const b = JSON.parse(e.postData.contents);
    lock.waitLock(20000);
    const c = cfg_();
    const tahun = String(b.tahun || c.aktif);
    switch (b.aksi) {
      case 'pesan': return out_(pesan_(b, c, tahun));
      case 'cek': return out_(cek_(b, tahun));
      case 'lapor': return out_(lapor_(b, tahun));
      case 'daftar': cekAdmin_(b); return out_({ ok: true, rows: rows_(tahun) });
      case 'status': cekAdmin_(b); return out_(setStatus_(b, tahun));
      case 'hapus': cekAdmin_(b); return out_(hapus_(b, tahun));
      case 'simpanConfig': cekAdmin_(b); return out_(simpanConfig_(b));
      default: return out_({ ok: false, error: 'Aksi tidak dikenal' });
    }
  } catch (err) {
    return out_({ ok: false, error: String(err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function pesan_(b, c, tahun) {
  const nama = String(b.nama || '').trim();
  const kartu = String(b.kartu || '').trim();
  const no = Number(b.no);
  if (nama.length < 3 || nama.length > 80) return { ok: false, error: 'Nama tidak valid' };
  if (!/^[A-Za-z0-9\-\/\.]{3,30}$/.test(kartu)) return { ok: false, error: 'Nomor kartu tidak valid' };
  const bl = (c.bus[tahun] || []).filter(function (x) { return x.id === b.bus; })[0];
  if (!bl) return { ok: false, error: 'Bus tidak ditemukan' };
  if (!(no >= 1 && no <= bl.baris * 4) || Math.floor(no) !== no) return { ok: false, error: 'Kursi tidak valid' };
  const h = hash_(tahun, kartu);
  const ada = rows_(tahun);
  if (ada.some(function (r) { return r.bus === b.bus && r.no === no; })) return { ok: false, error: 'Kursi sudah terisi, pilih kursi lain' };
  if (ada.some(function (r) { return r.h === h; })) return { ok: false, error: 'Nomor kartu ini sudah memesan kursi' };
  const kode = 'LB' + tahun + '-' + String(b.bus).toUpperCase() + '-' + no;
  const s = sheet_();
  const rg = s.getRange(s.getLastRow() + 1, 1, 1, 9);
  rg.setNumberFormat('@');
  rg.setValues([[tahun, b.bus, no, nama, kartu, h, 'belum', kode, new Date().toISOString()]]);
  kirimEmail_('Pesanan kursi baru ' + kode, nama + ' (kartu ' + kartu + ') memesan ' + bl.nama + ' kursi ' + no + ' tahun ' + tahun + '. Status: menunggu pembayaran.');
  return { ok: true, kode: kode, bus: b.bus, no: no, status: 'belum', nama: nama };
}

function cek_(b, tahun) {
  const kartu = String(b.kartu || '').trim();
  if (!kartu) return { ok: true, pesanan: null };
  const h = hash_(tahun, kartu);
  const r = rows_(tahun).filter(function (x) { return x.h === h; })[0];
  return { ok: true, pesanan: r ? { bus: r.bus, no: r.no, status: r.status, kode: r.kode, nama: r.nama } : null };
}

function lapor_(b, tahun) {
  const kartu = String(b.kartu || '').trim();
  const h = hash_(tahun, kartu);
  const r = rows_(tahun).filter(function (x) { return x.h === h; })[0];
  if (!r) return { ok: false, error: 'Pesanan tidak ditemukan' };
  if (r.status === 'lunas') return { ok: true, status: 'lunas' };
  sheet_().getRange(r.row, 7).setValue('lapor');
  kirimEmail_('Santri melapor sudah bayar: ' + r.kode, r.nama + ' (kartu ' + r.kartu + ') melapor sudah membayar ' + r.bus + ' kursi ' + r.no + '. Mohon diverifikasi di Panel pengurus.');
  return { ok: true, status: 'lapor' };
}

function setStatus_(b, tahun) {
  if (['belum', 'lapor', 'lunas'].indexOf(b.status) < 0) return { ok: false, error: 'Status tidak valid' };
  const r = rows_(tahun).filter(function (x) { return x.bus === b.bus && x.no === Number(b.no); })[0];
  if (!r) return { ok: false, error: 'Pesanan tidak ditemukan' };
  sheet_().getRange(r.row, 7).setValue(b.status);
  return { ok: true };
}

function hapus_(b, tahun) {
  const r = rows_(tahun).filter(function (x) { return x.bus === b.bus && x.no === Number(b.no); })[0];
  if (!r) return { ok: false, error: 'Pesanan tidak ditemukan' };
  sheet_().deleteRow(r.row);
  return { ok: true };
}

function simpanConfig_(b) {
  const c = b.config;
  if (!c || !Array.isArray(c.tahun) || typeof c.bus !== 'object') return { ok: false, error: 'Pengaturan tidak valid' };
  const bersih = {
    tahun: c.tahun.map(Number), aktif: Number(c.aktif), bus: {},
    wa: String(c.wa || '').slice(0, 20), harga: String(c.harga || '').slice(0, 80), infoBayar: String(c.infoBayar || '').slice(0, 200)
  };
  Object.keys(c.bus).forEach(function (y) {
    bersih.bus[y] = c.bus[y].map(function (x) {
      return { id: String(x.id).replace(/[^a-z0-9]/gi, '').slice(0, 20), nama: String(x.nama).slice(0, 40),
        tujuan: String(x.tujuan || '').slice(0, 60), baris: Math.max(1, Math.min(20, Number(x.baris) || 10)) };
    });
  });
  props_().setProperty('CONFIG', JSON.stringify(bersih));
  return { ok: true };
}
