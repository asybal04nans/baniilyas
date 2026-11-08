// Mengambil daftar harga prabayar dari Digiflazz, menambah margin, lalu menulis toko/harga.json.
// Kunci API dan margin hanya dibaca dari variabel lingkungan (GitHub Secrets dan Variables), tidak pernah ditulis ke berkas.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const USERNAME = process.env.DIGIFLAZZ_USERNAME || '';
const KEY = process.env.DIGIFLAZZ_KEY || '';
const AKTIF = String(process.env.HARGA_AKTIF || '').toLowerCase() === 'true';
// Margin per jenis (pulsa, data, token). Yang tidak diisi memakai MARGIN_PERSEN dan MARGIN_RUPIAH umum.
function angka(nama) {
  const v = process.env[nama];
  if (v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return isFinite(n) && n >= 0 ? n : null;
}
const MARGIN = {};
for (const jenis of ['pulsa', 'data', 'token']) {
  const J = jenis.toUpperCase();
  const persen = angka('MARGIN_' + J + '_PERSEN') ?? angka('MARGIN_PERSEN') ?? 0;
  const rupiah = angka('MARGIN_' + J + '_RUPIAH') ?? angka('MARGIN_RUPIAH') ?? 0;
  MARGIN[jenis] = { persen, rupiah, ok: persen > 0 || rupiah > 0 };
}
const BULAT = Number(process.env.PEMBULATAN || 100) || 100;
const DATA_MAKS = Number(process.env.DATA_MAKS || 30) || 30;
const KELUAR = process.env.HARGA_KELUAR || 'toko/harga.json';

const OPERATOR = [
  ['TELKOMSEL', 'Telkomsel'], ['INDOSAT', 'Indosat'], ['SMARTFREN', 'Smartfren'],
  ['AXIS', 'Axis'], ['BYU', 'by.U'], ['THREE', 'Tri'], ['TRI', 'Tri'], ['XL', 'XL']
];
function operatorDari(brand) {
  const b = String(brand || '').toUpperCase().replace(/[^A-Z]/g, '');
  for (const [kunci, nama] of OPERATOR) if (b === kunci || b.startsWith(kunci)) return nama;
  return '';
}
function nominalDari(nama) {
  const m = String(nama || '').match(/(\d{1,3}(?:[.,]\d{3})+|\d{4,})/);
  if (!m) return 0;
  const n = parseInt(m[1].replace(/[.,]/g, ''), 10);
  return n >= 1000 && n <= 10000000 ? n : 0;
}
const idr = (n) => n.toLocaleString('id-ID');
function harga(modal, jenis) {
  const m = MARGIN[jenis];
  const jual = modal * (1 + m.persen / 100) + m.rupiah;
  return Math.ceil(jual / BULAT) * BULAT;
}
function tersedia(p) {
  return p.buyer_product_status !== false && p.seller_product_status !== false;
}
function murahPerLabel(daftar) {
  const peta = new Map();
  for (const x of daftar) {
    const lama = peta.get(x.label);
    if (!lama || x.modal < lama.modal) peta.set(x.label, x);
  }
  return [...peta.values()];
}

async function ambil() {
  const sign = createHash('md5').update(USERNAME + KEY + 'pricelist').digest('hex');
  const res = await fetch('https://api.digiflazz.com/v1/price-list', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cmd: 'prepaid', username: USERNAME, sign })
  });
  const teks = await res.text();
  let j;
  try { j = JSON.parse(teks); } catch { throw new Error('Balasan Digiflazz bukan JSON (status ' + res.status + ').'); }
  if (!j || !Array.isArray(j.data)) {
    const d = j && j.data;
    const pesan = d && (d.message || d.rc) ? (d.rc || '') + ' ' + (d.message || '') : 'format data tidak dikenali';
    throw new Error('Digiflazz menolak permintaan: ' + pesan.trim());
  }
  return j.data;
}

function susun(produk) {
  const pulsa = {}, data = {}, token = [];
  for (const p of produk) {
    if (!tersedia(p)) continue;
    const kat = String(p.category || '').toLowerCase();
    const nama = String(p.product_name || '');
    const modal = Number(p.price);
    if (!isFinite(modal) || modal <= 0) continue;
    const op = operatorDari(p.brand);
    if (kat === 'pulsa' && op) {
      if (/transfer|perdana|voucher|aktivasi|masa aktif/i.test(nama)) continue;
      const n = nominalDari(nama);
      if (!n) continue;
      (pulsa[op] = pulsa[op] || []).push({ label: idr(n), nilai: n, modal });
    } else if (kat === 'data' && op) {
      (data[op] = data[op] || []).push({ label: nama, modal });
    } else if (kat === 'pln' || String(p.brand || '').toUpperCase() === 'PLN') {
      if (/pasca|tagihan|nontaglis|non-taglis/i.test(nama)) continue;
      const n = nominalDari(nama);
      if (!n) continue;
      token.push({ label: idr(n), nilai: n, modal });
    }
  }
  const keluar = { pulsa: {}, data: {}, token: [] };
  // Jenis yang marginnya belum diisi dilewati: halaman tetap menulis "Harga via WhatsApp" untuk jenis itu.
  if (MARGIN.pulsa.ok) for (const op of Object.keys(pulsa).sort()) {
    keluar.pulsa[op] = murahPerLabel(pulsa[op]).sort((a, b) => a.nilai - b.nilai)
      .map((x) => ({ label: x.label, harga: harga(x.modal, 'pulsa') }));
  }
  if (MARGIN.data.ok) for (const op of Object.keys(data).sort()) {
    keluar.data[op] = murahPerLabel(data[op]).sort((a, b) => a.modal - b.modal).slice(0, DATA_MAKS)
      .map((x) => ({ label: x.label, harga: harga(x.modal, 'data') }));
  }
  if (MARGIN.token.ok) keluar.token = murahPerLabel(token).sort((a, b) => a.nilai - b.nilai)
    .map((x) => ({ label: x.label, harga: harga(x.modal, 'token') }));
  return keluar;
}

async function bacaLama() {
  try { return JSON.parse(await readFile(KELUAR, 'utf8')); } catch { return null; }
}
const tanpaWaktu = (o) => JSON.stringify({ ...o, diperbarui: undefined });

async function main() {
  let hasil;
  if (!AKTIF) {
    hasil = { aktif: false };
    console.log('HARGA_AKTIF belum true: harga tidak ditampilkan di halaman.');
  } else {
    if (!USERNAME || !KEY) throw new Error('DIGIFLAZZ_USERNAME dan DIGIFLAZZ_KEY belum diisi di GitHub Secrets.');
    const tanpaMargin = Object.keys(MARGIN).filter((j) => !MARGIN[j].ok);
    if (tanpaMargin.length === 3) {
      throw new Error('Margin belum diisi. Isi MARGIN_PULSA_PERSEN, MARGIN_DATA_PERSEN, MARGIN_TOKEN_RUPIAH (atau MARGIN_PERSEN dan MARGIN_RUPIAH untuk semua) di GitHub Variables agar harga jual tidak sama dengan harga modal.');
    }
    for (const j of tanpaMargin) console.log('Margin ' + j + ' belum diisi: harga ' + j + ' tidak ditampilkan.');
    const produk = await ambil();
    const s = susun(produk);
    const jumlah = Object.values(s.pulsa).flat().length + Object.values(s.data).flat().length + s.token.length;
    if (!jumlah) throw new Error('Tidak ada produk pulsa, data, atau PLN yang cocok. Harga lama dibiarkan.');
    hasil = { aktif: true, ...s };
    console.log('Pulsa:', Object.values(s.pulsa).flat().length, '| Data:', Object.values(s.data).flat().length, '| Token:', s.token.length);
  }
  const lama = await bacaLama();
  if (lama && tanpaWaktu(lama) === tanpaWaktu(hasil)) { console.log('Tidak ada perubahan harga.'); return; }
  hasil = { diperbarui: new Date().toISOString(), ...hasil };
  await writeFile(KELUAR, JSON.stringify(hasil, null, 1) + '\n');
  console.log('Menulis', KELUAR);
}

main().catch((e) => { console.error('GAGAL:', e.message); process.exit(1); });
