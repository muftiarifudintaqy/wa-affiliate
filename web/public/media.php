<?php
/* Inbox Affiliate — media pesan (gambar, video, voice note, dokumen, stiker). Wajib login; file di luar folder web; dicatat. */
require __DIR__ . '/../inc/boot.php';
if (!user()) { http_response_code(401); exit('Silakan masuk.'); }
$m = q('SELECT m.*, p.nomor_id, p.chat_id FROM media m JOIN pesan p ON p.id = m.pesan_id WHERE m.id = ?', [(int)($_GET['id'] ?? 0)])->fetch();
if (!$m || $m['status'] !== 'ok') { http_response_code(404); exit('Media belum tersedia.'); }
$akar = realpath((env()['DATA_DIR'] ?? '/var/lib/wa-affiliate') . '/media');
$rel = (!empty($_GET['putar']) && $m['path_putar']) ? $m['path_putar'] : $m['path'];
$f = realpath($akar . '/' . $rel);
if (!$f || strpos($f, $akar . '/') !== 0 || !is_file($f)) { http_response_code(404); exit('File tidak ada.'); }
// catat pembukaan media (maks 1 baris per media per sesi)
if (empty($_SESSION['media_dicatat'][$m['id']])) { $_SESSION['media_dicatat'][$m['id']] = 1; catat_akses('buka_media', (int)$m['nomor_id'], (int)$m['chat_id'], 'media #' . $m['id']); }
session_write_close();

$mime = $rel === $m['path_putar'] ? 'audio/mp4' : (preg_replace('/;.*/', '', (string)$m['mime']) ?: 'application/octet-stream');
$ukuran = filesize($f); $mulai = 0; $akhir = $ukuran - 1;
header('Content-Type: ' . $mime);
header('Cache-Control: private, max-age=86400');
header('Accept-Ranges: bytes');
$unduh = !empty($_GET['unduh']) || !preg_match('#^(image|video|audio)/#', $mime);
$nama = $m['nama_file'] ?: ('media-' . $m['id'] . '.' . pathinfo($f, PATHINFO_EXTENSION));
header('Content-Disposition: ' . ($unduh ? 'attachment' : 'inline') . '; filename="' . str_replace('"', '', $nama) . '"');
if (isset($_SERVER['HTTP_RANGE']) && preg_match('/bytes=(\d*)-(\d*)/', $_SERVER['HTTP_RANGE'], $r)) {
    if ($r[1] !== '') $mulai = (int)$r[1];
    if ($r[2] !== '') $akhir = min((int)$r[2], $ukuran - 1);
    if ($r[1] === '' && $r[2] !== '') { $mulai = max(0, $ukuran - (int)$r[2]); $akhir = $ukuran - 1; }
    if ($mulai > $akhir || $mulai >= $ukuran) { http_response_code(416); header("Content-Range: bytes */$ukuran"); exit; }
    http_response_code(206); header("Content-Range: bytes $mulai-$akhir/$ukuran");
}
header('Content-Length: ' . ($akhir - $mulai + 1));
$h = fopen($f, 'rb'); fseek($h, $mulai); $sisa = $akhir - $mulai + 1;
while ($sisa > 0 && !feof($h)) { $b = fread($h, min(65536, $sisa)); echo $b; $sisa -= strlen($b); flush(); }
fclose($h);
