<?php
/* Inbox Affiliate — API JSON. Semua aksi wajib login (hanya user di IZIN_USER_ID); aksi tulis wajib header X-CSRF.
   Kirim/edit/hapus/reaksi/tandai dibaca TIDAK langsung ke WhatsApp: masuk antrean_kirim (diproses server WA maks 1 per 2 detik per nomor). */
require __DIR__ . '/../inc/boot.php';
$u = wajib_login_api();
$aksi = (string)($_GET['aksi'] ?? '');
$post = $_SERVER['REQUEST_METHOD'] === 'POST';
if ($post) wajib_csrf();
$in = fn(string $k, $d = null) => $_POST[$k] ?? $_GET[$k] ?? $d;
$int = fn(string $k) => (int)$in($k, 0);
const MAKS_UNGGAH = 64 * 1024 * 1024;

function pesan_info(int $id): array {
    $p = q('SELECT p.*, c.nomor_id cnomor, c.jid cjid, n.status nstatus FROM pesan p JOIN chat c ON c.id = p.chat_id JOIN nomor n ON n.id = p.nomor_id WHERE p.id = ?', [$id])->fetch();
    if (!$p) json_out(['ok' => false, 'pesan' => 'Pesan tidak ditemukan'], 404);
    return $p;
}
function antre(array $c, string $aksi, array $data, ?string $ringkas): int {
    if ($c['nstatus'] !== 'terhubung') json_out(['ok' => false, 'pesan' => 'Nomor ini sedang tidak terhubung ke WhatsApp.']);
    $tunggu = (int)q("SELECT COUNT(*) FROM antrean_kirim WHERE nomor_id = ? AND status IN ('menunggu','diproses')", [$c['nomor_id']])->fetchColumn();
    if ($tunggu >= 20) json_out(['ok' => false, 'pesan' => 'Antrean nomor ini masih penuh, tunggu sebentar.']);   // anti kirim massal
    $u = user();
    q('INSERT INTO antrean_kirim (nomor_id, chat_id, aksi, isi, media_path, nama_file, mime, target_pesan_id, user_id, user_nama, dibuat_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [$c['nomor_id'], $c['chat_id'], $aksi, $data['isi'] ?? null, $data['media_path'] ?? null, $data['nama_file'] ?? null, $data['mime'] ?? null, $data['target'] ?? null, $u['id'], $u['nama']]);
    $id = (int)db()->lastInsertId();
    catat_audit($aksi, (int)$c['nomor_id'], (int)$c['chat_id'], $data['target'] ?? null, $id, $ringkas);
    return $id;
}
function chat_info(int $id): array {
    $c = q('SELECT c.id chat_id, c.nomor_id, c.jid, c.jenis, n.status nstatus FROM chat c JOIN nomor n ON n.id = c.nomor_id WHERE c.id = ?', [$id])->fetch();
    if (!$c) json_out(['ok' => false, 'pesan' => 'Chat tidak ditemukan'], 404);
    return $c;
}

switch ($aksi) {

case 'nomor':   // status 6 nomor + laporan riwayat (pesan paling lama & jumlah pesan)
    $r = q("SELECT n.id, n.label, n.jid, n.status, n.qr, n.qr_at, n.riwayat_progres, n.terakhir_terhubung, n.terakhir_putus, n.alasan_putus,
              (SELECT COUNT(*) FROM pesan p WHERE p.nomor_id = n.id) jumlah_pesan, (SELECT MIN(waktu) FROM pesan p WHERE p.nomor_id = n.id) pesan_terlama,
              (SELECT COUNT(*) FROM chat c WHERE c.nomor_id = n.id AND c.jenis = 'pribadi') jumlah_chat,
              (SELECT COUNT(*) FROM media m JOIN pesan p ON p.id = m.pesan_id WHERE p.nomor_id = n.id AND m.status = 'antre') media_antre
            FROM nomor n WHERE n.aktif = 1 ORDER BY n.id")->fetchAll();
    json_out(['ok' => true, 'nomor' => $r, 'csrf' => $_SESSION['csrf']]);

case 'chats':
    $nomor = $in('nomor', 'semua'); $cari = trim((string)$in('cari', '')); $sebelum = (string)$in('sebelum', '');
    $w = ['(c.jenis = "pribadi" OR c.simpan = 1)', 'c.pesan_terakhir_at IS NOT NULL']; $p = [];
    if ($nomor !== 'semua') { $w[] = 'c.nomor_id = ?'; $p[] = (int)$nomor; }
    if ($sebelum !== '') { $w[] = 'c.pesan_terakhir_at < ?'; $p[] = $sebelum; }
    if ($cari !== '') { $angka = preg_replace('/\D/', '', $cari); $l = '%' . $cari . '%';
        $w[] = '(c.judul LIKE ? OR k.nama LIKE ?' . ($angka !== '' ? ' OR c.jid LIKE ?' : '') . ')'; array_push($p, $l, $l); if ($angka !== '') $p[] = '%' . $angka . '%'; }
    $r = q('SELECT c.id, c.nomor_id, n.label nomor_label, c.jid, c.jenis, COALESCE(c.judul, k.nama) nama, c.cuplikan, c.cuplikan_dari_tim, c.pesan_terakhir_at, c.belum_dibalas_sejak, c.waktu_balas_rata_detik,
              IF(c.belum_dibalas_sejak IS NULL, 0, (SELECT COUNT(*) FROM pesan x WHERE x.chat_id = c.id AND x.dari_tim = 0 AND x.waktu >= c.belum_dibalas_sejak)) belum_dibalas
            FROM chat c JOIN nomor n ON n.id = c.nomor_id LEFT JOIN kontak k ON k.nomor_id = c.nomor_id AND k.jid = c.jid
            WHERE ' . implode(' AND ', $w) . ' ORDER BY c.pesan_terakhir_at DESC LIMIT 60', $p)->fetchAll();
    json_out(['ok' => true, 'chats' => $r]);

case 'pesan':   // isi 1 chat (terbaru dulu, halaman per 60), lengkap: media, kutipan, reaksi, status, versi, tanda dari web
    $chat = $int('chat'); $c = chat_info($chat); $sebelum = $int('sebelum_id');
    if (!$sebelum && empty($_GET['diam'])) catat_akses('buka_chat', (int)$c['nomor_id'], $chat);
    $r = q('SELECT p.id, p.wa_id, p.dari_tim, p.pengirim_jid, p.jenis, p.teks, p.kutipan_wa_id, p.waktu, p.status, p.terkirim_at, p.diterima_at, p.dibaca_at, p.diedit,
              p.dihapus_semua_at, p.dihapus_saya_at, p.dari_web, p.web_user_id, p.dari_riwayat,
              m.id media_id, m.mime, m.nama_file, m.ukuran, m.durasi, m.status media_status, m.path_putar IS NOT NULL bisa_putar,
              q.id kutip_id, q.teks kutip_teks, q.jenis kutip_jenis, q.dari_tim kutip_dari_tim,
              (SELECT GROUP_CONCAT(CONCAT(r.emoji, "|", r.jid, "|", r.dari_web) SEPARATOR ";") FROM pesan_reaksi r WHERE r.pesan_id = p.id) reaksi,
              (SELECT COUNT(*) FROM pesan_versi v WHERE v.pesan_id = p.id) jumlah_versi,
              (SELECT nama FROM kontak k WHERE k.nomor_id = p.nomor_id AND k.jid = p.pengirim_jid) pengirim_nama
            FROM pesan p LEFT JOIN media m ON m.pesan_id = p.id LEFT JOIN pesan q ON q.chat_id = p.chat_id AND q.wa_id = p.kutipan_wa_id
            WHERE p.chat_id = ? ' . ($sebelum ? 'AND p.id < ? ' : '') . 'ORDER BY p.waktu DESC, p.id DESC LIMIT 60', $sebelum ? [$chat, $sebelum] : [$chat])->fetchAll();
    $info = q('SELECT c.id, c.nomor_id, n.label nomor_label, n.status nomor_status, c.jid, c.jenis, COALESCE(c.judul, k.nama) nama, c.waktu_balas_rata_detik, c.belum_dibalas_sejak
               FROM chat c JOIN nomor n ON n.id = c.nomor_id LEFT JOIN kontak k ON k.nomor_id = c.nomor_id AND k.jid = c.jid WHERE c.id = ?', [$chat])->fetch();
    json_out(['ok' => true, 'chat' => $info, 'pesan' => array_reverse($r), 'sekarang' => date('Y-m-d H:i:s')]);

case 'cari':   // kata / nomor di semua chat
    $s = trim((string)$in('q', '')); if (mb_strlen($s) < 2) json_out(['ok' => true, 'hasil' => []]);
    $r = q('SELECT p.id, p.chat_id, p.nomor_id, n.label nomor_label, p.teks, p.waktu, p.dari_tim, COALESCE(c.judul, k.nama) nama, c.jid
            FROM pesan p JOIN chat c ON c.id = p.chat_id JOIN nomor n ON n.id = p.nomor_id LEFT JOIN kontak k ON k.nomor_id = c.nomor_id AND k.jid = c.jid
            WHERE (c.jenis = "pribadi" OR c.simpan = 1) AND (p.teks LIKE ?' . (preg_replace('/\D/', '', $s) !== '' ? ' OR c.jid LIKE ?' : '') . ') ORDER BY p.waktu DESC LIMIT 80',
            preg_replace('/\D/', '', $s) !== '' ? ['%' . $s . '%', '%' . preg_replace('/\D/', '', $s) . '%'] : ['%' . $s . '%'])->fetchAll();
    catat_akses('cari', null, null, $s);
    json_out(['ok' => true, 'hasil' => $r]);

case 'versi':
    $p = pesan_info($int('pesan'));
    $v = q('SELECT v.versi_ke, v.teks, v.waktu, v.sumber, v.web_user_id FROM pesan_versi v WHERE v.pesan_id = ? ORDER BY v.versi_ke', [$p['id']])->fetchAll();
    json_out(['ok' => true, 'versi' => $v]);

case 'kirim':   // teks / gambar / dokumen / voice ke SATU chat (tanpa broadcast)
    if (!$post) json_out(['ok' => false], 405);
    $c = chat_info($int('chat')); $jenis = (string)$in('jenis', 'teks'); $isi = trim((string)$in('isi', ''));
    $kutip = $int('kutip') ?: null; if ($kutip) pesan_info($kutip);
    if (!in_array($jenis, ['teks', 'gambar', 'dokumen', 'voice'], true)) json_out(['ok' => false, 'pesan' => 'Jenis tidak dikenal']);
    $data = ['isi' => $isi !== '' ? mb_substr($isi, 0, 4000) : null, 'target' => $kutip];
    if ($jenis === 'teks') { if ($isi === '') json_out(['ok' => false, 'pesan' => 'Pesan kosong']); }
    else {
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) json_out(['ok' => false, 'pesan' => 'File gagal diunggah']);
        if ($f['size'] > MAKS_UNGGAH) json_out(['ok' => false, 'pesan' => 'File maksimal 64 MB']);
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']) ?: 'application/octet-stream';
        if ($jenis === 'gambar' && !preg_match('#^image/(jpeg|png|webp)$#', $mime)) json_out(['ok' => false, 'pesan' => 'Gambar harus JPG/PNG/WEBP']);
        if ($jenis === 'voice' && !preg_match('#^(audio|video)/#', $mime)) json_out(['ok' => false, 'pesan' => 'Rekaman suara tidak valid']);
        $dir = (env()['DATA_DIR'] ?? '/var/lib/wa-affiliate') . '/unggah/' . date('Y-m');
        if (!is_dir($dir)) mkdir($dir, 0750, true);
        $tujuan = $dir . '/' . date('His') . '-' . bin2hex(random_bytes(6)) . '.bin';
        if (!move_uploaded_file($f['tmp_name'], $tujuan)) json_out(['ok' => false, 'pesan' => 'Gagal menyimpan file']);
        $data += ['media_path' => $tujuan, 'mime' => $mime, 'nama_file' => mb_substr(basename((string)$f['name']), 0, 200)];
    }
    $id = antre($c, $jenis, $data, $jenis === 'teks' ? $isi : ($jenis . ': ' . ($data['nama_file'] ?? '') . ($isi !== '' ? ' — ' . $isi : '')));
    json_out(['ok' => true, 'antrean' => $id]);

case 'edit':
    if (!$post) json_out(['ok' => false], 405);
    $p = pesan_info($int('pesan')); $isi = trim((string)$in('isi', ''));
    if (!$p['dari_tim'] || $p['jenis'] !== 'teks') json_out(['ok' => false, 'pesan' => 'Hanya pesan teks dari tim yang bisa diedit']);
    if (time() - strtotime($p['waktu']) > 15 * 60) json_out(['ok' => false, 'pesan' => 'Lewat batas edit WhatsApp (15 menit)']);
    if ($isi === '' || $isi === $p['teks']) json_out(['ok' => false, 'pesan' => 'Teks baru kosong / sama']);
    $id = antre(['nomor_id' => $p['nomor_id'], 'chat_id' => $p['chat_id'], 'nstatus' => $p['nstatus']], 'edit', ['isi' => mb_substr($isi, 0, 4000), 'target' => (int)$p['id']], 'edit: ' . $isi);
    json_out(['ok' => true, 'antrean' => $id]);

case 'hapus':
    if (!$post) json_out(['ok' => false], 405);
    $p = pesan_info($int('pesan')); $mode = $in('mode') === 'semua' ? 'hapus_semua' : 'hapus_saya';
    if ($mode === 'hapus_semua') {
        if (!$p['dari_tim']) json_out(['ok' => false, 'pesan' => 'Hanya pesan tim yang bisa dihapus untuk semua orang']);
        if (time() - strtotime($p['waktu']) > 2 * 86400) json_out(['ok' => false, 'pesan' => 'Lewat batas hapus untuk semua orang (±2 hari)']);
    }
    $id = antre(['nomor_id' => $p['nomor_id'], 'chat_id' => $p['chat_id'], 'nstatus' => $p['nstatus']], $mode, ['target' => (int)$p['id']], mb_substr((string)$p['teks'], 0, 200));
    json_out(['ok' => true, 'antrean' => $id]);

case 'reaksi':
    if (!$post) json_out(['ok' => false], 405);
    $p = pesan_info($int('pesan')); $emoji = mb_substr(trim((string)$in('emoji', '')), 0, 8);
    $id = antre(['nomor_id' => $p['nomor_id'], 'chat_id' => $p['chat_id'], 'nstatus' => $p['nstatus']], 'reaksi', ['isi' => $emoji, 'target' => (int)$p['id']], $emoji === '' ? 'hapus reaksi' : $emoji);
    json_out(['ok' => true, 'antrean' => $id]);

case 'tandai_dibaca':
    if (!$post) json_out(['ok' => false], 405);
    $c = chat_info($int('chat'));
    json_out(['ok' => true, 'antrean' => antre($c, 'tandai_dibaca', [], 'tandai dibaca')]);

case 'antrean':   // status kiriman (untuk tanda jam/centang di tampilan)
    $r = q('SELECT id, aksi, status, galat, wa_id, dikirim_at FROM antrean_kirim WHERE id = ?', [$int('id')])->fetch();
    json_out(['ok' => (bool)$r, 'antrean' => $r]);

// ---------------- halaman Hubungkan
case 'tautkan': case 'putuskan':
    if (!$post) json_out(['ok' => false], 405);
    $n = $int('nomor'); if ($n < 1 || $n > 6) json_out(['ok' => false, 'pesan' => 'Nomor tidak valid']);
    q($aksi === 'tautkan' ? 'UPDATE nomor SET minta_tautkan = 1 WHERE id = ?' : 'UPDATE nomor SET minta_putuskan = 1 WHERE id = ?', [$n]);
    catat_akses('hubungkan', $n, null, $aksi);
    json_out(['ok' => true]);
case 'label':
    if (!$post) json_out(['ok' => false], 405);
    $n = $int('nomor'); $l = trim(mb_substr((string)$in('label', ''), 0, 80)); if ($l === '') json_out(['ok' => false, 'pesan' => 'Label kosong']);
    q('UPDATE nomor SET label = ? WHERE id = ?', [$l, $n]); catat_akses('hubungkan', $n, null, 'label: ' . $l);
    json_out(['ok' => true]);
case 'grup':
    $r = q("SELECT id, nomor_id, jid, judul, simpan, pesan_terakhir_at FROM chat WHERE jenis = 'grup' AND nomor_id = ? ORDER BY simpan DESC, judul", [$int('nomor')])->fetchAll();
    json_out(['ok' => true, 'grup' => $r]);
case 'grup_simpan':
    if (!$post) json_out(['ok' => false], 405);
    q("UPDATE chat SET simpan = ? WHERE id = ? AND jenis = 'grup'", [$int('simpan') ? 1 : 0, $int('chat')]);
    catat_akses('hubungkan', null, $int('chat'), 'grup simpan=' . ($int('simpan') ? 1 : 0));
    json_out(['ok' => true]);

// ---------------- ringkasan & audit
case 'ringkasan':
    $dari = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$in('dari')) ? $in('dari') : date('Y-m-d', strtotime('-6 day'));
    $sampai = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$in('sampai')) ? $in('sampai') : date('Y-m-d');
    $r = q('SELECT r.*, n.label FROM ringkasan_harian r JOIN nomor n ON n.id = r.nomor_id WHERE r.tanggal BETWEEN ? AND ? ORDER BY r.tanggal DESC, r.nomor_id', [$dari, $sampai])->fetchAll();
    json_out(['ok' => true, 'dari' => $dari, 'sampai' => $sampai, 'baris' => $r]);
case 'audit':
    $r = q('SELECT a.*, n.label nomor_label FROM audit_web a LEFT JOIN nomor n ON n.id = a.nomor_id ORDER BY a.id DESC LIMIT 200')->fetchAll();
    $l = q('SELECT * FROM akses_log ORDER BY id DESC LIMIT 200')->fetchAll();
    json_out(['ok' => true, 'audit' => $r, 'akses' => $l]);

default:
    json_out(['ok' => false, 'pesan' => 'Aksi tidak dikenal'], 400);
}
