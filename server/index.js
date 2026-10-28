/**
 * Inbox Affiliate — 6 nomor WhatsApp kantor tim affiliate Prepare (linked device, Baileys), terpisah dari bot absensi.
 *  - Riwayat penuh (syncFullHistory, mode WhatsApp Desktop), disimpan selamanya; status/story tidak disimpan;
 *    grup hanya disimpan kalau dicentang di halaman Hubungkan (chat.simpan = 1).
 *  - Versi edit & pesan dihapus tetap tersimpan; status centang terkirim/diterima/dibaca; reaction.
 *  - Kirim dari web lewat tabel antrean_kirim: maks 1 aksi per JEDA_KIRIM_MS per nomor, tanpa broadcast/auto-reply.
 *  - Tidak pernah mengirim tanda dibaca otomatis (hanya aksi "tandai_dibaca" dari web).
 *  - Sesi putus → WA ke Mufti maks 1x/hari per nomor; disk > DISK_BATAS_PERSEN → WA 1x/hari; media > 6 bulan dikompres.
 * Konfigurasi: /etc/wa-affiliate.env · data: DATA_DIR (sesi/, media/, unggah/) · log: /var/log/wa-affiliate/server.log
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const mysql = require('mysql2/promise');
const pino = require('pino');
const {
  default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, downloadMediaMessage,
  getContentType, normalizeMessageContent, BufferJSON, jidNormalizedUser, isJidGroup, proto,
} = require('@whiskeysockets/baileys');

// ---------------------------------------------------------------- konfigurasi
const ENV = Object.fromEntries(fs.readFileSync('/etc/wa-affiliate.env', 'utf8').split('\n')
  .filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const DATA = ENV.DATA_DIR || '/var/lib/wa-affiliate';
const JEDA = Number(ENV.JEDA_KIRIM_MS || 2000);
const DISK_BATAS = Number(ENV.DISK_BATAS_PERSEN || 80);
const ERP = ENV.ERP_DB || 'skinlyfe_erp';
const MUFTI = Number(ENV.MUFTI_USER_ID || 3);
const log = (...a) => console.log(new Date(Date.now() + 7 * 3600e3).toISOString().replace('T', ' ').slice(0, 19), ...a);   // WIB
const senyap = pino({ level: 'silent' });
const db = mysql.createPool({ host: ENV.DB_HOST, user: ENV.DB_USER, password: ENV.DB_PASS, database: ENV.DB_NAME,
  charset: 'utf8mb4', connectionLimit: 8, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true });
const q = async (sql, p = []) => (await db.query(sql, p))[0];
const jam = (t) => { const d = t ? new Date(Number(t) * 1000) : new Date(); return new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 19).replace('T', ' '); };
const tglHariIni = () => jam().slice(0, 10);

// ---------------------------------------------------------------- notif WA ke Mufti (antrean japri ERP, dikirim bot absensi)
async function waMufti(kode, isi) {
  try {
    const hp = (await q(`SELECT no_hp FROM ${ERP}.hrd_karyawan WHERE user_id = ? AND no_hp <> '' LIMIT 1`, [MUFTI]))[0];
    if (!hp) return;
    await q(`INSERT IGNORE INTO ${ERP}.wa_japri (kode, no_hp, isi) VALUES (?, ?, ?)`, [kode.slice(0, 120), hp.no_hp, isi]);
  } catch (e) { log('waMufti gagal', e.message); }
}

// ---------------------------------------------------------------- isi pesan
const TEKS_CUPLIKAN = { gambar: '📷 Gambar', video: '🎥 Video', voice: '🎤 Voice note', audio: '🎵 Audio', dokumen: '📄 Dokumen', stiker: 'Stiker', lokasi: '📍 Lokasi', kontak: '👤 Kontak', lain: 'Pesan' };
function urai(msg) {
  const c = normalizeMessageContent(msg.message);
  if (!c) return null;
  const t = getContentType(c);
  if (!t) return null;
  const isi = c[t] || {};
  const ctx = isi.contextInfo || {};
  const o = { tipe: t, kutip: ctx.stanzaId || null, teks: null, jenis: 'lain', media: null };
  switch (t) {
    case 'conversation': o.jenis = 'teks'; o.teks = c.conversation; break;
    case 'extendedTextMessage': o.jenis = 'teks'; o.teks = isi.text; break;
    case 'imageMessage': o.jenis = 'gambar'; o.teks = isi.caption || null; o.media = { mime: isi.mimetype, ukuran: isi.fileLength }; break;
    case 'videoMessage': o.jenis = 'video'; o.teks = isi.caption || null; o.media = { mime: isi.mimetype, ukuran: isi.fileLength, durasi: isi.seconds }; break;
    case 'audioMessage': o.jenis = isi.ptt ? 'voice' : 'audio'; o.media = { mime: isi.mimetype, ukuran: isi.fileLength, durasi: isi.seconds }; break;
    case 'documentMessage': o.jenis = 'dokumen'; o.teks = isi.caption || null; o.media = { mime: isi.mimetype, ukuran: isi.fileLength, nama: isi.fileName }; break;
    case 'documentWithCaptionMessage': { const dm = isi.message && isi.message.documentMessage || {}; o.jenis = 'dokumen'; o.teks = dm.caption || null; o.media = { mime: dm.mimetype, ukuran: dm.fileLength, nama: dm.fileName }; break; }
    case 'stickerMessage': o.jenis = 'stiker'; o.media = { mime: isi.mimetype || 'image/webp', ukuran: isi.fileLength }; break;
    case 'locationMessage': case 'liveLocationMessage': o.jenis = 'lokasi'; o.teks = [isi.name, isi.address, `https://maps.google.com/?q=${isi.degreesLatitude},${isi.degreesLongitude}`].filter(Boolean).join('\n'); break;
    case 'contactMessage': o.jenis = 'kontak'; o.teks = isi.displayName || 'Kontak'; break;
    case 'contactsArrayMessage': o.jenis = 'kontak'; o.teks = (isi.contacts || []).map(x => x.displayName).join(', '); break;
    case 'pollCreationMessage': case 'pollCreationMessageV3': o.jenis = 'lain'; o.teks = '📊 ' + (isi.name || 'Polling'); break;
    case 'protocolMessage': o.jenis = 'protokol'; o.protokol = isi; break;
    case 'reactionMessage': o.jenis = 'reaksi'; o.reaksi = isi; break;
    case 'editedMessage': o.jenis = 'protokol'; o.protokol = (isi.message && isi.message.protocolMessage) || null; break;
    default: o.jenis = 'lain'; o.teks = null;
  }
  return o;
}
const teksDari = (m) => { if (!m) return null; const c = normalizeMessageContent(m); if (!c) return null; const t = getContentType(c); if (!t) return null;
  const x = c[t]; return t === 'conversation' ? c.conversation : (x && (x.text || x.caption)) || null; };

// ---------------------------------------------------------------- sesi per nomor
const SESI = {};          // id -> { sock, status, berhenti }
const grupJudul = {};      // `${id}|${jid}` -> sudah diminta
const chatCache = new Map();

function jidChat(key) {
  // v7: kontak bisa ber-LID; pakai nomor telepon (remoteJidAlt) kalau ada supaya chat tidak terbelah
  const j = key.remoteJidAlt && String(key.remoteJid).endsWith('@lid') ? key.remoteJidAlt : key.remoteJid;
  return isJidGroup(j) ? j : jidNormalizedUser(j);
}
async function chatId(id, jid, judul) {
  const k = id + '|' + jid;
  if (chatCache.has(k) && !judul) return chatCache.get(k);
  const grup = !!isJidGroup(jid);
  await q(`INSERT INTO chat (nomor_id, jid, jenis, judul, simpan) VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE judul = COALESCE(VALUES(judul), judul)`, [id, jid, grup ? 'grup' : 'pribadi', judul || null, grup ? 0 : 1]);
  const r = (await q('SELECT id, simpan, jenis FROM chat WHERE nomor_id = ? AND jid = ?', [id, jid]))[0];
  chatCache.set(k, r);
  return r;
}
async function judulGrup(id, jid) {
  const k = id + '|' + jid; if (grupJudul[k]) return; grupJudul[k] = 1;
  try { const m = await SESI[id].sock.groupMetadata(jid); if (m && m.subject) { chatCache.delete(k); await chatId(id, jid, m.subject); } } catch (e) { /* lewati */ }
}

/** Simpan 1 pesan (masuk / keluar / riwayat). opsi: { riwayat, web: {user_id} } */
async function simpanPesan(id, msg, opsi = {}) {
  if (!msg || !msg.key || !msg.message) return null;
  const jidMentah = msg.key.remoteJid || '';
  if (jidMentah === 'status@broadcast' || jidMentah.endsWith('@newsletter') || jidMentah.endsWith('@broadcast')) return null;   // status/story & saluran tidak disimpan
  const u = urai(msg); if (!u) return null;
  const jid = jidChat(msg.key);
  const ch = await chatId(id, jid);
  if (ch.jenis === 'grup') { judulGrup(id, jid); if (!ch.simpan) return null; }
  const waktu = jam(msg.messageTimestamp || Date.now() / 1000);

  if (u.jenis === 'protokol' && u.protokol) return simpanProtokol(id, ch.id, u.protokol, waktu, !!msg.key.fromMe, opsi);
  if (u.jenis === 'reaksi') return simpanReaksi(id, ch.id, u.reaksi, msg.key, waktu, opsi);

  if (!msg.key.fromMe && msg.pushName && ch.jenis === 'pribadi') await q('INSERT INTO kontak (nomor_id, jid, nama, pertama_dilihat) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE nama = COALESCE(nama, VALUES(nama)), pertama_dilihat = LEAST(pertama_dilihat, VALUES(pertama_dilihat))', [id, jid, msg.pushName, waktu]);
  else if (ch.jenis === 'pribadi') await q('INSERT INTO kontak (nomor_id, jid, pertama_dilihat) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE pertama_dilihat = LEAST(pertama_dilihat, VALUES(pertama_dilihat))', [id, jid, waktu]);

  const status = msg.key.fromMe ? Math.max(1, Math.min(4, (Number(msg.status) || 2) - 1)) : 0;
  const raw = JSON.stringify(msg, BufferJSON.replacer);
  const peng = isJidGroup(jid) ? (msg.key.participantAlt || msg.key.participant || null) : null;
  const r = await q(`INSERT INTO pesan (nomor_id, chat_id, wa_id, dari_tim, pengirim_jid, jenis, teks, kutipan_wa_id, waktu, status, dari_web, web_user_id, dari_riwayat, raw, diterima_server_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE raw = COALESCE(raw, VALUES(raw)), dari_web = GREATEST(dari_web, VALUES(dari_web)), web_user_id = COALESCE(web_user_id, VALUES(web_user_id)),
        status = GREATEST(status, VALUES(status))`,
    [id, ch.id, msg.key.id, msg.key.fromMe ? 1 : 0, peng, u.jenis, u.teks, u.kutip, waktu, status,
     opsi.web ? 1 : 0, opsi.web ? opsi.web.user_id : null, opsi.riwayat ? 1 : 0, raw]);
  const pid = r.insertId || (await q('SELECT id FROM pesan WHERE nomor_id = ? AND chat_id = ? AND wa_id = ?', [id, ch.id, msg.key.id]))[0].id;
  if (u.media) await q('INSERT IGNORE INTO media (pesan_id, mime, nama_file, ukuran, durasi) VALUES (?, ?, ?, ?, ?)', [pid, u.media.mime || null, u.media.nama || null, Number(u.media.ukuran) || null, Number(u.media.durasi) || null]);
  // urutan chat, cuplikan, belum dibalas
  await q(`UPDATE chat SET pesan_terakhir_at = ?, cuplikan = ?, cuplikan_dari_tim = ?,
             belum_dibalas_sejak = CASE WHEN ? = 1 THEN NULL WHEN belum_dibalas_sejak IS NULL THEN ? ELSE belum_dibalas_sejak END
           WHERE id = ? AND (pesan_terakhir_at IS NULL OR pesan_terakhir_at <= ?)`,
    [waktu, (u.teks || TEKS_CUPLIKAN[u.jenis] || '').slice(0, 200), msg.key.fromMe ? 1 : 0, msg.key.fromMe ? 1 : 0, waktu, ch.id, waktu]);
  return pid;
}

/** Edit / hapus untuk semua orang (dari HP tim, kontak, atau web) — versi lama & isi pesan yang dihapus tetap disimpan. */
async function simpanProtokol(id, cid, p, waktu, dariTim, opsi) {
  const target = p.key && p.key.id; if (!target) return null;
  const ps = (await q('SELECT id, teks FROM pesan WHERE nomor_id = ? AND chat_id = ? AND wa_id = ?', [id, cid, target]))[0];
  if (!ps) return null;
  if (p.type === proto.Message.ProtocolMessage.Type.REVOKE) {
    await q('UPDATE pesan SET dihapus_semua_at = COALESCE(dihapus_semua_at, ?) WHERE id = ?', [waktu, ps.id]);
  } else if (p.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT) {
    const baru = teksDari(p.editedMessage);
    if (baru === null || baru === ps.teks) return ps.id;
    const ada = (await q('SELECT COUNT(*) n FROM pesan_versi WHERE pesan_id = ?', [ps.id]))[0].n;
    if (!Number(ada)) await q("INSERT IGNORE INTO pesan_versi (pesan_id, versi_ke, teks, waktu, sumber) SELECT id, 0, teks, waktu, 'asli' FROM pesan WHERE id = ?", [ps.id]);
    const ke = Number((await q('SELECT COALESCE(MAX(versi_ke), 0) + 1 n FROM pesan_versi WHERE pesan_id = ?', [ps.id]))[0].n);
    await q('INSERT INTO pesan_versi (pesan_id, versi_ke, teks, waktu, sumber, web_user_id) VALUES (?, ?, ?, ?, ?, ?)',
      [ps.id, ke, baru, waktu, opsi.web ? 'web' : (dariTim ? 'hp' : 'kontak'), opsi.web ? opsi.web.user_id : null]);
    await q('UPDATE pesan SET teks = ?, diedit = 1 WHERE id = ?', [baru, ps.id]);
  }
  return ps.id;
}
async function simpanReaksi(id, cid, r, keyPengirim, waktu, opsi) {
  const target = r.key && r.key.id; if (!target) return null;
  const ps = (await q('SELECT id FROM pesan WHERE nomor_id = ? AND chat_id = ? AND wa_id = ?', [id, cid, target]))[0];
  if (!ps) return null;
  const siapa = keyPengirim.fromMe ? 'tim' : jidNormalizedUser(keyPengirim.participantAlt || keyPengirim.participant || keyPengirim.remoteJidAlt || keyPengirim.remoteJid);
  if (!r.text) await q('DELETE FROM pesan_reaksi WHERE pesan_id = ? AND jid = ?', [ps.id, siapa]);
  else await q('INSERT INTO pesan_reaksi (pesan_id, jid, emoji, waktu, dari_web, web_user_id) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE emoji = VALUES(emoji), waktu = VALUES(waktu), dari_web = VALUES(dari_web), web_user_id = VALUES(web_user_id)',
    [ps.id, siapa, r.text, waktu, opsi.web ? 1 : 0, opsi.web ? opsi.web.user_id : null]);
  return ps.id;
}
const STATUS = { 2: 1, 3: 2, 4: 3, 5: 4 };   // proto SERVER_ACK/DELIVERY_ACK/READ/PLAYED → 1 terkirim, 2 diterima, 3 dibaca, 4 diputar
async function simpanStatus(id, key, st, t) {
  const s = STATUS[st]; if (!s) return;
  const kol = s === 1 ? 'terkirim_at' : s === 2 ? 'diterima_at' : 'dibaca_at';
  await q(`UPDATE pesan p JOIN chat c ON c.id = p.chat_id SET p.status = GREATEST(p.status, ?), p.${kol} = COALESCE(p.${kol}, ?)
           WHERE p.nomor_id = ? AND c.jid = ? AND p.wa_id = ?`, [s, jam(t), id, jidChat(key), key.id]);
}

// ---------------------------------------------------------------- koneksi
async function mulai(id) {
  if (SESI[id] && SESI[id].sock) return;
  const dir = path.join(DATA, 'sesi', String(id));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const sock = makeWASocket({
    auth: state, logger: senyap, printQRInTerminal: false,
    browser: Browsers.ubuntu('Desktop'),          // platform Desktop → riwayat penuh (identitas 'Mac OS/Desktop' ditolak WhatsApp: kode 428, uji 28 Okt)
    syncFullHistory: true, shouldSyncHistoryMessage: () => true,
    markOnlineOnConnect: false,                    // tidak tampil "online" di kontak
    generateHighQualityLinkPreview: false,
    getMessage: async (key) => {                   // dipakai WhatsApp untuk kirim ulang / dekripsi ulang
      const r = (await q('SELECT raw FROM pesan WHERE nomor_id = ? AND wa_id = ? AND raw IS NOT NULL LIMIT 1', [id, key.id]))[0];
      return r ? JSON.parse(r.raw, BufferJSON.reviver).message : undefined;
    },
  });
  SESI[id] = { sock, status: 'menghubungkan', berhenti: false };
  await q("UPDATE nomor SET status = 'menghubungkan', minta_tautkan = 0 WHERE id = ?", [id]);
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    try {
      if (u.qr) { SESI[id].status = 'perlu_scan'; await q("UPDATE nomor SET status = 'perlu_scan', qr = ?, qr_at = NOW() WHERE id = ?", [u.qr, id]); }
      if (u.connection === 'open') {
        SESI[id].status = 'terhubung';
        await q("UPDATE nomor SET status = 'terhubung', qr = NULL, jid = ?, terakhir_terhubung = NOW(), alasan_putus = NULL WHERE id = ?", [jidNormalizedUser(sock.user && sock.user.id), id]);
        log(`[${id}] terhubung ${sock.user && sock.user.id}`);
      }
      if (u.connection === 'close') {
        const kode = u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output && u.lastDisconnect.error.output.statusCode;
        const keluar = kode === DisconnectReason.loggedOut;
        // QR tidak dipindai sampai habis waktu (belum pernah tertaut) → berhenti, tidak membuat QR terus-menerus; tombol "Tautkan" untuk coba lagi
        const berhenti = (SESI[id] && SESI[id].berhenti) || (!(state.creds && state.creds.me) && kode !== DisconnectReason.restartRequired);
        delete SESI[id];
        const status = keluar ? 'perlu_scan' : 'terputus';
        await q('UPDATE nomor SET status = ?, terakhir_putus = NOW(), alasan_putus = ?, qr = NULL WHERE id = ?', [berhenti ? 'belum' : status, String(kode || 'tutup'), id]);
        log(`[${id}] putus kode ${kode}${keluar ? ' (keluar dari HP)' : ''}`);
        if (keluar || berhenti) { fs.rmSync(dir, { recursive: true, force: true }); }
        if (!berhenti) {
          const n = (await q('SELECT label, notif_putus_tgl, terakhir_terhubung FROM nomor WHERE id = ?', [id]))[0];
          if (n && n.terakhir_terhubung && n.notif_putus_tgl !== tglHariIni()) {
            await q('UPDATE nomor SET notif_putus_tgl = ? WHERE id = ?', [tglHariIni(), id]);
            await waMufti(`wa-aff-putus-${id}-${tglHariIni()}`, `⚠️ Inbox Affiliate: nomor "${n.label}" ${keluar ? 'TERLEPAS (perlu scan QR ulang)' : 'terputus'} (${jam()}).\nCek: https://affiliate.prepareofficial.com/?hal=hubungkan`);
          }
          if (!keluar) setTimeout(() => mulai(id).catch(e => log(`[${id}] gagal sambung ulang`, e.message)), 15000);
        }
      }
    } catch (e) { log(`[${id}] connection.update`, e.message); }
  });

  sock.ev.on('messaging-history.set', async ({ chats, contacts, messages, progress }) => {
    try {
      for (const c of chats || []) { const j = c.id; if (!j || j === 'status@broadcast' || j.endsWith('@newsletter')) continue; if (c.name) await chatId(id, isJidGroup(j) ? j : jidNormalizedUser(j), c.name); }
      for (const k of contacts || []) { if (!k.id || isJidGroup(k.id)) continue; const nm = k.name || k.notify || k.verifiedName; if (nm) await q('UPDATE kontak SET nama = ? WHERE nomor_id = ? AND jid = ?', [nm, id, jidNormalizedUser(k.id)]); }
      for (const m of messages || []) { try { await simpanPesan(id, m, { riwayat: true }); } catch (e) { /* satu pesan gagal tidak menghentikan riwayat */ } }
      if (progress != null) await q('UPDATE nomor SET riwayat_progres = ? WHERE id = ?', [Math.round(progress), id]);
      log(`[${id}] riwayat: ${(messages || []).length} pesan, ${(chats || []).length} chat${progress != null ? ', ' + progress + '%' : ''}`);
    } catch (e) { log(`[${id}] history`, e.message); }
  });
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages) { try { await simpanPesan(id, m); } catch (e) { log(`[${id}] simpan`, e.message); } }
  });
  sock.ev.on('messages.update', async (ups) => {
    for (const { key, update } of ups) {
      try {
        if (update.status) await simpanStatus(id, key, update.status, Date.now() / 1000);
        if (update.message && (update.message.editedMessage || update.message.protocolMessage)) {
          const ch = await chatId(id, jidChat(key));
          const p = update.message.protocolMessage || (update.message.editedMessage.message && update.message.editedMessage.message.protocolMessage);
          if (p) await simpanProtokol(id, ch.id, p, jam(), !!key.fromMe, {});
        }
        if (update.messageStubType === proto.WebMessageInfo.StubType.REVOKE || (update.message === null && update.messageStubType)) {
          await q('UPDATE pesan p JOIN chat c ON c.id = p.chat_id SET p.dihapus_semua_at = COALESCE(p.dihapus_semua_at, NOW()) WHERE p.nomor_id = ? AND c.jid = ? AND p.wa_id = ?', [id, jidChat(key), key.id]);
        }
      } catch (e) { log(`[${id}] update`, e.message); }
    }
  });
  sock.ev.on('message-receipt.update', async (rs) => {
    for (const { key, receipt } of rs) {
      try {
        const t = receipt.playedTimestamp || receipt.readTimestamp || receipt.receiptTimestamp;
        const s = receipt.playedTimestamp ? 4 : receipt.readTimestamp ? 3 : 2;
        const ps = (await q('SELECT p.id FROM pesan p JOIN chat c ON c.id = p.chat_id WHERE p.nomor_id = ? AND c.jid = ? AND p.wa_id = ?', [id, jidChat(key), key.id]))[0];
        if (ps && receipt.userJid) await q('INSERT INTO pesan_terima_grup (pesan_id, jid, status, waktu) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE status = GREATEST(status, VALUES(status)), waktu = VALUES(waktu)', [ps.id, jidNormalizedUser(receipt.userJid), s, jam(t)]);
      } catch (e) { /* lewati */ }
    }
  });
  sock.ev.on('messages.reaction', async (rs) => {
    for (const { key, reaction } of rs) { try { const ch = await chatId(id, jidChat(key)); await simpanReaksi(id, ch.id, { key, text: reaction.text }, reaction.key || key, jam(), {}); } catch (e) { /* lewati */ } }
  });
  sock.ev.on('contacts.upsert', async (ks) => { for (const k of ks) { const nm = k.name || k.notify || k.verifiedName; if (nm && k.id && !isJidGroup(k.id)) await q('UPDATE kontak SET nama = ? WHERE nomor_id = ? AND jid = ?', [nm, id, jidNormalizedUser(k.id)]).catch(() => {}); } });
  sock.ev.on('groups.update', async (gs) => { for (const g of gs) if (g.id && g.subject) { chatCache.delete(id + '|' + g.id); await chatId(id, g.id, g.subject).catch(() => {}); } });
}
async function putuskan(id) {
  const s = SESI[id];
  await q('UPDATE nomor SET minta_putuskan = 0 WHERE id = ?', [id]);
  if (!s) { fs.rmSync(path.join(DATA, 'sesi', String(id)), { recursive: true, force: true }); await q("UPDATE nomor SET status = 'belum', qr = NULL WHERE id = ?", [id]); return; }
  s.berhenti = true;
  try { await s.sock.logout(); } catch (e) { try { s.sock.end(); } catch (e2) { /* */ } }
}

// ---------------------------------------------------------------- media (unduh di latar, 2 sekaligus)
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'application/pdf': 'pdf' };
const jalankan = (cmd, args) => new Promise((ok, no) => execFile(cmd, args, { timeout: 300000 }, (e, so, se) => e ? no(new Error(String(se || e.message).slice(-200))) : ok(so)));
let mediaJalan = 0;
async function prosesMedia() {
  if (mediaJalan >= 2) return;
  const r = (await q(`SELECT m.id, m.mime, m.nama_file, p.nomor_id, p.raw, p.waktu, p.jenis FROM media m JOIN pesan p ON p.id = m.pesan_id
                      WHERE m.status = 'antre' AND m.percobaan < 3 ORDER BY p.dari_riwayat, m.id DESC LIMIT 1`))[0];
  if (!r || !SESI[r.nomor_id] || SESI[r.nomor_id].status !== 'terhubung') return;
  mediaJalan++;
  await q('UPDATE media SET percobaan = percobaan + 1 WHERE id = ?', [r.id]);
  try {
    const msg = JSON.parse(r.raw, BufferJSON.reviver), sock = SESI[r.nomor_id].sock;
    const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: senyap, reuploadRequest: sock.updateMediaMessage });
    const mime = String(r.mime || '').split(';')[0].trim();
    const ext = (r.nama_file && path.extname(r.nama_file).slice(1).replace(/[^a-z0-9]/gi, '').slice(0, 8)) || EXT[mime] || 'bin';
    const rel = path.join(String(r.nomor_id), r.waktu.slice(0, 7), `${r.id}.${ext}`), abs = path.join(DATA, 'media', rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, buf);
    let putar = null;
    if (r.jenis === 'voice' || r.jenis === 'audio' && mime === 'audio/ogg') {   // ogg/opus → m4a supaya bisa diputar di iPhone
      putar = rel.replace(/\.[^.]+$/, '') + '.m4a';
      try { await jalankan('ffmpeg', ['-y', '-loglevel', 'error', '-i', abs, '-c:a', 'aac', '-b:a', '48k', path.join(DATA, 'media', putar)]); } catch (e) { putar = null; }
    }
    await q("UPDATE media SET status = 'ok', path = ?, path_putar = ?, ukuran = ?, galat = NULL WHERE id = ?", [rel, putar, buf.length, r.id]);
  } catch (e) {
    await q("UPDATE media SET status = IF(percobaan >= 3, 'gagal', 'antre'), galat = ? WHERE id = ?", [String(e.message).slice(0, 200), r.id]);
  } finally { mediaJalan--; }
}

// ---------------------------------------------------------------- antrean kirim dari web (1 aksi per JEDA per nomor)
const terakhirKirim = {};
async function prosesAntrean() {
  const rows = await q("SELECT * FROM antrean_kirim WHERE status = 'menunggu' ORDER BY id LIMIT 20");
  for (const a of rows) {
    const s = SESI[a.nomor_id];
    if (!s || s.status !== 'terhubung') continue;
    if (Date.now() - (terakhirKirim[a.nomor_id] || 0) < JEDA) continue;
    terakhirKirim[a.nomor_id] = Date.now();
    await q("UPDATE antrean_kirim SET status = 'diproses' WHERE id = ? AND status = 'menunggu'", [a.id]);
    let hasil = 'terkirim', galat = null, waId = null;
    try {
      const ch = (await q('SELECT jid FROM chat WHERE id = ?', [a.chat_id]))[0];
      const target = a.target_pesan_id ? (await q('SELECT wa_id, raw, waktu, dari_tim, teks FROM pesan WHERE id = ?', [a.target_pesan_id]))[0] : null;
      const tMsg = target && target.raw ? JSON.parse(target.raw, BufferJSON.reviver) : null;
      const web = { user_id: a.user_id };
      const opsiKirim = tMsg && ['teks', 'gambar', 'dokumen', 'voice'].includes(a.aksi) ? { quoted: tMsg } : {};
      let isiKirim = null;
      if (a.aksi === 'teks') isiKirim = { text: a.isi };
      else if (a.aksi === 'gambar') isiKirim = { image: fs.readFileSync(a.media_path), caption: a.isi || undefined, mimetype: a.mime || 'image/jpeg' };
      else if (a.aksi === 'dokumen') isiKirim = { document: fs.readFileSync(a.media_path), mimetype: a.mime || 'application/octet-stream', fileName: a.nama_file || 'dokumen', caption: a.isi || undefined };
      else if (a.aksi === 'voice') {
        const ogg = a.media_path + '.ogg';
        await jalankan('ffmpeg', ['-y', '-loglevel', 'error', '-i', a.media_path, '-vn', '-c:a', 'libopus', '-b:a', '32k', '-ac', '1', '-ar', '48000', ogg]);
        isiKirim = { audio: fs.readFileSync(ogg), mimetype: 'audio/ogg; codecs=opus', ptt: true };
      } else if (a.aksi === 'reaksi') isiKirim = { react: { text: a.isi || '', key: tMsg.key } };
      else if (a.aksi === 'edit') {
        if (!tMsg || !target.dari_tim) throw new Error('hanya pesan tim yang bisa diedit');
        if (Date.now() - new Date(target.waktu.replace(' ', 'T') + '+07:00').getTime() > 15 * 60e3) throw new Error('lewat batas edit 15 menit');
        isiKirim = { text: a.isi, edit: tMsg.key };
      } else if (a.aksi === 'hapus_semua') {
        if (!tMsg || !target.dari_tim) throw new Error('hanya pesan tim yang bisa dihapus untuk semua orang');
        if (Date.now() - new Date(target.waktu.replace(' ', 'T') + '+07:00').getTime() > 2 * 86400e3) throw new Error('lewat batas hapus ±2 hari');
        isiKirim = { delete: tMsg.key };
      } else if (a.aksi === 'hapus_saya') {
        await s.sock.chatModify({ deleteForMe: { deleteMedia: false, key: tMsg.key, timestamp: Number(tMsg.messageTimestamp) } }, ch.jid);
        await q('UPDATE pesan SET dihapus_saya_at = NOW() WHERE id = ?', [a.target_pesan_id]);
      } else if (a.aksi === 'tandai_dibaca') {
        const ks = await q('SELECT raw FROM pesan WHERE chat_id = ? AND dari_tim = 0 AND raw IS NOT NULL ORDER BY waktu DESC LIMIT 20', [a.chat_id]);
        await s.sock.readMessages(ks.map(k => JSON.parse(k.raw, BufferJSON.reviver).key));
      }
      if (isiKirim) {
        const m = await s.sock.sendMessage(ch.jid, isiKirim, opsiKirim);
        waId = m && m.key && m.key.id;
        if (a.aksi === 'edit') await simpanProtokol(a.nomor_id, a.chat_id, { type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT, key: tMsg.key, editedMessage: { conversation: a.isi } }, jam(), true, { web });
        else if (a.aksi === 'hapus_semua') await q('UPDATE pesan SET dihapus_semua_at = COALESCE(dihapus_semua_at, NOW()) WHERE id = ?', [a.target_pesan_id]);
        else if (a.aksi === 'reaksi') await simpanReaksi(a.nomor_id, a.chat_id, { key: tMsg.key, text: a.isi || '' }, { fromMe: true }, jam(), { web });
        else if (m) await simpanPesan(a.nomor_id, m, { web });
      }
    } catch (e) { hasil = 'gagal'; galat = String(e.message || e).slice(0, 250); }
    await q('UPDATE antrean_kirim SET status = ?, galat = ?, wa_id = ?, dikirim_at = NOW() WHERE id = ?', [hasil, galat, waId, a.id]);
    await q('UPDATE audit_web SET hasil = ? WHERE antrean_id = ?', [hasil === 'terkirim' ? 'berhasil' : 'gagal: ' + galat, a.id]);
    log(`[${a.nomor_id}] antrean #${a.id} ${a.aksi}: ${hasil}${galat ? ' ' + galat : ''}`);
  }
}

// ---------------------------------------------------------------- ringkasan harian, waktu balas, disk, kompres
async function hitungRingkasan(tgl) {
  for (const n of await q('SELECT id FROM nomor')) {
    const ps = await q(`SELECT p.chat_id, p.dari_tim, p.waktu FROM pesan p JOIN chat c ON c.id = p.chat_id
                        WHERE p.nomor_id = ? AND c.jenis = 'pribadi' AND p.waktu BETWEEN ? AND ? AND p.dihapus_saya_at IS NULL ORDER BY p.chat_id, p.waktu`, [n.id, tgl + ' 00:00:00', tgl + ' 23:59:59']);
    const masuk = new Set(), keluar = new Set(); let pm = 0, pk = 0, jumlah = 0, total = 0, belum = 0, tunggu = null, chatSkr = null;
    const tutupChat = () => { if (tunggu) { const batas = tgl === tglHariIni() ? new Date(jam().replace(' ', 'T')) : new Date(tgl + 'T23:59:59'); if (batas - tunggu > 3600e3) belum++; } tunggu = null; };
    for (const p of ps) {
      if (p.chat_id !== chatSkr) { tutupChat(); chatSkr = p.chat_id; }
      const t = new Date(p.waktu.replace(' ', 'T'));
      if (p.dari_tim) { keluar.add(p.chat_id); pk++; if (tunggu) { const d = (t - tunggu) / 1000; jumlah++; total += d; if (d > 3600) belum++; tunggu = null; } }
      else { masuk.add(p.chat_id); pm++; if (!tunggu) tunggu = t; }
    }
    tutupChat();
    const kb = (await q('SELECT COUNT(*) n FROM kontak WHERE nomor_id = ? AND DATE(pertama_dilihat) = ?', [n.id, tgl]))[0].n;
    await q(`INSERT INTO ringkasan_harian (tanggal, nomor_id, chat_masuk, chat_keluar, pesan_masuk, pesan_keluar, kontak_baru, waktu_balas_rata_detik, belum_dibalas_1jam, dihitung_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE chat_masuk = VALUES(chat_masuk), chat_keluar = VALUES(chat_keluar), pesan_masuk = VALUES(pesan_masuk),
             pesan_keluar = VALUES(pesan_keluar), kontak_baru = VALUES(kontak_baru), waktu_balas_rata_detik = VALUES(waktu_balas_rata_detik), belum_dibalas_1jam = VALUES(belum_dibalas_1jam), dihitung_at = NOW()`,
      [tgl, n.id, masuk.size, keluar.size, pm, pk, kb, jumlah ? Math.round(total / jumlah) : null, belum]);
  }
}
async function hitungBalasChat(semua) {
  const chats = await q(`SELECT id FROM chat WHERE jenis = 'pribadi' ${semua ? '' : 'AND pesan_terakhir_at >= NOW() - INTERVAL 1 DAY'}`);
  for (const c of chats) {
    const ps = await q('SELECT dari_tim, waktu FROM pesan WHERE chat_id = ? ORDER BY waktu', [c.id]);
    let tunggu = null, n = 0, tot = 0;
    for (const p of ps) { const t = new Date(p.waktu.replace(' ', 'T')); if (p.dari_tim) { if (tunggu) { n++; tot += (t - tunggu) / 1000; tunggu = null; } } else if (!tunggu) tunggu = t; }
    await q('UPDATE chat SET waktu_balas_rata_detik = ?, belum_dibalas_sejak = ? WHERE id = ?', [n ? Math.round(tot / n) : null, tunggu ? jam(tunggu.getTime() / 1000) : null, c.id]);
  }
}
async function cekDisk() {
  try {
    const o = await jalankan('df', ['-P', DATA]); const pakai = Number((o.split('\n')[1] || '').split(/\s+/)[4].replace('%', ''));
    if (pakai > DISK_BATAS) {
      const kode = 'disk-' + tglHariIni();
      const r = await q('INSERT IGNORE INTO notif_sistem (kode, dikirim_at) VALUES (?, NOW())', [kode]);
      if (r.affectedRows) await waMufti('wa-aff-' + kode, `⚠️ Disk server ${pakai}% terpakai (batas ${DISK_BATAS}%). Inbox Affiliate menyimpan riwayat & media di ${DATA}.`);
    }
  } catch (e) { log('cek disk', e.message); }
}
async function kompresMedia() {   // media > 6 bulan: gambar max 1280 px kualitas 60, video 720p CRF 32
  const rows = await q(`SELECT m.id, m.path, m.mime, m.ukuran FROM media m JOIN pesan p ON p.id = m.pesan_id
                        WHERE m.status = 'ok' AND m.dikompres_at IS NULL AND p.waktu < NOW() - INTERVAL 6 MONTH AND (m.mime LIKE 'image/%' OR m.mime LIKE 'video/%') LIMIT 50`);
  for (const m of rows) {
    const abs = path.join(DATA, 'media', m.path), tmp = abs + '.kompres' + path.extname(abs);
    try {
      if (/^image\/(jpeg|png)/.test(m.mime)) await jalankan('convert', [abs, '-resize', '1280x1280>', '-quality', '60', tmp]);
      else if (/^video\//.test(m.mime)) await jalankan('ffmpeg', ['-y', '-loglevel', 'error', '-i', abs, '-vf', "scale='min(1280,iw)':-2", '-c:v', 'libx264', '-crf', '32', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '64k', tmp]);
      else { await q('UPDATE media SET dikompres_at = NOW() WHERE id = ?', [m.id]); continue; }
      const baru = fs.statSync(tmp).size, lama = fs.statSync(abs).size;
      if (baru < lama) { fs.renameSync(tmp, abs); await q('UPDATE media SET dikompres_at = NOW(), ukuran_asli = ?, ukuran = ? WHERE id = ?', [lama, baru, m.id]); }
      else { fs.unlinkSync(tmp); await q('UPDATE media SET dikompres_at = NOW() WHERE id = ?', [m.id]); }
    } catch (e) { try { fs.unlinkSync(tmp); } catch (e2) { /* */ } await q('UPDATE media SET dikompres_at = NOW() WHERE id = ?', [m.id]); }
  }
}

// ---------------------------------------------------------------- putaran utama
async function kendali() {   // permintaan dari halaman Hubungkan
  for (const n of await q('SELECT id, minta_tautkan, minta_putuskan, aktif FROM nomor')) {
    if (n.minta_putuskan) await putuskan(n.id);
    else if (n.minta_tautkan && !SESI[n.id]) await mulai(n.id);
  }
}
async function utama() {
  log('Inbox Affiliate mulai');
  for (const n of await q('SELECT id FROM nomor WHERE aktif = 1')) if (fs.existsSync(path.join(DATA, 'sesi', String(n.id), 'creds.json'))) mulai(n.id).catch(e => log(`[${n.id}]`, e.message));
  const ulang = (f, ms, nama) => { let jalan = false; setInterval(async () => { if (jalan) return; jalan = true; try { await f(); } catch (e) { log(nama, e.message); } finally { jalan = false; } }, ms); };
  ulang(kendali, 2000, 'kendali');
  ulang(prosesAntrean, 500, 'antrean');
  ulang(prosesMedia, 700, 'media');
  ulang(prosesMedia, 900, 'media2');
  ulang(async () => { await hitungRingkasan(tglHariIni()); await hitungBalasChat(false); }, 10 * 60e3, 'ringkasan');
  ulang(async () => { const k = new Date(Date.now() + 7 * 3600e3 - 86400e3).toISOString().slice(0, 10); await hitungRingkasan(k); }, 60 * 60e3, 'ringkasan-kemarin');
  ulang(cekDisk, 60 * 60e3, 'disk');
  ulang(async () => { if (jam().slice(11, 13) === '03') await kompresMedia(); }, 10 * 60e3, 'kompres');
  setTimeout(() => cekDisk(), 5000);
}
process.on('unhandledRejection', (e) => log('unhandled', e && e.message));
utama().catch(e => { log('gagal mulai', e.message); process.exit(1); });
