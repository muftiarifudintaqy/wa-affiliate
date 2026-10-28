/* Inbox Affiliate — tampilan mirip WhatsApp Web. Semua aksi tulis lewat antrean server (maks 1 per 2 detik per nomor). */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const app = $('#app'); if (!app) return;
  let CSRF = app.dataset.csrf;
  const S = { nomor: [], nomorAktif: 'semua', chats: [], chat: null, pesan: [], kutip: null, hal: 'inbox', jejak: '', palingLama: 0 };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const tglPanjang = (t) => { const d = new Date(t.slice(0, 10) + 'T00:00:00'); return HARI[d.getDay()] + ', ' + d.getDate() + ' ' + BULAN[d.getMonth()] + ' ' + d.getFullYear(); };
  const jamDetik = (t) => t ? t.slice(11, 19) : '';
  const nomorHp = (jid) => { const n = String(jid || '').split('@')[0].split(':')[0]; return /^\d+$/.test(n) ? '+' + n : n; };
  const durasi = (s) => { if (s == null) return '–'; s = Number(s); return s < 60 ? s + ' dtk' : s < 3600 ? Math.round(s / 60) + ' mnt' : (s / 3600).toFixed(1).replace('.', ',') + ' jam'; };
  const toast = (t) => { const e = $('#toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => e.hidden = true, 3500); };

  async function api(aksi, p, form) {
    const opsi = { credentials: 'same-origin', headers: { 'X-CSRF': CSRF } };
    let url = '/api.php?aksi=' + aksi;
    if (form) { opsi.method = 'POST'; opsi.body = form; }
    else if (p && p.__post) { opsi.method = 'POST'; const f = new FormData(); Object.keys(p).forEach(k => k !== '__post' && f.append(k, p[k])); opsi.body = f; }
    else if (p) url += '&' + new URLSearchParams(p).toString();
    const r = await fetch(url, opsi);
    const j = await r.json().catch(() => ({ ok: false, pesan: 'Server tidak menjawab' }));
    if (j.login) { location.href = '/'; throw new Error('sesi habis'); }
    if (j.csrf) CSRF = j.csrf;
    return j;
  }
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
    const j = await api('nomor'); if (!j.ok) return;
    S.nomor = j.nomor; renderRel();
    if (S.hal === 'hubungkan') renderHubungkan();
  }
  function renderRel() {
    const belum = {}; S.chats.forEach(c => { if (Number(c.belum_dibalas) > 0) belum[c.nomor_id] = (belum[c.nomor_id] || 0) + 1; });
    $('#relNomor').innerHTML = `<button class="rel-n ${S.nomorAktif === 'semua' ? 'on' : ''}" data-n="semua" title="Semua nomor">Semua</button>` +
      S.nomor.map(n => `<button class="rel-n ${String(S.nomorAktif) === String(n.id) ? 'on' : ''}" data-n="${n.id}" title="${esc(n.label)} · ${esc(n.status)}">${esc((n.label.match(/\d+/) || [n.id])[0])}<i class="${esc(n.status)}"></i>${S.nomorAktif === 'semua' && belum[n.id] ? '<b>' + belum[n.id] + '</b>' : ''}</button>`).join('');
    const n = S.nomor.find(x => String(x.id) === String(S.nomorAktif));
    $('#judulNomor').textContent = n ? n.label : 'Semua nomor';
    $('#statusNomor').textContent = n ? ({ terhubung: 'terhubung', perlu_scan: 'perlu scan QR', terputus: 'terputus', belum: 'belum ditautkan', menghubungkan: 'menghubungkan…' })[n.status] || n.status : '';
  }
  $('#relNomor').addEventListener('click', (e) => { const b = e.target.closest('.rel-n'); if (!b) return; S.nomorAktif = b.dataset.n; renderRel(); muatChats(); gantiHal('inbox'); });
  $$('.rel-btn[data-hal]').forEach(b => b.addEventListener('click', () => gantiHal(b.dataset.hal)));
  function gantiHal(h) {
    S.hal = h; $$('.rel-btn[data-hal]').forEach(b => b.classList.toggle('on', b.dataset.hal === h));
    $('#halInbox').hidden = h !== 'inbox'; $('#halRingkasan').hidden = h !== 'ringkasan'; $('#halHubungkan').hidden = h !== 'hubungkan'; $('#halAudit').hidden = h !== 'audit';
    if (h === 'ringkasan') renderRingkasan(); if (h === 'hubungkan') renderHubungkan(); if (h === 'audit') renderAudit();
  }

  // ---------------------------------------------------------------- daftar chat
  async function muatChats() {
    const j = await api('chats', { nomor: S.nomorAktif }); if (!j.ok) return;
    const jejak = S.nomorAktif + JSON.stringify(j.chats);
    if (jejak === S.jejakChats) return;            // tidak berubah → jangan gambar ulang (hover & klik tidak terganggu)
    S.jejakChats = jejak; S.chats = j.chats; renderChats(); renderRel();
  }
  function renderChats() {
    const ul = $('#daftarChat');
    if (!S.chats.length) { ul.innerHTML = '<li class="kosong-obrolan kecil">Belum ada chat. Tautkan nomor di halaman Hubungkan (🔗).</li>'; return; }
    ul.innerHTML = S.chats.map(c => {
      const nama = c.nama || nomorHp(c.jid), inisial = (nama.replace(/[^A-Za-z0-9]/g, '')[0] || '#').toUpperCase();
      const hariIni = c.pesan_terakhir_at && c.pesan_terakhir_at.slice(0, 10) === new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
      return `<li class="chat-i ${S.chat && S.chat.id == c.id ? 'on' : ''}" data-id="${c.id}">
        <div class="ava ${c.jenis === 'grup' ? 'grup' : ''}">${esc(inisial)}</div>
        <div style="min-width:0"><div class="chat-nama">${esc(nama)}</div><div class="chat-cup">${c.cuplikan_dari_tim == 1 ? '↪ ' : ''}${esc(c.cuplikan || '')}</div></div>
        <div class="chat-kanan"><span class="chat-jam">${c.pesan_terakhir_at ? (hariIni ? c.pesan_terakhir_at.slice(11, 16) : c.pesan_terakhir_at.slice(8, 10) + '/' + c.pesan_terakhir_at.slice(5, 7)) : ''}</span>
          ${S.nomorAktif === 'semua' ? `<span class="tag-n">${esc(c.nomor_label)}</span>` : ''}${Number(c.belum_dibalas) > 0 ? `<span class="lencana" title="belum dibalas sejak ${esc(c.belum_dibalas_sejak)}">${c.belum_dibalas}</span>` : ''}</div></li>`;
    }).join('');
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
      box.innerHTML = (c.chats || []).map(x => `<div class="hasil-i" data-chat="${x.id}"><b>${esc(x.nama || nomorHp(x.jid))}</b> <span class="tag-n">${esc(x.nomor_label)}</span><div class="kecil">${esc(nomorHp(x.jid))}</div></div>`).join('') +
        (j.hasil || []).map(x => `<div class="hasil-i" data-chat="${x.chat_id}"><b>${esc(x.nama || nomorHp(x.jid))}</b> <span class="tag-n">${esc(x.nomor_label)}</span> <span class="kecil mono">${esc(x.waktu)}</span><div class="kecil">${x.dari_tim == 1 ? 'Tim: ' : ''}${esc(x.teks || '').replace(re, '<mark>$1</mark>')}</div></div>`).join('') || '<div class="hasil-i kecil">Tidak ada hasil.</div>';
      box.hidden = false; $('#daftarChat').hidden = true;
    }, 350);
  });
  $('#hasilCari').addEventListener('click', (e) => { const h = e.target.closest('[data-chat]'); if (h) bukaChat(Number(h.dataset.chat)); });

  // ---------------------------------------------------------------- isi percakapan
  async function bukaChat(id) {
    S.chat = { id }; S.kutip = null; $('#kutipBar').hidden = true; S.jejak = ''; S.palingLama = 0;
    $('#halInbox').classList.add('buka'); $('#kosongObrolan').hidden = true; $('#obrolanAtas').hidden = false; $('#tulis').hidden = false;
    $$('.chat-i').forEach(li => li.classList.toggle('on', Number(li.dataset.id) === id));
    await muatPesan(true);
    $('#isiPesan').scrollTop = 1e9; $('#ketik').focus();
  }
  $('#kembali').addEventListener('click', () => { $('#halInbox').classList.remove('buka'); });
  async function muatPesan(pertama) {
    if (!S.chat) return;
    const id = S.chat.id, j = await api('pesan', pertama === true ? { chat: id } : { chat: id, diam: 1 });
    if (!j.ok || !S.chat || S.chat.id !== id) return;
    S.chat = j.chat;
    const jejak = JSON.stringify(j.pesan.map(p => [p.id, p.status, p.teks, p.dihapus_semua_at, p.reaksi, p.media_status, p.jumlah_versi]));
    if (jejak === S.jejak && pertama !== true) return;
    S.jejak = jejak;
    if (pertama === true || !S.pesan.length) S.pesan = j.pesan;
    else { const lama = S.pesan.filter(p => p.id < j.pesan[0].id); S.pesan = lama.concat(j.pesan); }
    S.palingLama = S.pesan.length ? S.pesan[0].id : 0;
    $('#namaChat').textContent = j.chat.nama || nomorHp(j.chat.jid);
    $('#infoChat').innerHTML = `${esc(nomorHp(j.chat.jid))} · <span class="tag-n">${esc(j.chat.nomor_label)}</span> · rata-rata balas ${durasi(j.chat.waktu_balas_rata_detik)}${j.chat.belum_dibalas_sejak ? ` · <b style="color:var(--oranye)">belum dibalas sejak ${esc(j.chat.belum_dibalas_sejak.slice(11, 19))}</b>` : ''}${j.chat.nomor_status !== 'terhubung' ? ' · <b style="color:var(--oranye)">nomor tidak terhubung</b>' : ''}`;
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
    if (p.media_status !== 'ok') return `<div class="media-tunggu">${p.media_status === 'gagal' ? 'Media tidak bisa diunduh dari WhatsApp' : 'Media sedang diunduh…'}</div>`;
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
    const m = document.createElement('div'); m.className = 'menu';
    m.innerHTML = `<div class="emo">${['👍', '❤️', '😂', '😮', '😢', '🙏'].map(x => `<button data-r="${x}">${x}</button>`).join('')}<button data-r="" title="Hapus reaksi">✕</button></div>
      <button data-a="balas">Balas</button>
      ${p.teks ? '<button data-a="salin">Salin teks</button>' : ''}
      <button data-a="edit" ${bisaEdit ? '' : 'disabled title="Hanya pesan teks tim, maks 15 menit"'}>Edit</button>
      <button data-a="hapus_semua" ${bisaHapusSemua ? '' : 'disabled title="Hanya pesan tim, maks ±2 hari"'}>Hapus untuk semua orang</button>
      <button data-a="hapus_saya">Hapus untuk saya</button>
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
  const grupTerbuka = {};
  async function renderHubungkan() {
    const box = $('#halHubungkan');
    if (!box.dataset.siap) { box.dataset.siap = 1; box.innerHTML = '<h2>Hubungkan nomor</h2><p>Di HP tim: WhatsApp → Perangkat tertaut → Tautkan perangkat, lalu pindai QR. HP tetap bisa dipakai seperti biasa. Riwayat chat lama ikut ditarik penuh setelah tertaut.</p><div class="kartu-n" id="kartuN"></div>'; }
    const wadah = $('#kartuN'), fokus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.label : null;
    wadah.innerHTML = S.nomor.map(n => `<div class="kn" data-n="${n.id}">
      <div class="kn-atas"><input value="${esc(n.label)}" data-label="${n.id}" aria-label="Label nomor ${n.id}"><span class="st ${esc(n.status)}">${({ terhubung: 'terhubung', perlu_scan: 'perlu scan', terputus: 'terputus', belum: 'belum ditautkan', menghubungkan: 'menghubungkan' })[n.status] || n.status}</span></div>
      ${n.status === 'perlu_scan' && n.qr ? `<div class="qr" data-qr="${esc(n.qr)}"></div><div class="kecil">QR berganti otomatis tiap ±20 detik.</div>` : ''}
      <dl><dt>Nomor</dt><dd>${esc(n.jid ? nomorHp(n.jid) : '–')}</dd><dt>Terhubung</dt><dd>${esc(n.terakhir_terhubung || '–')}</dd><dt>Putus</dt><dd>${esc(n.terakhir_putus || '–')}${n.alasan_putus ? ' (' + esc(n.alasan_putus) + ')' : ''}</dd>
        <dt>Riwayat</dt><dd>${n.riwayat_progres != null ? esc(n.riwayat_progres) + '%' : '–'}</dd><dt>Pesan</dt><dd>${Number(n.jumlah_pesan).toLocaleString('id-ID')} · ${Number(n.jumlah_chat).toLocaleString('id-ID')} chat</dd>
        <dt>Paling lama</dt><dd>${esc(n.pesan_terlama || '–')}</dd><dt>Media antre</dt><dd>${Number(n.media_antre).toLocaleString('id-ID')}</dd></dl>
      <div class="kn-aksi">${n.status === 'terhubung' ? '' : `<button class="btn" data-tautkan="${n.id}">${n.status === 'perlu_scan' ? 'Muat QR baru' : 'Tautkan'}</button>`}
        ${n.status !== 'belum' ? `<button class="btn merah" data-putuskan="${n.id}">Putuskan</button>` : ''}
        <button class="btn abu" data-grup="${n.id}">${grupTerbuka[n.id] ? 'Tutup daftar grup' : 'Pilih grup affiliate'}</button></div>
      ${grupTerbuka[n.id] ? `<div class="grup-l" id="grup${n.id}">memuat…</div>` : ''}</div>`).join('');
    $$('.qr', wadah).forEach(el => { try { new QRCode(el, { text: el.dataset.qr, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.L }); } catch (e) { el.textContent = 'QR gagal dibuat'; } });
    Object.keys(grupTerbuka).forEach(id => grupTerbuka[id] && muatGrup(id));
    if (fokus) { const i = $(`[data-label="${fokus}"]`); if (i) i.focus(); }
  }
  async function muatGrup(id) {
    const j = await api('grup', { nomor: id }), el = $('#grup' + id); if (!el) return;
    el.innerHTML = (j.grup || []).length ? j.grup.map(g => `<label><input type="checkbox" data-g="${g.id}" ${g.simpan == 1 ? 'checked' : ''}> ${esc(g.judul || g.jid)}</label>`).join('') : '<span class="kecil">Belum ada grup terdeteksi.</span>';
  }
  $('#halHubungkan').addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tautkan]'), p = e.target.closest('[data-putuskan]'), g = e.target.closest('[data-grup]');
    if (t) { await api('tautkan', { __post: 1, nomor: t.dataset.tautkan }); toast('Menyiapkan QR…'); }
    if (p && confirm('Putuskan nomor ini dari Inbox? Riwayat yang sudah tersimpan tetap ada.')) { await api('putuskan', { __post: 1, nomor: p.dataset.putuskan }); toast('Diputuskan'); }
    if (g) { grupTerbuka[g.dataset.grup] = !grupTerbuka[g.dataset.grup]; renderHubungkan(); }
    setTimeout(muatNomor, 1500);
  });
  $('#halHubungkan').addEventListener('change', async (e) => {
    if (e.target.dataset.g) { await api('grup_simpan', { __post: 1, chat: e.target.dataset.g, simpan: e.target.checked ? 1 : 0 }); toast(e.target.checked ? 'Grup akan disimpan mulai sekarang' : 'Grup tidak disimpan lagi'); }
  });
  $('#halHubungkan').addEventListener('focusout', async (e) => {
    const id = e.target.dataset.label; if (!id) return;
    const n = S.nomor.find(x => String(x.id) === id); if (!n || n.label === e.target.value.trim() || !e.target.value.trim()) return;
    await api('label', { __post: 1, nomor: id, label: e.target.value.trim() }); toast('Label disimpan'); muatNomor();
  });

  // ---------------------------------------------------------------- Ringkasan & Audit
  async function renderRingkasan(dari, sampai) {
    const box = $('#halRingkasan'), j = await api('ringkasan', dari ? { dari, sampai } : {});
    const per = {}; (j.baris || []).forEach(r => { const k = r.label; per[k] = per[k] || { cm: 0, ck: 0, kb: 0, bl: 0, bal: [], n: 0 }; const x = per[k]; x.cm += +r.chat_masuk; x.ck += +r.chat_keluar; x.kb += +r.kontak_baru; x.bl += +r.belum_dibalas_1jam; if (r.waktu_balas_rata_detik != null) x.bal.push(+r.waktu_balas_rata_detik); });
    box.innerHTML = `<h2>Ringkasan harian</h2><p>Chat pribadi per nomor per hari. Waktu balas = jarak pesan kontak ke balasan tim berikutnya. Dihitung ulang tiap 10 menit.</p>
      <div class="filter"><label>Dari <input type="date" id="rDari" value="${esc(j.dari)}"></label><label>Sampai <input type="date" id="rSampai" value="${esc(j.sampai)}"></label><button class="btn" id="rTampil">Tampilkan</button></div>
      <div class="tb-bungkus"><table class="tb"><thead><tr><th>Nomor</th><th>Chat masuk</th><th>Chat keluar</th><th>Kontak baru</th><th>Rata-rata balas</th><th>Belum dibalas &gt; 1 jam</th></tr></thead><tbody>
      ${Object.keys(per).map(k => { const x = per[k]; return `<tr><td>${esc(k)}</td><td class="n">${x.cm}</td><td class="n">${x.ck}</td><td class="n">${x.kb}</td><td class="n">${x.bal.length ? durasi(Math.round(x.bal.reduce((a, b) => a + b, 0) / x.bal.length)) : '–'}</td><td class="n">${x.bl}</td></tr>`; }).join('') || '<tr><td colspan="6">Belum ada data.</td></tr>'}</tbody></table></div>
      <div class="tb-bungkus"><table class="tb"><thead><tr><th>Tanggal</th><th>Nomor</th><th>Chat masuk</th><th>Chat keluar</th><th>Pesan masuk</th><th>Pesan keluar</th><th>Kontak baru</th><th>Rata-rata balas</th><th>Belum dibalas &gt; 1 jam</th></tr></thead><tbody>
      ${(j.baris || []).map(r => `<tr><td class="mono">${esc(r.tanggal)}</td><td>${esc(r.label)}</td><td class="n">${r.chat_masuk}</td><td class="n">${r.chat_keluar}</td><td class="n">${r.pesan_masuk}</td><td class="n">${r.pesan_keluar}</td><td class="n">${r.kontak_baru}</td><td class="n">${durasi(r.waktu_balas_rata_detik)}</td><td class="n">${r.belum_dibalas_1jam}</td></tr>`).join('')}</tbody></table></div>`;
    $('#rTampil').onclick = () => renderRingkasan($('#rDari').value, $('#rSampai').value);
  }
  async function renderAudit() {
    const j = await api('audit'), box = $('#halAudit');
    box.innerHTML = `<h2>Audit</h2><p>Semua kirim, edit, hapus, reaksi, dan tandai dibaca dari web, serta siapa yang membuka inbox.</p>
      <div class="tb-bungkus"><table class="tb"><thead><tr><th>Jam</th><th>Oleh</th><th>Aksi</th><th>Nomor</th><th>Isi</th><th>Hasil</th><th>IP</th></tr></thead><tbody>
      ${(j.audit || []).map(a => `<tr><td class="mono">${esc(a.waktu)}</td><td>${esc(a.nama)}</td><td>${esc(a.aksi)}</td><td>${esc(a.nomor_label || '')}</td><td>${esc(a.isi_ringkas || '')}</td><td>${esc(a.hasil || '')}</td><td class="mono">${esc(a.ip)}</td></tr>`).join('') || '<tr><td colspan="7">Belum ada.</td></tr>'}</tbody></table></div>
      <h3>Akses</h3><div class="tb-bungkus"><table class="tb"><thead><tr><th>Jam</th><th>Oleh</th><th>Aksi</th><th>Keterangan</th><th>IP</th></tr></thead><tbody>
      ${(j.akses || []).map(a => `<tr><td class="mono">${esc(a.waktu)}</td><td>${esc(a.nama || '')}</td><td>${esc(a.aksi)}</td><td>${esc(a.keterangan || '')}${a.chat_id ? ' chat #' + a.chat_id : ''}</td><td class="mono">${esc(a.ip)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  // ---------------------------------------------------------------- jalan
  muatNomor().then(muatChats);
  setInterval(() => { if (!document.hidden && S.hal === 'inbox') { muatChats(); if (S.chat) muatPesan(); } }, 3000);
  setInterval(() => { if (!document.hidden) muatNomor(); }, S.hal === 'hubungkan' ? 3000 : 8000);
  setInterval(() => { if (!document.hidden && S.hal === 'hubungkan') muatNomor(); }, 3000);
})();
