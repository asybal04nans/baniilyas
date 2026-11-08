// Mengambil daftar harga prabayar dari Digiflazz, menambah margin, lalu menulis toko/harga.json.
// Kunci API dan margin hanya dibaca dari variabel lingkungan (GitHub Secrets dan Variables), tidak pernah ditulis ke berkas.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const USERNAME = process.env.DIGIFLAZZ_USERNAME || '';
const KEY = process.env.DIGIFLAZZ_KEY || '';
const AKTIF = String(process.env.HARGA_AKTIF || '').toLowerCase() === 'true';
const PERSEN = Number(process.env.MARGIN_PERSEN || 0);
const RUPIAH = Number(process.env.MARGIN_RUPIAH || 0);
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
function harga(modal) {
  const jual = modal * (1 + PERSEN / 100) + RUPIAH;
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
  for (const op of Object.keys(pulsa).sort()) {
    keluar.pulsa[op] = murahPerLabel(pulsa[op]).sort((a, b) => a.nilai - b.nilai)
      .map((x) => ({ label: x.label, harga: harga(x.modal) }));
  }
  for (const op of Object.keys(data).sort()) {
    keluar.data[op] = murahPerLabel(data[op]).sort((a, b) => a.modal - b.modal).slice(0, DATA_MAKS)
      .map((x) => ({ label: x.label, harga: harga(x.modal) }));
  }
  keluar.token = murahPerLabel(token).sort((a, b) => a.nilai - b.nilai)
    .map((x) => ({ label: x.label, harga: harga(x.modal) }));
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
    if (!(PERSEN > 0 || RUPIAH > 0)) {
      throw new Error('Margin belum diisi. Isi MARGIN_PERSEN atau MARGIN_RUPIAH di GitHub Variables agar harga jual tidak sama dengan harga modal.');
    }
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
