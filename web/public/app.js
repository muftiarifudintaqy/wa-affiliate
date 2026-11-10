/* Inbox Affiliate — tampilan mirip WhatsApp Web. Semua aksi tulis lewat antrean server (maks 1 per 2 detik per nomor). */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const app = $('#app'); if (!app) return;
  let CSRF = app.dataset.csrf;
  // [10 Nov] akun LIHAT SAJA: baca chat, Ringkasan & Waktu Balas; tanpa kolom tulis, menu aksi pesan, Hubungkan & Audit (server juga menolak)
  const LIHAT = app.dataset.peran !== 'penuh';
  const S = { nomor: [], nomorAktif: 'semua', chats: [], chat: null, pesan: [], kutip: null, hal: 'inbox', jejak: '', palingLama: 0 };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const tglPanjang = (t) => { const d = new Date(t.slice(0, 10) + 'T00:00:00'); return HARI[d.getDay()] + ', ' + d.getDate() + ' ' + BULAN[d.getMonth()] + ' ' + d.getFullYear(); };
  const jamDetik = (t) => t ? t.slice(11, 19) : '';
  const nomorHp = (jid) => { const n = String(jid || '').split('@')[0].split(':')[0]; return /^\d+$/.test(n) ? '+' + n : n; };
  // [28 Okt] nama seperti WhatsApp; nomor kecil; LID tanpa nomor = "nomor tersembunyi" (bukan angka LID); foto kontak atau inisial
  const namaChat = (c) => c.nama || (c.nomor ? '+' + c.nomor : (c.jenis === 'grup' ? 'Grup' : 'Nomor tersembunyi'));
  const nomorChat = (c) => c.jenis === 'grup' ? 'Grup' : (c.nomor ? '+' + c.nomor : 'nomor tersembunyi');
  const avaChat = (c) => { const n = namaChat(c), ini = ((n.replace(/^\+/, '').match(/[A-Za-z0-9]/g) || ['#']).slice(0, n.match(/\s/) ? 1 : 2).join('') + ((n.split(/\s+/)[1] || '').match(/[A-Za-z]/) || [''])[0]).toUpperCase().slice(0, 2);
    return c.foto_ada == 1 ? `<img src="/media.php?kontak=${c.id}&v=${c.foto_v || 0}" alt="" loading="lazy">` : esc(ini); };
  const durasi = (s) => { if (s == null) return '–'; s = Number(s); return s < 60 ? s + ' dtk' : s < 3600 ? Math.round(s / 60) + ' mnt' : (s / 3600).toFixed(1).replace('.', ',') + ' jam'; };
  // [10 Nov] waktu balas: detik di jam kerja (Sen-Jum 08-17, Sab 08-12, WIB) — sama dengan detik_kerja() di server
  const WIB = 7 * 3600e3, tsWib = (t) => Date.parse(String(t).replace(' ', 'T') + '+07:00');
  function detikKerja(a, b) {
    if (b <= a) return 0;
    let tot = 0; const d0 = new Date(a + WIB); let d = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate()) - WIB;   // tengah malam WIB hari a
    for (; d <= b; d += 86400e3) {
      const h = new Date(d + WIB).getUTCDay(); if (h === 0) continue;
      const x = Math.max(a, d + 8 * 3600e3), y = Math.min(b, d + (h === 6 ? 12 : 17) * 3600e3); if (y > x) tot += y - x;
    }
    return Math.round(tot / 1000);
  }
  // durasi jam kerja: "25m", "1j 20m"; ≥ 100 jam → "N hari kerja" (1 hari kerja = 9 jam) supaya chat yang ditinggal lama tetap terbaca
  const lama = (s) => { if (s == null) return '–'; s = Number(s); if (s < 60) return '< 1m'; const m = Math.round(s / 60); if (m >= 6000) return Math.round(m / 540) + ' hari kerja'; return m < 60 ? m + 'm' : Math.floor(m / 60) + 'j' + (m % 60 ? ' ' + (m % 60) + 'm' : ''); };
  const toast = (t) => { const e = $('#toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => e.hidden = true, 3500); };

  async function api(aksi, p, form) {
    const opsi = { credentials: 'same-origin', headers: { 'X-CSRF': CSRF } };
    let url = '/api.php?aksi=' + aksi;
    if (form) { opsi.method = 'POST'; opsi.body = form; }
    else if (p && p.__post) { opsi.method = 'POST'; const f = new FormData(); Object.keys(p).forEach(k => k !== '__post' && f.append(k, p[k])); opsi.body = f; }
    else if (p) url += '&' + new URLSearchParams(p).toString();
    let r;
    try { r = await fetch(url, opsi); } catch (e) { offline(true); return { ok: false, offline: true, pesan: 'Tidak ada koneksi' }; }   // [10 Nov] PWA: jaringan putus
    const j = await r.json().catch(() => ({ ok: false, pesan: 'Server tidak menjawab' }));
    offline(!!j.offline);
    if (j.login) { location.href = '/'; throw new Error('sesi habis'); }
    if (j.csrf) CSRF = j.csrf;
    return j;
  }
  // [10 Nov] PWA: penanda "Tidak ada koneksi" (data terakhir tetap tampil, otomatis coba lagi)
  function offline(ya) {
    let b = $('#offline');
    if (!ya) { if (b) b.hidden = true; return; }
    if (!b) { b = document.createElement('div'); b.id = 'offline'; b.className = 'offline'; b.setAttribute('role', 'status'); b.textContent = 'Tidak ada koneksi — mencoba lagi otomatis'; document.body.appendChild(b); }
    b.hidden = false;
  }
  addEventListener('offline', () => offline(true));
  addEventListener('online', () => { offline(false); S.jejakChats = ''; muatChats(); });
  async function antre(aksi, p, form) {
    const j = await api(aksi, p, form);
    if (!j.ok) { toast(j.pesan || 'Gagal'); return null; }
    const id = j.antrean;
    [3000, 8000, 20000].forEach(ms => setTimeout(async () => { const s = await api('antrean', { id }); if (s.antrean && s.antrean.status === 'gagal' && !antre['g' + id]) { antre['g' + id] = 1; toast('Gagal: ' + (s.antrean.galat || aksi)); } }, ms));
    setTimeout(muatPesan, 2500);
    return id;
  }

  // ---------------------------------------------------------------- rel nomor & navigasi halaman
  async function muatNomor() {
    const urut = S.urutNomor = (S.urutNomor || 0) + 1;
    const j = await api('nomor'); if (!j.ok || urut !== S.urutNomor) return;
    S.nomor = j.nomor; renderRel();
    if (S.hal === 'hubungkan') renderHubungkan();
  }
  // [28 Okt] nama 6 slot HANYA dari label manual di halaman Hubungkan; kosong = "Aff N". Tidak pernah dari nama profil WA (nama_wa) atau nomor HP.
  const labelSlot = (n) => String(n.label || '').trim() || 'Aff ' + n.id;
  // nomor WA akun yang tertaut di slot (bukan nomor kontak); slot yang belum pernah tertaut → kosong
  const nomorSlot = (n) => n.jid ? nomorHp(n.jid) : '';
  // [10 Nov] 2 slot bisa berlabel sama ("Indah Aff" …9944 & …6646): di semua tabel & chip ditulis label + 4 digit akhir nomor
  const namaSlot = (n) => labelSlot(n) + (nomorSlot(n) ? ' …' + nomorSlot(n).slice(-4) : '');
  const namaNomorId = (id, cadangan) => { const n = S.nomor.find(x => String(x.id) === String(id)); return n ? namaSlot(n) : (cadangan || ''); };
  // label pendek "Aff 1" untuk sidebar, inisial dari nama di belakang tanda "-" (mis. "Aff 1 - Natasya" → N)
  const labelPendek = (l) => String(l || '').split(/\s+[-–—]\s+/)[0].slice(0, 10);
  const inisial = (n) => { const l = labelSlot(n), b = l.split(/\s+[-–—]\s+/)[1]; return b ? b.trim()[0].toUpperCase() : 'A' + ((l.match(/\d+/) || [n.id])[0]); };
  const foto = (n) => n.ada_foto == 1 ? `<img src="/media.php?profil=${n.id}&v=${n.foto_v || 0}" alt="">` : esc(inisial(n));
  const STATUS = { terhubung: 'Terhubung', terputus: 'Terputus', perlu_scan: 'Menunggu scan QR', menghubungkan: 'Menghubungkan', belum: 'Belum ditautkan' };
  // [28 Okt] keadaan tampilan: nomor yang pernah tertaut (jid ada) tapi tidak tersambung = "Terputus"; riwayat & foto tetap bisa dibaca
  const keadaan = (n) => n.status === 'terhubung' ? 'terhubung' : n.status === 'menghubungkan' ? 'menghubungkan' : (n.status === 'perlu_scan' && n.qr) ? 'perlu_scan' : n.jid ? 'terputus' : 'belum';
  const IKON_PUTUS = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 2.4 9.4M8 12h3M3 3l18 18"/></svg>';
  const alasanPutus = (n) => { const a = String(n.alasan_putus || '');
    if (a === 'dilepas dari web' || (a === '401' && n.status === 'belum')) return 'dilepas dari web';
    if (a.startsWith('401')) return 'perangkat tertaut dihapus dari HP';
    if (a.startsWith('nomor beda')) return 'nomor lain dipindai ke slot ini — ditolak (' + a.replace(/^nomor beda\s*/, '') + ')';
    return a ? 'koneksi putus (kode ' + a + ')' : ''; };
  function renderRel() {
    $('#relNomor').innerHTML = `<button class="rel-n ${S.nomorAktif === 'semua' ? 'on' : ''}" data-n="semua" title="Semua nomor"><span class="foto">∑</span><span class="lbl">Semua</span></button>` +
      S.nomor.map(n => { const k = keadaan(n); return `<button class="rel-n ${String(S.nomorAktif) === String(n.id) ? 'on' : ''} ${k === 'terputus' ? 'putus' : ''}" data-n="${n.id}" title="${esc(labelSlot(n))} · ${esc(STATUS[k])}${n.jid ? ' · ' + esc(nomorHp(n.jid)) : ''} · belum dibalas ${Number(n.chat_belum_dibalas) || 0}${k === 'terputus' ? ' · mode baca, scan ulang untuk balas' : ''}">
        <span class="foto">${foto(n)}</span><i class="${k}">${k === 'terputus' ? IKON_PUTUS : ''}</i>${Number(n.chat_belum_dibalas) > 0 ? '<b>' + n.chat_belum_dibalas + '</b>' : ''}<span class="lbl">${esc(labelPendek(labelSlot(n)))}</span>${nomorSlot(n) ? `<span class="no"><span class="no-penuh">${esc(nomorSlot(n))}</span><span class="no-pendek">…${esc(nomorSlot(n).slice(-4))}</span></span>` : ''}${k === 'terputus' ? '<span class="lbl-putus">Terputus</span>' : ''}</button>`; }).join('');
    const n = S.nomor.find(x => String(x.id) === String(S.nomorAktif));
    const judulAkun = (n) => { const l = labelSlot(n), sisa = l.split(/\s+[-–—]\s+/).slice(1).join(' - '); return sisa ? labelPendek(l) + ' — ' + sisa : l; };
    $('#judulNomor').innerHTML = n ? esc(judulAkun(n)) + (nomorSlot(n) ? ` <span class="judul-no">· ${esc(nomorSlot(n))}</span>` : '') : 'Semua nomor';
    renderRingkas(judulAkun);
    $('#statusNomor').innerHTML = n ? `<span class="st ${keadaan(n)}">${keadaan(n) === 'terputus' ? IKON_PUTUS + ' ' : ''}${esc(STATUS[keadaan(n)])}</span>` : '';
    renderKartu();
  }
  // baris ringkas di atas daftar chat: belum dibalas total + per akun (klik = pilih akun)
  function renderRingkas(judulAkun) {
    const box = $('#ringkas'); if (!box) return;
    const tot = S.nomor.reduce((a, n) => a + (Number(n.chat_belum_dibalas) || 0), 0), angka = (x, putus) => `<b class="${x > 0 ? (putus ? 'redup' : 'merah') : ''}">${x}</b>`;
    // [10 Nov] chip per akun (geser di HP, dilipat rapi di layar lebar): "Indah Aff …9944 92"; akun belum pernah ditautkan & tanpa chat tidak ditampilkan
    box.innerHTML = `<span class="r-judul">Belum dibalas</span><div class="r-chip"><button type="button" data-n="semua" class="${S.nomorAktif === 'semua' ? 'on' : ''}" title="Semua akun"><span class="r-nm">Semua</span>${angka(tot)}</button>` +
      S.nomor.filter(n => n.jid || Number(n.chat_belum_dibalas) > 0).map(n => { const putus = keadaan(n) === 'terputus'; return `<button type="button" data-n="${n.id}" class="${String(S.nomorAktif) === String(n.id) ? 'on' : ''} ${putus ? 'putus' : ''}" title="${esc(judulAkun(n))}${nomorSlot(n) ? ' · ' + esc(nomorSlot(n)) : ''}${putus ? ' · Terputus (mode baca)' : ''}">${putus ? IKON_PUTUS : ''}<span class="r-nm">${esc(labelSlot(n))}</span>${nomorSlot(n) ? `<span class="r-no">…${esc(nomorSlot(n).slice(-4))}</span>` : ''}${angka(Number(n.chat_belum_dibalas) || 0, putus)}</button>`; }).join('') + '</div>';
  }
  $('#ringkas').addEventListener('click', (e) => { const b = e.target.closest('button[data-n]'); if (!b) return; S.nomorAktif = b.dataset.n; S.jejakChats = ''; renderRel(); muatChats(); });
  // filter "Belum dibalas" (akun terpilih atau Semua)
  S.belum = false;
  $('#saringBelum').addEventListener('click', () => { S.belum = !S.belum; $('#saringBelum').setAttribute('aria-pressed', String(S.belum)); $('#saringBelum').classList.toggle('on', S.belum); S.jejakChats = ''; muatChats(); });
  // [10 Nov] urutan "Paling lama menunggu": chat belum dibalas, yang menunggu paling lama di atas
  S.urutTunggu = false;
  $('#urutTunggu').addEventListener('click', () => { S.urutTunggu = !S.urutTunggu; $('#urutTunggu').setAttribute('aria-pressed', String(S.urutTunggu)); $('#urutTunggu').classList.toggle('on', S.urutTunggu); S.jejakChats = ''; muatChats(); });
  // pita kartu: "Semua" + Aff 1–6 (grid di desktop, geser horizontal di HP); klik = filter chat
  function renderKartu() {
    const box = $('#kartuGrid'); if (!box) return;
    const terakhir = (n) => { if (!n.terakhir) return null; const [t, tim, nama, cup] = n.terakhir.split('\t'); return { t, tim: tim === '1', nama, cup }; };
    const jamPendek = (t) => { if (!t) return ''; const hariIni = t.slice(0, 10) === new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10); return hariIni ? t.slice(11, 16) : t.slice(8, 10) + '/' + t.slice(5, 7) + ' ' + t.slice(11, 16); };
    const tot = S.nomor.reduce((a, n) => { a.on += n.status === 'terhubung' ? 1 : 0; a.belum += Number(n.chat_belum_dibalas) || 0; a.chat += Number(n.jumlah_chat) || 0; return a; }, { on: 0, belum: 0, chat: 0 });
    box.innerHTML = `<button class="kartu semua ${S.nomorAktif === 'semua' ? 'on' : ''}" data-n="semua"><div><div class="k-judul">Semua nomor</div><div class="k-sub">Gabungan chat ${S.nomor.length} nomor affiliate</div></div>
        <div class="k-angka"><div><b>${tot.on}/${S.nomor.length}</b>terhubung</div><div><b>${tot.belum}</b>belum dibalas</div><div><b>${tot.chat.toLocaleString('id-ID')}</b>chat</div><div><b>${S.nomor.filter(n => keadaan(n) === 'terputus' || keadaan(n) === 'perlu_scan').length}</b>perlu dicek</div></div></button>` +
      S.nomor.map(n => { const z = terakhir(n); return `<button class="kartu ${String(S.nomorAktif) === String(n.id) ? 'on' : ''}" data-n="${n.id}" title="${esc(labelSlot(n))}">
        <span class="foto">${foto(n)}</span>
        <span class="k-nama"><span>${esc(labelSlot(n))}</span></span>
        <span class="k-no">${n.jid ? esc(nomorHp(n.jid)) : 'Belum ditautkan'}</span>
        <span class="k-bawah"><span class="st ${keadaan(n)}">${keadaan(n) === 'terputus' ? IKON_PUTUS + ' ' : ''}${esc(STATUS[keadaan(n)])}</span>${Number(n.chat_belum_dibalas) > 0 ? `<span class="lencana ${keadaan(n) === 'terputus' ? 'redup' : ''}" title="chat belum dibalas">${n.chat_belum_dibalas}</span>` : ''}</span>
        <span class="k-bawah"><span class="k-pesan">${z ? (z.tim ? 'Tim → ' : '') + '<b>' + esc(z.nama && z.nama.includes('@') ? nomorHp(z.nama) : z.nama) + '</b>: ' + esc(z.cup || '') : 'Belum ada pesan'}</span><span class="k-jam">${z ? jamPendek(z.t) : ''}</span></span></button>`; }).join('');
  }

  $('#relNomor').addEventListener('click', (e) => { const b = e.target.closest('.rel-n'); if (!b) return; S.nomorAktif = b.dataset.n; S.jejakChats = ''; renderRel(); muatChats(); gantiHal('inbox'); });
  $$('.rel-btn[data-hal], .rel-logo-btn').forEach(b => b.addEventListener('click', () => gantiHal(b.dataset.hal)));
  function gantiHal(h) {
    S.hal = h; $$('.rel-btn[data-hal]').forEach(b => b.classList.toggle('on', b.dataset.hal === h));
    $('#halInbox').hidden = h !== 'inbox'; $('#halNomor').hidden = h !== 'nomor'; $('#halWaktu').hidden = h !== 'waktu'; $('#halRingkasan').hidden = h !== 'ringkasan'; $('#halHubungkan').hidden = h !== 'hubungkan'; $('#halAudit').hidden = h !== 'audit';
    if (h !== 'inbox') tutupObrolan();
    if (h === 'nomor') renderBeranda(); if (h === 'waktu') renderWaktu(); if (h === 'ringkasan') renderRingkasan(); if (h === 'hubungkan') { renderHubungkan(); renderAkun(); } if (h === 'audit') renderAudit();
  }

  // ---------------------------------------------------------------- daftar chat
  async function muatChats() {
    const p = { nomor: S.nomorAktif }; if (S.belum) p.belum = 1; if (S.urutTunggu) p.urut = 'tunggu';
    const j = await api('chats', p); if (!j.ok) return;
    if (j.sekarang) S.selisihJam = j.sekarang * 1000 - Date.now();
    // badge "menunggu …" ikut berjalan: daftar digambar ulang tiap menit walau datanya sama
    const jejak = S.nomorAktif + (S.belum ? '|b' : '') + (S.urutTunggu ? '|t' : '') + Math.floor(Date.now() / 60e3) + JSON.stringify(j.chats);
    if (jejak === S.jejakChats) return;            // tidak berubah → jangan gambar ulang (hover & klik tidak terganggu)
    S.jejakChats = jejak; S.chats = j.chats; renderChats(); renderRel();
  }
  function renderChats() {
    const ul = $('#daftarChat');
    const kini = Date.now() + (S.selisihJam || 0);
    if (!S.chats.length) { ul.innerHTML = S.belum || S.urutTunggu ? '<li class="kosong-obrolan kecil">Semua chat sudah dibalas.</li>' : '<li class="kosong-obrolan kecil">Belum ada chat. Tautkan nomor di halaman Hubungkan (🔗).</li>'; return; }
    ul.innerHTML = S.chats.map(c => {
      const nama = namaChat(c);
      const hariIni = c.pesan_terakhir_at && c.pesan_terakhir_at.slice(0, 10) === new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
      return `<li class="chat-i ${S.chat && S.chat.id == c.id ? 'on' : ''}" data-id="${c.id}">
        <div class="ava ${c.jenis === 'grup' ? 'grup' : ''}">${avaChat(c)}</div>
        <div class="chat-tengah"><div class="chat-nama" title="${esc(c.nama_simpan ? 'Disimpan sebagai: ' + c.nama_simpan : (c.push_name ? 'Nama WA: ' + c.push_name : ''))}">${esc(nama)}</div><div class="chat-no">${esc(nomorChat(c))}${S.nomorAktif === 'semua' ? ` <span class="tag-n">${esc(namaNomorId(c.nomor_id, c.nomor_label))}</span>` : ''}</div><div class="chat-cup">${c.cuplikan_dari_tim == 1 ? '↪ ' : ''}${esc(c.cuplikan || '')}</div>${tungguHtml(c, kini)}</div>
        <div class="chat-kanan"><span class="chat-jam">${c.pesan_terakhir_at ? (hariIni ? c.pesan_terakhir_at.slice(11, 16) : c.pesan_terakhir_at.slice(8, 10) + '/' + c.pesan_terakhir_at.slice(5, 7)) : ''}</span>
          ${Number(c.belum_dibalas) > 0 ? `<span class="lencana" title="${c.belum_dibalas} pesan belum dibalas sejak ${esc(c.belum_dibalas_sejak)}">${c.belum_dibalas}</span>` : ''}</div></li>`;
    }).join('');
  }
  // [10 Nov] badge "menunggu 1j 20m" (jam kerja) untuk chat pribadi yang belum dibalas: oranye > 30 menit, merah > 2 jam
  function tungguHtml(c, kini) {
    if (!c.belum_dibalas_sejak || c.jenis !== 'pribadi') return '';
    const s = detikKerja(tsWib(c.belum_dibalas_sejak), kini), kls = s > 7200 ? 'merah' : s > 1800 ? 'oranye' : '';
    return `<span class="tunggu ${kls}" title="Pesan pertama yang belum dibalas masuk ${esc(c.belum_dibalas_sejak.slice(0, 16))} · dihitung jam kerja (Sen–Jum 08–17, Sab 08–12)">menunggu ${lama(s)}</span>`;
  }
  $('#daftarChat').addEventListener('click', (e) => { const li = e.target.closest('.chat-i'); if (li) bukaChat(Number(li.dataset.id)); });

  // ---------------------------------------------------------------- pencarian di semua chat
  let tCari = null;
  $('#cari').addEventListener('input', (e) => {
    clearTimeout(tCari); const s = e.target.value.trim();
    tCari = setTimeout(async () => {
      const box = $('#hasilCari');
      if (s.length < 2) { box.hidden = true; $('#daftarChat').hidden = false; return; }
      const [j, c] = await Promise.all([api('cari', { q: s }), api('chats', { nomor: S.nomorAktif, cari: s })]);
      const re = new RegExp('(' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
      box.innerHTML = (c.chats || []).map(x => `<div class="hasil-i" data-chat="${x.id}"><b>${esc(namaChat(x))}</b> <span class="tag-n">${esc(namaNomorId(x.nomor_id, x.nomor_label))}</span><div class="kecil">${esc(nomorChat(x))}${x.nama_simpan ? ' · disimpan sebagai ' + esc(x.nama_simpan) : ''}${x.push_name ? ' · nama WA ' + esc(x.push_name) : ''}</div></div>`).join('') +
        (j.hasil || []).map(x => `<div class="hasil-i" data-chat="${x.chat_id}"><b>${esc(namaChat(x))}</b> <span class="tag-n">${esc(namaNomorId(x.nomor_id, x.nomor_label))}</span> <span class="kecil mono">${esc(x.waktu)}</span><div class="kecil">${x.dari_tim == 1 ? 'Tim: ' : ''}${esc(x.teks || '').replace(re, '<mark>$1</mark>')}</div></div>`).join('') || '<div class="hasil-i kecil">Tidak ada hasil.</div>';
      box.hidden = false; $('#daftarChat').hidden = true;
    }, 350);
  });
  $('#hasilCari').addEventListener('click', (e) => { const h = e.target.closest('[data-chat]'); if (h) bukaChat(Number(h.dataset.chat)); });

  // ---------------------------------------------------------------- isi percakapan
  async function bukaChat(id) {
    S.chat = { id }; S.kutip = null; $('#kutipBar').hidden = true; S.jejak = ''; S.palingLama = 0;
    $('#halInbox').classList.add('buka'); app.classList.add('chat-buka'); $('#kosongObrolan').hidden = true; $('#obrolanAtas').hidden = false;   // kolom tulis dibuka muatPesan() hanya kalau nomor tersambung
    $$('.chat-i').forEach(li => li.classList.toggle('on', Number(li.dataset.id) === id));
    await muatPesan(true);
    $('#isiPesan').scrollTop = 1e9; if (S.bisaBalas) $('#ketik').focus();
  }
  // [10 Nov] di HP obrolan terbuka layar penuh (baris nomor disembunyikan), tombol ← kembali ke daftar
  function tutupObrolan() { $('#halInbox').classList.remove('buka'); app.classList.remove('chat-buka'); }
  $('#kembali').addEventListener('click', tutupObrolan);
  // kotak tulis tetap di atas keyboard HP: tinggi aplikasi ikut visualViewport
  if (window.visualViewport) { const pas = () => { document.documentElement.style.setProperty('--tinggi', Math.round(visualViewport.height) + 'px'); if (visualViewport.offsetTop === 0 && scrollY) scrollTo(0, 0); }; visualViewport.addEventListener('resize', pas); pas(); }
  $('#bannerPutus').addEventListener('click', (e) => { if (e.target.closest('[data-ke-hubungkan]')) gantiHal('hubungkan'); });
  async function muatPesan(pertama) {
    if (!S.chat) return;
    const id = S.chat.id, j = await api('pesan', pertama === true ? { chat: id } : { chat: id, diam: 1 });
    if (!j.ok || !S.chat || S.chat.id !== id) return;
    S.chat = j.chat;
    const kc = keadaan({ status: j.chat.nomor_status, jid: j.chat.nomor_jid, qr: Number(j.chat.nomor_qr) });
    S.bisaBalas = kc === 'terhubung' && !LIHAT;
    $('#tulis').hidden = !S.bisaBalas; $('#btnDibaca').hidden = !S.bisaBalas;
    const ban = $('#bannerPutus'); ban.hidden = S.bisaBalas;
    ban.classList.toggle('lihat', LIHAT);
    if (LIHAT) ban.innerHTML = `<span><b>Akun lihat saja</b> — bisa membaca chat, tidak bisa membalas atau mengubah apa pun.</span>`;
    else if (!S.bisaBalas) ban.innerHTML = `${IKON_PUTUS}<span>${kc === 'perlu_scan' || kc === 'menghubungkan' ? '<b>Nomor ini sedang menyambung</b> — balas setelah QR dipindai &amp; tersambung.' : '<b>Nomor ini sedang terputus</b> — scan ulang untuk balas.'} Chat &amp; foto tetap bisa dibaca.</span><button type="button" class="btn" data-ke-hubungkan>Scan ulang</button>`;
    $('#namaChat').textContent = namaChat(j.chat); pasang($('#avaChat'), avaChat(j.chat)); $('#avaChat').classList.toggle('grup', j.chat.jenis === 'grup');
    pasang($('#infoChat'), `${esc(nomorChat(j.chat))}${j.chat.jenis !== 'grup' ? ` · Disimpan sebagai: <b>${esc(j.chat.nama_simpan || '–')}</b> · Nama WA: <b>${esc(j.chat.push_name || '–')}</b>` : ''} · <span class="tag-n">${esc(namaNomorId(j.chat.nomor_id, j.chat.nomor_label))}</span> · rata-rata balas ${durasi(j.chat.waktu_balas_rata_detik)}${j.chat.belum_dibalas_sejak ? ` · <b style="color:var(--oranye)">belum dibalas sejak ${esc(j.chat.belum_dibalas_sejak.slice(0, 16))}</b>` : ''}`);
    const jejak = String(S.bisaBalas) + JSON.stringify(j.pesan.map(p => [p.id, p.status, p.teks, p.dihapus_semua_at, p.reaksi, p.media_status, p.jumlah_versi]));
    if (jejak === S.jejak && pertama !== true) return;
    S.jejak = jejak;
    if (pertama === true || !S.pesan.length) S.pesan = j.pesan;
    else { const lama = S.pesan.filter(p => p.id < j.pesan[0].id); S.pesan = lama.concat(j.pesan); }
    S.palingLama = S.pesan.length ? S.pesan[0].id : 0;
    renderPesan();
  }
  function centang(p) {
    if (!p.dari_tim) return '';
    const t = `terkirim ${p.terkirim_at || '–'} · diterima ${p.diterima_at || '–'} · dibaca ${p.dibaca_at || '–'}`;
    const s = Number(p.status);
    return `<span class="centang ${s >= 3 ? 'baca' : ''}" title="${esc(t)}">${s <= 0 ? '🕓' : s === 1 ? '✓' : '✓✓'}</span>`;
  }
  function mediaHtml(p) {
    if (!p.media_id) return '';
    if (p.media_status !== 'ok') return `<div class="media-tunggu">${p.media_status === 'gagal' ? 'Media tidak bisa diunduh dari WhatsApp' : S.bisaBalas === false ? 'Media belum terunduh — diunduh otomatis setelah nomor tersambung lagi' : 'Media sedang diunduh…'}</div>`;
    const u = '/media.php?id=' + p.media_id;
    if (p.jenis === 'gambar') return `<img class="foto" loading="lazy" src="${u}" alt="Gambar" data-besar="${u}">`;
    if (p.jenis === 'stiker') return `<img class="stiker" loading="lazy" src="${u}" alt="Stiker">`;
    if (p.jenis === 'video') return `<video controls preload="none" src="${u}"></video>`;
    if (p.jenis === 'voice' || p.jenis === 'audio') return `<audio controls preload="none">${p.bisa_putar == 1 ? `<source src="${u}&putar=1" type="audio/mp4">` : ''}<source src="${u}"></audio>`;
    return `<a class="dok" href="${u}&unduh=1"><span style="font-size:24px">📄</span><span><b>${esc(p.nama_file || 'Dokumen')}</b><br><span class="kecil">${esc(p.mime || '')}${p.ukuran ? ' · ' + Math.ceil(p.ukuran / 1024) + ' KB' : ''}</span></span></a>`;
  }
  function renderPesan() {
    const box = $('#isiPesan'), diBawah = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    let hari = '', h = S.pesan.length >= 60 ? '<button class="muat-lagi" id="muatLagi">Muat pesan lebih lama</button>' : '';
    S.pesan.forEach(p => {
      if (p.waktu.slice(0, 10) !== hari) { hari = p.waktu.slice(0, 10); h += `<div class="hari">${tglPanjang(p.waktu)}</div>`; }
      const reaksi = p.reaksi ? p.reaksi.split(';').map(x => x.split('|')[0]).join('') : '';
      const kutip = p.kutip_id ? `<div class="kutipan" data-ke="${p.kutip_id}">${p.kutip_dari_tim == 1 ? '<b>Tim</b>: ' : ''}${esc(p.kutip_teks || p.kutip_jenis || 'Pesan')}</div>` : (p.kutipan_wa_id ? '<div class="kutipan">Membalas pesan lama</div>' : '');
      const peng = S.chat.jenis === 'grup' && p.dari_tim != 1 ? `<div class="pengirim">${esc(p.pengirim_nama || nomorHp(p.pengirim_jid))}</div>` : '';
      h += `<div class="gb ${p.dari_tim == 1 ? 'tim' : ''} ${p.dihapus_semua_at ? 'dihapus' : ''} ${reaksi ? 'ada-reaksi' : ''}" data-id="${p.id}">
        <button class="aksi-gb" aria-label="Aksi pesan">▾</button>${peng}${kutip}${mediaHtml(p)}${p.teks ? `<div class="teks">${esc(p.teks)}</div>` : ''}
        <div class="kaki">${p.dari_web == 1 ? '<span class="cap-web" title="Dikirim dari web">dari web</span>' : ''}${p.dihapus_semua_at ? `<span class="cap-hapus">dihapus ${esc(jamDetik(p.dihapus_semua_at))}</span>` : ''}${p.dihapus_saya_at ? `<span class="cap-hapus">dihapus untuk saya</span>` : ''}${p.diedit == 1 ? `<button class="link-edit" data-versi="${p.id}">diedit${Number(p.jumlah_versi) > 1 ? ' (' + (Number(p.jumlah_versi) - 1) + 'x)' : ''}</button>` : ''}<span title="${esc(p.waktu)}">${jamDetik(p.waktu)}</span>${centang(p)}</div>
        ${reaksi ? `<span class="reaksi" title="reaksi">${esc(reaksi)}</span>` : ''}</div>`;
    });
    const tinggiLama = box.scrollHeight, atasLama = box.scrollTop;
    box.innerHTML = h || '<div class="kosong-obrolan kecil">Belum ada pesan.</div>';
    if (diBawah) box.scrollTop = 1e9; else box.scrollTop = atasLama + (box.scrollHeight - tinggiLama) * (S.muatLama ? 1 : 0);
    S.muatLama = false;
  }
  $('#isiPesan').addEventListener('click', async (e) => {
    if (e.target.id === 'muatLagi') {
      const j = await api('pesan', { chat: S.chat.id, sebelum_id: S.palingLama }); if (!j.ok) return;
      S.pesan = j.pesan.concat(S.pesan); S.palingLama = S.pesan.length ? S.pesan[0].id : 0; S.muatLama = true; renderPesan(); return;
    }
    const v = e.target.closest('[data-versi]'); if (v) return lihatVersi(Number(v.dataset.versi));
    const img = e.target.closest('img.foto'); if (img) return modal(`<img src="${img.dataset.besar}" alt="Gambar">`);
    const k = e.target.closest('.kutipan[data-ke]'); if (k) { const t = $(`.gb[data-id="${k.dataset.ke}"]`); if (t) t.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    const a = e.target.closest('.aksi-gb'); if (a) menuPesan(Number(a.closest('.gb').dataset.id), a);
  });
  async function lihatVersi(id) {
    const j = await api('versi', { pesan: id }); if (!j.ok) return;
    const label = { asli: 'Asli', hp: 'Diedit dari HP tim', kontak: 'Diedit kontak', web: 'Diedit dari web' };
    modal('<h3 style="margin-top:0">Riwayat edit</h3>' + j.versi.map(x => `<div class="versi"><div class="kecil">${label[x.sumber] || x.sumber} · ${esc(x.waktu)}</div>${esc(x.teks)}</div>`).join(''));
  }
  function modal(html) { $('#modalIsi').innerHTML = html; $('#modal').hidden = false; }
  $('#modalTutup').addEventListener('click', () => $('#modal').hidden = true);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').hidden = true; });

  // ---------------------------------------------------------------- menu pesan: balas, reaksi, edit, hapus
  function tutupMenu() { $$('.menu').forEach(m => m.remove()); }
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu') && !e.target.closest('.aksi-gb')) tutupMenu(); });
  function menuPesan(id, tombol) {
    tutupMenu();
    const p = S.pesan.find(x => x.id == id); if (!p) return;
    const umur = (Date.now() - new Date(p.waktu.replace(' ', 'T') + '+07:00').getTime()) / 1000;
    const bisaEdit = p.dari_tim == 1 && p.jenis === 'teks' && !p.dihapus_semua_at && umur <= 900;
    const bisaHapusSemua = p.dari_tim == 1 && !p.dihapus_semua_at && umur <= 2 * 86400;
    const baca = S.bisaBalas === false, mati = LIHAT ? 'hidden' : 'disabled title="Nomor terputus — scan ulang untuk balas"';   // mode baca: hanya salin, versi, info (akun lihat: tombol aksi tidak ditampilkan)
    const m = document.createElement('div'); m.className = 'menu';
    m.innerHTML = `${baca ? `<div class="menu-catatan">${LIHAT ? 'Akun lihat saja' : 'Mode baca — nomor terputus'}</div>` : `<div class="emo">${['👍', '❤️', '😂', '😮', '😢', '🙏'].map(x => `<button data-r="${x}">${x}</button>`).join('')}<button data-r="" title="Hapus reaksi">✕</button></div>`}
      <button data-a="balas" ${baca ? mati : ''}>Balas</button>
      ${p.teks ? '<button data-a="salin">Salin teks</button>' : ''}
      <button data-a="edit" ${baca ? mati : bisaEdit ? '' : 'disabled title="Hanya pesan teks tim, maks 15 menit"'}>Edit</button>
      <button data-a="hapus_semua" ${baca ? mati : bisaHapusSemua ? '' : 'disabled title="Hanya pesan tim, maks ±2 hari"'}>Hapus untuk semua orang</button>
      <button data-a="hapus_saya" ${baca ? mati : ''}>Hapus untuk saya</button>
      ${p.diedit == 1 ? '<button data-a="versi">Lihat versi lama</button>' : ''}
      <button data-a="info">Info pesan</button>`;
    document.body.appendChild(m);
    const r = tombol.getBoundingClientRect(); m.style.top = Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8) + 'px'; m.style.left = Math.max(8, Math.min(r.left - 150, innerWidth - m.offsetWidth - 8)) + 'px';
    m.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b || b.disabled) return; tutupMenu();
      if (b.dataset.r !== undefined) return antre('reaksi', { __post: 1, pesan: id, emoji: b.dataset.r });
      const a = b.dataset.a;
      if (a === 'balas') { S.kutip = p; $('#kutipTeks').textContent = (p.dari_tim == 1 ? 'Tim: ' : '') + (p.teks || p.jenis); $('#kutipBar').hidden = false; $('#ketik').focus(); }
      else if (a === 'salin') { navigator.clipboard && navigator.clipboard.writeText(p.teks); toast('Teks disalin'); }
      else if (a === 'edit') { const baru = prompt('Edit pesan (batas WhatsApp 15 menit):', p.teks); if (baru && baru.trim() && baru !== p.teks) { await antre('edit', { __post: 1, pesan: id, isi: baru.trim() }); toast('Edit masuk antrean'); } }
      else if (a === 'hapus_semua') { if (confirm('Hapus pesan ini untuk semua orang? Tercatat atas nama Anda.')) { await antre('hapus', { __post: 1, pesan: id, mode: 'semua' }); toast('Hapus masuk antrean'); } }
      else if (a === 'hapus_saya') { if (confirm('Hapus untuk saya? Pesan juga hilang dari HP tim (isi tetap tersimpan di sini).')) await antre('hapus', { __post: 1, pesan: id, mode: 'saya' }); }
      else if (a === 'versi') lihatVersi(id);
      else if (a === 'info') modal(`<h3 style="margin-top:0">Info pesan</h3><dl class="kecil mono" style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px">
        <dt>Dikirim</dt><dd>${esc(p.waktu)}</dd>${p.dari_tim == 1 ? `<dt>Terkirim</dt><dd>${esc(p.terkirim_at || '–')}</dd><dt>Diterima</dt><dd>${esc(p.diterima_at || '–')}</dd><dt>Dibaca</dt><dd>${esc(p.dibaca_at || '–')}</dd>` : ''}
        ${p.dihapus_semua_at ? `<dt>Dihapus</dt><dd>${esc(p.dihapus_semua_at)}</dd>` : ''}<dt>Sumber</dt><dd>${p.dari_web == 1 ? 'dari web' : p.dari_riwayat == 1 ? 'riwayat WhatsApp' : p.dari_tim == 1 ? 'HP tim' : 'kontak'}</dd></dl>`);
    });
  }

  // ---------------------------------------------------------------- kirim
  $('#kutipBatal').addEventListener('click', () => { S.kutip = null; $('#kutipBar').hidden = true; });
  const ketik = $('#ketik');
  ketik.addEventListener('input', () => { ketik.style.height = 'auto'; ketik.style.height = Math.min(ketik.scrollHeight, 140) + 'px'; });
  ketik.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); kirimTeks(); } });
  $('#btnKirim').addEventListener('click', kirimTeks);
  let sibuk = false;
  async function kirimTeks() {
    const t = ketik.value.trim(); if (!t || !S.chat || sibuk) return;
    sibuk = true;
    const ok = await antre('kirim', { __post: 1, chat: S.chat.id, jenis: 'teks', isi: t, kutip: S.kutip ? S.kutip.id : '' });
    sibuk = false;
    if (ok) { ketik.value = ''; ketik.style.height = 'auto'; S.kutip = null; $('#kutipBar').hidden = true; }
  }
  $('#lampiran').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f || !S.chat) return;
    if (f.size > 64 * 1024 * 1024) return toast('File maksimal 64 MB');
    const jenis = /^image\/(jpeg|png|webp)$/.test(f.type) ? 'gambar' : 'dokumen';
    if (!confirm(`Kirim ${jenis === 'gambar' ? 'gambar' : 'dokumen'} "${f.name}"${ketik.value.trim() ? ' dengan keterangan dari kolom ketik' : ''}?`)) return;
    const fd = new FormData(); fd.append('chat', S.chat.id); fd.append('jenis', jenis); fd.append('isi', ketik.value.trim()); fd.append('kutip', S.kutip ? S.kutip.id : ''); fd.append('file', f, f.name);
    if (await antre('kirim', null, fd)) { ketik.value = ''; S.kutip = null; $('#kutipBar').hidden = true; toast('Masuk antrean kirim'); }
  });
  // voice note: rekam di browser → server mengubah ke format voice note WhatsApp (ogg/opus)
  let rekam = null;
  $('#btnRekam').addEventListener('click', async () => {
    const b = $('#btnRekam');
    if (rekam) { rekam.stop(); return; }
    if (!S.chat || !navigator.mediaDevices) return toast('Perekam suara tidak tersedia di browser ini');
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: true }), potong = [], mulai = Date.now();
      const tipe = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
      rekam = new MediaRecorder(st, tipe ? { mimeType: tipe } : {});
      rekam.ondataavailable = (e) => e.data.size && potong.push(e.data);
      const jamRekam = setInterval(() => { b.textContent = '■ ' + Math.round((Date.now() - mulai) / 1000) + ' dtk'; }, 500);
      b.classList.add('rekam'); b.textContent = '■ 0 dtk';
      rekam.onstop = async () => {
        clearInterval(jamRekam); st.getTracks().forEach(t => t.stop()); b.classList.remove('rekam'); b.textContent = '🎤'; rekam = null;
        const blob = new Blob(potong, { type: potong[0] ? potong[0].type : 'audio/webm' });
        if (Date.now() - mulai < 800) return toast('Rekaman terlalu pendek');
        if (!confirm('Kirim voice note ' + Math.round((Date.now() - mulai) / 1000) + ' detik?')) return;
        const fd = new FormData(); fd.append('chat', S.chat.id); fd.append('jenis', 'voice'); fd.append('kutip', S.kutip ? S.kutip.id : ''); fd.append('file', blob, 'voice.' + (blob.type.includes('mp4') ? 'm4a' : 'webm'));
        if (await antre('kirim', null, fd)) toast('Voice note masuk antrean');
      };
      rekam.start();
    } catch (e) { toast('Izin mikrofon ditolak'); rekam = null; }
  });
  const EMOJI = '😀 😁 😂 🤣 😊 😍 🥰 😘 😉 😎 🤗 🤔 😅 😭 😢 😮 😴 🙏 👍 👌 👏 🙌 💪 🔥 ✨ 💯 ❤️ 💚 💜 🎉 ✅ ❌ ⚠️ 📦 🚚 💰 🛒 📌 ⏰ 📷'.split(' ');
  $('#btnEmoji').addEventListener('click', () => { const p = $('#emojiPanel'); if (!p.innerHTML) p.innerHTML = EMOJI.map(x => `<button type="button">${x}</button>`).join(''); p.hidden = !p.hidden; });
  $('#emojiPanel').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; const i = ketik.selectionStart || ketik.value.length; ketik.value = ketik.value.slice(0, i) + b.textContent + ketik.value.slice(i); ketik.focus(); });
  $('#btnDibaca').addEventListener('click', async () => { if (S.chat && confirm('Kirim tanda dibaca (centang biru) ke kontak untuk chat ini?')) { await antre('tandai_dibaca', { __post: 1, chat: S.chat.id }); toast('Tanda dibaca masuk antrean'); } });

  // ---------------------------------------------------------------- Hubungkan nomor
  const grupTerbuka = {}, labelKotor = {}, labelTimer = {};   // labelKotor[id]: kotak label sedang diedit & belum tersimpan → polling tidak menimpa
  // [28 Okt] kartu per slot dipasang sekali (key = data-n), lalu hanya bagian yang berubah yang diganti:
  // kotak label yang sedang difokus/diedit tidak pernah ditimpa, foto/QR/daftar grup tidak kedip tiap refresh
  const pasang = (el, html) => { if (el.dataset.html === html) return false; el.innerHTML = html; el.dataset.html = html; return true; };
  function renderHubungkan() {
    const box = $('#halHubungkan');
    if (!box.dataset.siap) { box.dataset.siap = 1; setTimeout(renderAkun, 0); box.innerHTML = '<h2>Hubungkan nomor</h2><p>Label tiap nomor bisa diubah langsung di kotak nama (contoh: Aff 1 - Natasya), tersimpan saat tekan Enter atau klik di luar kotak. Di HP tim: WhatsApp → Perangkat tertaut → Tautkan perangkat, lalu pindai QR. HP tetap bisa dipakai seperti biasa. Riwayat chat lama ikut ditarik penuh setelah tertaut.</p><div class="kartu-n" id="kartuN"></div><div id="akunBox" class="akun-box"></div>'; }
    const wadah = $('#kartuN');
    S.nomor.forEach((n, urut) => {
      let kartu = $(`.kn[data-n="${n.id}"]`, wadah);
      if (!kartu) {
        kartu = document.createElement('div'); kartu.className = 'kn'; kartu.dataset.n = n.id;
        kartu.innerHTML = `<div class="kn-atas"><span class="foto"></span><span class="kn-label"><input data-label="${n.id}" maxlength="80" enterkeyhint="done" autocomplete="off" aria-label="Label nomor ${n.id}" title="Ubah label, mis. Aff 1 - Natasya. Enter atau klik di luar untuk menyimpan, Esc untuk batal."><span class="tersimpan" aria-live="polite"></span></span><span class="st"></span></div><div class="kn-isi"></div>`;
      }
      if (wadah.children[urut] !== kartu) wadah.insertBefore(kartu, wadah.children[urut] || null);
      const k = keadaan(n), ada = n.status !== 'belum' || n.jid || Number(n.jumlah_chat) > 0;
      kartu.classList.toggle('putus', k === 'terputus');
      pasang($('.foto', kartu), foto(n));
      const st = $('.st', kartu); st.className = 'st ' + k; pasang(st, (k === 'terputus' ? IKON_PUTUS + ' ' : '') + esc(STATUS[k]));
      const inp = $('input[data-label]', kartu);
      if (document.activeElement !== inp && !labelKotor[n.id] && inp.value !== n.label) inp.value = n.label;
      const isi = `${k === 'terputus' ? `<div class="kn-putus">${IKON_PUTUS}<span><b>Terputus${n.terakhir_putus ? ' sejak ' + esc(n.terakhir_putus.slice(0, 16)) : ''}</b>${alasanPutus(n) ? ' — ' + esc(alasanPutus(n)) : ''}.<br>Riwayat ${Number(n.jumlah_pesan).toLocaleString('id-ID')} pesan tetap tersimpan &amp; bisa dibaca. Scan ulang dengan nomor ${esc(nomorHp(n.jid))} untuk balas lagi.</span></div>` : ''}
      ${n.status === 'perlu_scan' && n.qr ? `<div class="qr" data-qr="${esc(n.qr)}"></div><div class="kecil">${n.jid ? 'Pindai dengan WhatsApp nomor ' + esc(nomorHp(n.jid)) + '. ' : ''}QR berganti otomatis tiap ±20 detik.</div>` : ''}
      <dl><dt>Nomor</dt><dd>${esc(n.jid ? nomorHp(n.jid) : '–')}</dd><dt>Terhubung</dt><dd>${esc(n.terakhir_terhubung || '–')}</dd><dt>Putus</dt><dd>${esc(n.terakhir_putus || '–')}${n.alasan_putus ? ' (' + esc(n.alasan_putus) + ')' : ''}</dd>
        <dt>Riwayat</dt><dd>${n.riwayat_progres != null ? esc(n.riwayat_progres) + '%' : '–'}</dd><dt>Pesan</dt><dd>${Number(n.jumlah_pesan).toLocaleString('id-ID')} · ${Number(n.jumlah_chat).toLocaleString('id-ID')} chat</dd>
        <dt>Paling lama</dt><dd>${esc(n.pesan_terlama || '–')}</dd><dt>Media antre</dt><dd>${Number(n.media_antre).toLocaleString('id-ID')}</dd></dl>
      <div class="kn-aksi">${k === 'terhubung' || k === 'menghubungkan' ? '' : `<button class="btn" data-tautkan="${n.id}">${k === 'perlu_scan' ? 'Muat QR baru' : k === 'terputus' ? 'Scan ulang' : 'Tautkan'}</button>`}
        ${ada ? `<button class="btn merah" data-lepas="${n.id}">Lepas &amp; hapus sesi</button>` : ''}
        <button class="btn abu" data-grup="${n.id}">${grupTerbuka[n.id] ? 'Tutup daftar grup' : 'Pilih grup affiliate'}</button></div>
      ${grupTerbuka[n.id] ? `<div class="grup-l" id="grup${n.id}">memuat…</div>` : ''}`;
      if (pasang($('.kn-isi', kartu), isi)) {   // hanya digambar ulang kalau isinya berubah
        $$('.qr', kartu).forEach(el => { try { new QRCode(el, { text: el.dataset.qr, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.L }); } catch (e) { el.textContent = 'QR gagal dibuat'; } });
        if (grupTerbuka[n.id]) muatGrup(n.id);
      }
    });
  }
  // label: simpan saat Enter / klik di luar (debounce 300 ms), bukan tiap ketikan; "Tersimpan ✓" sebentar; langsung dipakai di sidebar, kartu & judul chat
  async function simpanLabel(inp) {
    const id = inp.dataset.label, n = S.nomor.find(x => String(x.id) === id); if (!n) return;
    const baru = inp.value.trim().replace(/\s+/g, ' ');
    if (!baru) { inp.value = n.label; labelKotor[id] = false; toast('Label tidak boleh kosong'); return; }
    if (baru === n.label) { inp.value = baru; labelKotor[id] = false; return; }
    const j = await api('label', { __post: 1, nomor: id, label: baru });
    if (!j.ok) { toast(j.pesan || 'Label gagal disimpan'); return; }
    S.urutNomor = (S.urutNomor || 0) + 1;            // jawaban polling yang sudah jalan sebelum simpan (label lama) diabaikan
    n.label = baru; if (inp.value.trim().replace(/\s+/g, ' ') === baru) { inp.value = baru; labelKotor[id] = false; }
    const t = $('.tersimpan', inp.parentNode); t.textContent = 'Tersimpan ✓'; t.classList.add('on'); clearTimeout(t.tm); t.tm = setTimeout(() => t.classList.remove('on'), 1800);
    renderRel(); S.jejakChats = ''; muatChats(); if (S.chat) muatPesan();
  }
  // "Lepas & hapus sesi": selalu hapus sesi WA; riwayat disimpan (bawaan) atau ikut dihapus (wajib ketik HAPUS)
  function dialogLepas(n) {
    if (!n) return;
    const jp = Number(n.jumlah_pesan).toLocaleString('id-ID'), jc = Number(n.jumlah_chat).toLocaleString('id-ID');
    modal(`<form class="lepas" id="formLepas"><h3>Lepas ${esc(labelSlot(n))}${n.jid ? ' (' + esc(nomorHp(n.jid)) + ')' : ''}?</h3>
      <p class="kecil">Sesi WhatsApp di server dihapus dan perangkat tertaut di HP ikut dilepas. Pilih apa yang terjadi dengan riwayatnya:</p>
      <label class="pilih"><input type="radio" name="riwayat" value="simpan" checked><span><b>Simpan riwayat</b><br>${jp} pesan &amp; ${jc} chat beserta foto tetap bisa dibaca (mode baca). Slot ini hanya bisa ditautkan lagi ke nomor yang sama.</span></label>
      <label class="pilih bahaya"><input type="radio" name="riwayat" value="hapus"><span><b>Hapus riwayat juga</b><br>${jp} pesan, ${jc} chat, media &amp; foto dihapus permanen dari server dan tidak bisa dikembalikan. Slot kosong untuk nomor lain.</span></label>
      <label class="ketik-hapus" hidden><span>Ketik <b>HAPUS</b> untuk konfirmasi</span><input name="konfirmasi" autocomplete="off" spellcheck="false"></label>
      <div class="kn-aksi"><button type="button" class="btn abu" data-batal>Batal</button><button type="submit" class="btn merah-penuh">Lepas sesi</button></div></form>`);
    const f = $('#formLepas'), kotak = $('.ketik-hapus', f), tombol = $('[type=submit]', f);
    f.addEventListener('change', () => { const h = f.riwayat.value === 'hapus'; kotak.hidden = !h; tombol.textContent = h ? 'Lepas & hapus riwayat' : 'Lepas sesi'; if (h) f.konfirmasi.focus(); });
    $('[data-batal]', f).addEventListener('click', () => { $('#modal').hidden = true; });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const hapus = f.riwayat.value === 'hapus';
      if (hapus && f.konfirmasi.value.trim() !== 'HAPUS') { toast('Ketik HAPUS untuk menghapus riwayat'); f.konfirmasi.focus(); return; }
      const j = await api('putuskan', { __post: 1, nomor: n.id, riwayat: hapus ? 'hapus' : 'simpan', konfirmasi: hapus ? 'HAPUS' : '' });
      if (!j.ok) return toast(j.pesan || 'Gagal');
      $('#modal').hidden = true; toast(hapus ? 'Sesi dilepas, riwayat sedang dihapus…' : 'Sesi dilepas, riwayat disimpan'); setTimeout(muatNomor, 2500);
    });
  }
  async function muatGrup(id) {
    const j = await api('grup', { nomor: id }), el = $('#grup' + id); if (!el) return;
    el.innerHTML = (j.grup || []).length ? j.grup.map(g => `<label><input type="checkbox" data-g="${g.id}" ${g.simpan == 1 ? 'checked' : ''}> ${esc(g.judul || g.jid)}</label>`).join('') : '<span class="kecil">Belum ada grup terdeteksi.</span>';
  }
  $('#halHubungkan').addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tautkan]'), p = e.target.closest('[data-lepas]'), g = e.target.closest('[data-grup]');
    if (t) { await api('tautkan', { __post: 1, nomor: t.dataset.tautkan }); toast('Menyiapkan QR…'); }
    if (p) dialogLepas(S.nomor.find(x => String(x.id) === p.dataset.lepas));
    if (g) { grupTerbuka[g.dataset.grup] = !grupTerbuka[g.dataset.grup]; renderHubungkan(); }
    setTimeout(muatNomor, 1500);
  });
  $('#halHubungkan').addEventListener('change', async (e) => {
    if (e.target.dataset.g) { await api('grup_simpan', { __post: 1, chat: e.target.dataset.g, simpan: e.target.checked ? 1 : 0 }); toast(e.target.checked ? 'Grup akan disimpan mulai sekarang' : 'Grup tidak disimpan lagi'); }
  });
  $('#halHubungkan').addEventListener('input', (e) => { if (e.target.dataset.label) labelKotor[e.target.dataset.label] = true; });
  $('#halHubungkan').addEventListener('keydown', (e) => {
    const id = e.target.dataset.label; if (!id) return;
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); e.target.blur(); }
    if (e.key === 'Escape') { const n = S.nomor.find(x => String(x.id) === id); if (n) e.target.value = n.label; labelKotor[id] = false; e.target.blur(); }
  });
  $('#halHubungkan').addEventListener('focusout', (e) => {
    const inp = e.target, id = inp.dataset.label; if (!id) return;
    clearTimeout(labelTimer[id]); labelTimer[id] = setTimeout(() => simpanLabel(inp), 300);
  });

  // ---------------------------------------------------------------- Ringkasan & Audit
  async function renderRingkasan(dari, sampai) {
    const box = $('#halRingkasan'), j = await api('ringkasan', dari ? { dari, sampai } : {});
    const per = {}; (j.baris || []).forEach(r => { const k = namaNomorId(r.nomor_id, r.label); per[k] = per[k] || { cm: 0, ck: 0, kb: 0, bl: 0, bal: [], n: 0 }; const x = per[k]; x.cm += +r.chat_masuk; x.ck += +r.chat_keluar; x.kb += +r.kontak_baru; x.bl += +r.belum_dibalas_1jam; if (r.waktu_balas_rata_detik != null) x.bal.push(+r.waktu_balas_rata_detik); });
    box.innerHTML = `<h2>Ringkasan harian</h2><p>Chat pribadi per nomor per hari. Waktu balas = jarak pesan kontak ke balasan tim berikutnya. Dihitung ulang tiap 10 menit.</p>
      <div class="filter"><label>Dari <input type="date" id="rDari" value="${esc(j.dari)}"></label><label>Sampai <input type="date" id="rSampai" value="${esc(j.sampai)}"></label><button class="btn" id="rTampil">Tampilkan</button></div>
      <div class="tb-bungkus"><table class="tb"><thead><tr><th>Nomor</th><th>Chat masuk</th><th>Chat keluar</th><th>Kontak baru</th><th>Rata-rata balas</th><th>Belum dibalas &gt; 1 jam</th></tr></thead><tbody>
      ${Object.keys(per).map(k => { const x = per[k]; return `<tr><td>${esc(k)}</td><td class="n">${x.cm}</td><td class="n">${x.ck}</td><td class="n">${x.kb}</td><td class="n">${x.bal.length ? durasi(Math.round(x.bal.reduce((a, b) => a + b, 0) / x.bal.length)) : '–'}</td><td class="n">${x.bl}</td></tr>`; }).join('') || '<tr><td colspan="6">Belum ada data.</td></tr>'}</tbody></table></div>
      <div class="tb-bungkus"><table class="tb"><thead><tr><th>Tanggal</th><th>Nomor</th><th>Chat masuk</th><th>Chat keluar</th><th>Pesan masuk</th><th>Pesan keluar</th><th>Kontak baru</th><th>Rata-rata balas</th><th>Belum dibalas &gt; 1 jam</th></tr></thead><tbody>
      ${(j.baris || []).map(r => `<tr><td class="mono">${esc(r.tanggal)}</td><td>${esc(namaNomorId(r.nomor_id, r.label))}</td><td class="n">${r.chat_masuk}</td><td class="n">${r.chat_keluar}</td><td class="n">${r.pesan_masuk}</td><td class="n">${r.pesan_keluar}</td><td class="n">${r.kontak_baru}</td><td class="n">${durasi(r.waktu_balas_rata_detik)}</td><td class="n">${r.belum_dibalas_1jam}</td></tr>`).join('')}</tbody></table></div>`;
    $('#rTampil').onclick = () => renderRingkasan($('#rDari').value, $('#rSampai').value);
  }
  // ---------------------------------------------------------------- [10 Nov] Kartu 6 nomor (halaman awal owner): paling lambat membalas hari ini di atas
  async function renderBeranda() {
    const box = $('#halNomor');
    if (!box.dataset.siap) { box.dataset.siap = 1; box.innerHTML = '<h2>Nomor affiliate</h2><p>Urut dari yang <b>paling lambat membalas hari ini</b> (jam kerja): balasan terlama atau chat yang masih menunggu, mana yang lebih lama. Klik kartu untuk buka chat nomor itu.</p><div class="bn-grid" id="bnGrid"><p class="kecil">Memuat…</p></div>'; }
    if (!S.nomor.length) await muatNomor();
    const j = await api('waktu_balas', { rentang: 'hari' }); if (!j.ok) return;
    const st = {}; (j.nomor || []).forEach(n => st[n.nomor_id] = n);
    const kls = (x) => x > 7200 ? 'merah' : x > 1800 ? 'oranye' : '';
    const data = S.nomor.map(n => { const w = st[n.id] || {}; return { n, w, lambat: Math.max(w.terlama || 0, w.tunggu_terlama || 0), tertaut: !!n.jid }; });
    data.sort((a, b) => (b.tertaut - a.tertaut) || (b.lambat - a.lambat) || ((b.w.rata || 0) - (a.w.rata || 0)) || ((+b.n.chat_belum_dibalas || 0) - (+a.n.chat_belum_dibalas || 0)) || (a.n.id - b.n.id));
    $('#bnGrid').innerHTML = data.map(({ n, w, lambat }, i) => { const k = keadaan(n), z = n.terakhir ? n.terakhir.split('\t') : null;
      return `<button type="button" class="bn ${k === 'terputus' ? 'putus' : ''}" data-n="${n.id}">
        <span class="bn-atas"><span class="foto">${foto(n)}</span><span class="bn-nama"><b>${esc(namaSlot(n))}</b><span class="st ${k}">${k === 'terputus' ? IKON_PUTUS + ' ' : ''}${esc(STATUS[k])}</span></span>${i === 0 && lambat ? '<span class="bn-peringkat">paling lambat</span>' : ''}</span>
        <span class="bn-utama"><b class="dur ${kls(lambat)}">${lambat ? lama(lambat) : '–'}</b><span>terlambat hari ini</span></span>
        <span class="bn-angka"><span><b>${w.rata != null ? lama(w.rata) : '–'}</b>rata-rata balas</span><span><b class="${w.belum ? 'merah' : ''}">${w.belum || 0}</b>menunggu hari ini</span><span><b>${Number(n.chat_belum_dibalas) || 0}</b>belum dibalas (semua)</span></span>
        ${z ? `<span class="bn-pesan">${z[1] === '1' ? 'Tim → ' : ''}<b>${esc(z[2] && z[2].includes('@') ? nomorHp(z[2]) : z[2])}</b>: ${esc(z[3] || '')}</span>` : '<span class="bn-pesan">Belum ada pesan</span>'}</button>`; }).join('');
  }
  $('#halNomor').addEventListener('click', (e) => { const b = e.target.closest('.bn[data-n]'); if (!b) return; S.nomorAktif = b.dataset.n; S.jejakChats = ''; renderRel(); muatChats(); gantiHal('inbox'); });

  // ---------------------------------------------------------------- [10 Nov] Kelola akun (owner & Mufti) — di halaman Hubungkan
  async function renderAkun() {
    const box = $('#akunBox'); if (!box) return;
    const j = await api('akun_daftar'); if (!j.ok) { box.innerHTML = ''; return; }
    const tgl = (x) => x ? x.slice(8, 10) + '/' + x.slice(5, 7) + ' ' + x.slice(11, 16) : '–';
    box.innerHTML = `<h3>Akun pengguna</h3><p class="kecil">Owner = akses penuh seperti Developer (baca, balas, hubungkan nomor, kelola akun, Audit). Lihat saja = hanya baca chat, Ringkasan & Waktu Balas. Akun baru & reset sandi wajib ganti sandi saat login. Semua perubahan tercatat di Audit.</p>
      <div class="tb-bungkus"><table class="tb tb-w"><thead><tr><th>Nama</th><th>Username</th><th>Peran</th><th>Status</th><th>Login terakhir</th><th>Aksi</th></tr></thead><tbody>
      ${j.erp.map(a => `<tr><td>${esc(a.nama)}</td><td class="mono">${esc(a.username)}</td><td><span class="lewat web">Developer (akun ERP)</span></td><td>Aktif</td><td>–</td><td class="kecil">diatur lewat ERP</td></tr>`).join('')}
      ${j.lokal.map(a => { const diri = -a.id === j.saya; return `<tr data-akun="${a.id}"><td>${esc(a.nama)}${diri ? ' <span class="kecil">(Anda)</span>' : ''}</td><td class="mono">${esc(a.username)}</td>
        <td><select data-ubah="peran" ${diri ? 'disabled' : ''} aria-label="Peran ${esc(a.nama)}"><option value="penuh" ${a.peran === 'penuh' ? 'selected' : ''}>Owner (penuh)</option><option value="lihat" ${a.peran === 'lihat' ? 'selected' : ''}>Lihat saja</option></select></td>
        <td>${a.aktif == 1 ? (a.wajib_ganti == 1 ? '<span class="dur oranye">belum ganti sandi</span>' : 'Aktif') : '<span class="dur merah">Nonaktif</span>'}</td><td class="mono">${tgl(a.login_terakhir)}</td>
        <td class="akun-aksi"><button type="button" class="btn abu" data-reset>Reset sandi</button>${diri ? '' : `<button type="button" class="btn ${a.aktif == 1 ? 'merah' : 'abu'}" data-aktif="${a.aktif == 1 ? 0 : 1}">${a.aktif == 1 ? 'Nonaktifkan' : 'Aktifkan'}</button>`}</td></tr>`; }).join('')}</tbody></table></div>
      <form class="akun-baru" id="akunBaru"><b>Tambah akun</b>
        <label>Nama<input name="nama" required maxlength="120" placeholder="mis. Bu Dewi"></label><label>Username<input name="username" required pattern="[a-z0-9._-]{3,60}" placeholder="huruf kecil" autocapitalize="none"></label>
        <label>Peran<select name="peran"><option value="penuh">Owner (penuh)</option><option value="lihat">Lihat saja</option></select></label>
        <label>Kata sandi awal<input name="sandi" type="password" required minlength="8" autocomplete="new-password"></label><button class="btn" type="submit">Tambah</button></form>`;
  }
  const akunKirim = async (aksi, data, ok) => { const j = await api(aksi, Object.assign({ __post: 1 }, data)); toast(j.ok ? ok : (j.pesan || 'Gagal')); renderAkun(); };
  document.addEventListener('change', (e) => { const sel = e.target.closest('#akunBox select[data-ubah]'); if (!sel) return; const id = sel.closest('tr').dataset.akun; if (confirm('Ubah peran akun ini jadi ' + sel.options[sel.selectedIndex].text + '?')) akunKirim('akun_ubah', { id, peran: sel.value }, 'Peran diubah'); else renderAkun(); });
  document.addEventListener('click', (e) => {
    const r = e.target.closest('#akunBox [data-reset]'), a = e.target.closest('#akunBox [data-aktif]'); if (!r && !a) return;
    const tr = (r || a).closest('tr'), id = tr.dataset.akun, nama = tr.cells[0].textContent.trim();
    if (r) { const s = prompt('Kata sandi sementara untuk ' + nama + ' (min. 8 karakter). Pemilik akun wajib menggantinya saat login berikutnya:'); if (s) akunKirim('akun_reset', { id, sandi: s }, 'Sandi direset, wajib ganti saat login'); }
    if (a && confirm((a.dataset.aktif === '1' ? 'Aktifkan' : 'Nonaktifkan') + ' akun ' + nama + '?')) akunKirim('akun_ubah', { id, aktif: a.dataset.aktif }, a.dataset.aktif === '1' ? 'Akun diaktifkan' : 'Akun dinonaktifkan');
  });
  document.addEventListener('submit', (e) => { const f = e.target.closest('#akunBaru'); if (!f) return; e.preventDefault(); akunKirim('akun_tambah', { nama: f.nama.value, username: f.username.value, peran: f.peran.value, sandi: f.sandi.value }, 'Akun ditambahkan — wajib ganti sandi saat login pertama'); });

  // ---------------------------------------------------------------- [10 Nov] Waktu Balas
  S.rentangWaktu = 'hari';
  async function renderWaktu() {
    const box = $('#halWaktu');
    if (!box.dataset.siap) { box.dataset.siap = 1; box.innerHTML = '<h2>Waktu balas</h2><p>Siapa yang lama membalas. Waktu balas = jam balasan pertama tim − jam pesan masuk pertama yang belum dibalas, <b>hanya jam kerja</b> (Senin–Jumat 08:00–17:00, Sabtu 08:00–12:00). Chat pribadi saja, menurut jam pesan masuk.</p><div class="filter" id="wRentang" role="group" aria-label="Rentang"><button class="saring" data-r="hari">Hari ini</button><button class="saring" data-r="7">7 hari</button><button class="saring" data-r="bulan">Bulan ini</button><span class="kecil" id="wInfo"></span></div><div id="wIsi"><p class="kecil">Memuat…</p></div>'; }
    $$('#wRentang [data-r]').forEach(b => { b.classList.toggle('on', b.dataset.r === S.rentangWaktu); b.setAttribute('aria-pressed', String(b.dataset.r === S.rentangWaktu)); });
    const j = await api('waktu_balas', { rentang: S.rentangWaktu }); if (!j.ok) { $('#wIsi').innerHTML = '<p>Gagal memuat.</p>'; return; }
    const t = j.total, kls = (s) => s > 7200 ? 'merah' : s > 1800 ? 'oranye' : '';
    const dur = (s) => s == null ? '–' : `<span class="dur ${kls(s)}">${lama(s)}</span>`;
    const jam = (x) => x ? (x.slice(0, 10) === new Date(Date.now() + WIB).toISOString().slice(0, 10) ? x.slice(11, 16) : x.slice(8, 10) + '/' + x.slice(5, 7) + ' ' + x.slice(11, 16)) : '–';
    $('#wInfo').textContent = 'Diperbarui tiap menit' + (j.dihitung_at ? ' · terakhir ' + j.dihitung_at.slice(11, 16) : '');
    const angkaKartu = (b, l, k) => `<div class="w-kartu ${k || ''}"><b>${b}</b><span>${l}</span></div>`;
    $('#wIsi').innerHTML = `<div class="w-ringkas">
        ${angkaKartu(lama(t.rata), 'rata-rata', kls(t.rata))}${angkaKartu(lama(t.median), 'median')}${angkaKartu(lama(t.terlama), 'terlama', kls(t.terlama))}
        ${angkaKartu(t.lebih30, 'chat &gt; 30 menit', t.lebih30 ? 'oranye' : '')}${angkaKartu(t.lebih2j, 'chat &gt; 2 jam', t.lebih2j ? 'merah' : '')}${angkaKartu(t.belum, 'belum dibalas', t.belum ? 'merah' : '')}
        ${angkaKartu(t.persen_hp == null ? '–' : String(t.persen_hp).replace('.', ',') + '%', `balasan lewat HP (${t.lewat_hp}/${t.dibalas}) — orangnya belum bisa dilacak`, 'hp')}</div>
      <h3>Per orang <span class="kecil">— urut dari yang paling lama</span></h3>
      <p class="kecil">Orang = akun ERP yang membalas lewat web ini. Balasan yang dikirim langsung dari HP (atau WhatsApp di perangkat lain) tidak membawa nama pengirim, jadi ditulis <b>dari HP – nomor</b>.</p>
      <div class="tb-bungkus"><table class="tb tb-w"><thead><tr><th>Pembalas</th><th>Lewat</th><th>Chat dibalas</th><th>Rata-rata</th><th>Median</th><th>Terlama</th><th>&gt; 30 mnt</th><th>&gt; 2 jam</th></tr></thead><tbody>
      ${j.orang.map(o => `<tr><td>${esc(o.nama)}${o.riwayat ? ` <span class="kecil" title="balasan yang masuk lewat sinkron riwayat WhatsApp">(${o.riwayat} dari riwayat)</span>` : ''}</td><td><span class="lewat ${o.lewat}">${o.lewat === 'web' ? 'web' : 'HP'}</span></td><td class="n">${o.dibalas}</td><td class="n">${dur(o.rata)}</td><td class="n">${dur(o.median)}</td><td class="n">${dur(o.terlama)}</td><td class="n">${o.lebih30}</td><td class="n">${o.lebih2j}</td></tr>`).join('') || '<tr><td colspan="8">Belum ada balasan di rentang ini.</td></tr>'}</tbody></table></div>
      <h3>Per nomor</h3>
      <div class="tb-bungkus"><table class="tb tb-w"><thead><tr><th>Nomor</th><th>Chat masuk</th><th>Dibalas</th><th>Belum dibalas</th><th>Rata-rata</th><th>Median</th><th>Terlama</th><th>&gt; 30 mnt</th><th>&gt; 2 jam</th><th>Lewat HP</th></tr></thead><tbody>
      ${j.nomor.map(n => `<tr><td>${esc(n.nama)}</td><td class="n">${n.giliran}</td><td class="n">${n.dibalas}</td><td class="n">${n.belum ? `<span class="dur merah" title="menunggu terlama ${lama(n.tunggu_terlama)} (jam kerja)">${n.belum}</span>` : 0}</td><td class="n">${dur(n.rata)}</td><td class="n">${dur(n.median)}</td><td class="n">${dur(n.terlama)}</td><td class="n">${n.lebih30}</td><td class="n">${n.lebih2j}</td><td class="n">${n.persen_hp == null ? '–' : String(n.persen_hp).replace('.', ',') + '%'}</td></tr>`).join('') || '<tr><td colspan="10">Belum ada chat masuk di rentang ini.</td></tr>'}</tbody></table></div>
      <h3>20 chat paling lama dibalas</h3>
      <div class="tb-bungkus"><table class="tb tb-w"><thead><tr><th>Kontak</th><th>Nomor</th><th>Masuk</th><th>Dibalas</th><th>Durasi</th><th>Dibalas oleh</th></tr></thead><tbody>
      ${j.terlama.map(x => `<tr class="w-buka" data-chat="${x.chat_id}" tabindex="0" title="Buka chat"><td><b>${esc(x.kontak)}</b>${x.kontak_no && x.kontak_no !== x.kontak ? `<div class="kecil">${esc(x.kontak_no)}</div>` : ''}</td><td>${esc(x.nomor)}</td><td class="mono">${jam(x.masuk)}</td><td class="mono">${jam(x.balas)}</td><td class="n" title="jam kerja · total ${lama(x.detik_total)}">${dur(x.detik)}</td><td>${esc(x.oleh)}${x.lewat === 'riwayat' ? ' <span class="kecil">(riwayat)</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="6">Belum ada.</td></tr>'}</tbody></table></div>`;
  }
  $('#halWaktu').addEventListener('click', (e) => {
    const r = e.target.closest('[data-r]'); if (r) { S.rentangWaktu = r.dataset.r; renderWaktu(); return; }
    const c = e.target.closest('.w-buka'); if (c) { gantiHal('inbox'); bukaChat(Number(c.dataset.chat)); }
  });
  $('#halWaktu').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('w-buka')) { gantiHal('inbox'); bukaChat(Number(e.target.dataset.chat)); } });

  async function renderAudit() {
    const j = await api('audit'), box = $('#halAudit');
    box.innerHTML = `<h2>Audit</h2><p>Semua kirim, edit, hapus, reaksi, dan tandai dibaca dari web, serta siapa yang membuka inbox.</p>
      <div class="tb-bungkus"><table class="tb"><thead><tr><th>Jam</th><th>Oleh</th><th>Aksi</th><th>Nomor</th><th>Isi</th><th>Hasil</th><th>IP</th></tr></thead><tbody>
      ${(j.audit || []).map(a => `<tr><td class="mono">${esc(a.waktu)}</td><td>${esc(a.nama)}</td><td>${esc(a.aksi)}</td><td>${esc(a.nomor_id ? namaNomorId(a.nomor_id, a.nomor_label) : '')}</td><td>${esc(a.isi_ringkas || '')}</td><td>${esc(a.hasil || '')}</td><td class="mono">${esc(a.ip)}</td></tr>`).join('') || '<tr><td colspan="7">Belum ada.</td></tr>'}</tbody></table></div>
      <h3>Akses</h3><div class="tb-bungkus"><table class="tb"><thead><tr><th>Jam</th><th>Oleh</th><th>Aksi</th><th>Keterangan</th><th>IP</th></tr></thead><tbody>
      ${(j.akses || []).map(a => `<tr><td class="mono">${esc(a.waktu)}</td><td>${esc(a.nama || '')}</td><td>${esc(a.aksi)}</td><td>${esc(a.keterangan || '')}${a.chat_id ? ' chat #' + a.chat_id : ''}</td><td class="mono">${esc(a.ip)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  // ---------------------------------------------------------------- jalan
  if (app.dataset.pesan) toast(app.dataset.pesan);
  muatNomor().then(muatChats);
  if (app.dataset.awal && app.dataset.awal !== 'inbox') gantiHal(app.dataset.awal);   // [10 Nov] owner: kartu 6 nomor, akun lihat: Waktu Balas

  // ---------------------------------------------------------------- [10 Nov] petunjuk pasang ke layar utama (sekali, bisa ditutup)
  // iPhone/iPad: Safari & Chrome (iOS 16.4+) sama-sama lewat Bagikan → Tambahkan ke Layar Utama. Android/Chrome desktop: tombol Pasang (beforeinstallprompt).
  (function () {
    const terpasang = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    let tutup = false; try { tutup = localStorage.getItem('pwa_petunjuk') === 'tutup'; } catch (e) {}
    if (terpasang || tutup) return;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const chromeIos = /CriOS/.test(navigator.userAgent);
    const IKON_BAGI = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 7l4-4 4 4M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>';
    function tampil(isi, pasang) {
      const d = document.createElement('div'); d.className = 'pasang'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Pasang aplikasi');
      d.innerHTML = `<img src="/img/apple-touch-icon.png" alt=""><div class="pasang-teks"><b>Pasang Affiliate di layar utama</b><span>${isi}</span></div>${pasang ? '<button type="button" class="btn" data-pasang>Pasang</button>' : ''}<button type="button" class="pasang-tutup" aria-label="Tutup petunjuk">✕</button>`;
      document.body.appendChild(d);
      const simpan = () => { try { localStorage.setItem('pwa_petunjuk', 'tutup'); } catch (e) {} d.remove(); };
      d.querySelector('.pasang-tutup').addEventListener('click', simpan);
      if (pasang) d.querySelector('[data-pasang]').addEventListener('click', async () => { pasang.prompt(); try { await pasang.userChoice; } catch (e) {} simpan(); });
    }
    if (ios) tampil(`Tap <b class="pasang-ikon">${IKON_BAGI} Bagikan</b>${chromeIos ? ' (kanan atas)' : ''} → <b>Tambahkan ke Layar Utama</b>.`);
    else addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); tampil('Buka seperti aplikasi, tanpa bilah browser.', e); });
    addEventListener('appinstalled', () => { try { localStorage.setItem('pwa_petunjuk', 'tutup'); } catch (e) {} const d = $('.pasang'); if (d) d.remove(); });
  })();
  setInterval(() => { if (!document.hidden && S.hal === 'inbox') { muatChats(); if (S.chat) muatPesan(); } }, 3000);
  setInterval(() => { if (!document.hidden) muatNomor(); }, S.hal === 'hubungkan' ? 3000 : 8000);
  setInterval(() => { if (!document.hidden && S.hal === 'hubungkan') muatNomor(); }, 3000);
})();
