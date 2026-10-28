<?php
/* Inbox Affiliate — inti web: konfigurasi, DB, sesi login (akun ERP, hanya user di IZIN_USER_ID), CSRF, log akses, header keamanan. */
declare(strict_types=1);
date_default_timezone_set('Asia/Jakarta');

// tidak boleh diindeks mesin pencari, tidak boleh dibingkai situs lain
header('X-Robots-Tag: noindex, nofollow, noarchive, nosnippet');
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

function env(): array {
    static $e = null;
    if ($e === null) {
        $e = [];
        foreach (@file('/etc/wa-affiliate.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $l)
            if (($p = strpos($l, '=')) !== false) $e[trim(substr($l, 0, $p))] = trim(substr($l, $p + 1));
    }
    return $e;
}
function db(): PDO {
    static $p = null;
    if ($p) return $p;
    $e = env();
    $p = new PDO('mysql:host=' . ($e['DB_HOST'] ?? 'localhost') . ';dbname=' . ($e['DB_NAME'] ?? 'wa_affiliate') . ';charset=utf8mb4', $e['DB_USER'] ?? '', $e['DB_PASS'] ?? '',
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
    $p->exec("SET time_zone = '+07:00'");
    return $p;
}
function q(string $sql, array $p = []): PDOStatement { $s = db()->prepare($sql); $s->execute($p); return $s; }
function izin_user(): array { return array_values(array_filter(array_map('intval', explode(',', env()['IZIN_USER_ID'] ?? '3')))); }
function ip(): string { return substr((string)($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45); }
function ua(): string { return substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255); }

// ---- sesi: folder sendiri, cookie aman, habis setelah 8 jam tidak aktif
const IDLE_DETIK = 8 * 3600;
session_save_path((env()['DATA_DIR'] ?? '/var/lib/wa-affiliate') . '/php-sesi');
ini_set('session.gc_maxlifetime', (string)IDLE_DETIK);
ini_set('session.use_strict_mode', '1');
session_name('WAAFF');
session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Lax']);
session_start();
if (!empty($_SESSION['uid']) && (time() - (int)($_SESSION['aktif'] ?? 0)) > IDLE_DETIK) { $_SESSION = []; session_destroy(); session_start(); }
if (!empty($_SESSION['uid'])) $_SESSION['aktif'] = time();
if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(24));

function user(): ?array { return !empty($_SESSION['uid']) && in_array((int)$_SESSION['uid'], izin_user(), true) ? ['id' => (int)$_SESSION['uid'], 'nama' => (string)$_SESSION['nama']] : null; }
function catat_akses(string $aksi, ?int $nomor = null, ?int $chat = null, ?string $ket = null): void {
    $u = user();
    q('INSERT INTO akses_log (user_id, nama, aksi, nomor_id, chat_id, keterangan, ip, user_agent, waktu) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [$u['id'] ?? null, $u['nama'] ?? null, $aksi, $nomor, $chat, $ket !== null ? mb_substr($ket, 0, 255) : null, ip(), ua()]);
}
function catat_audit(string $aksi, ?int $nomor, ?int $chat, ?int $pesan, ?int $antrean, ?string $isi): void {
    $u = user();
    q('INSERT INTO audit_web (user_id, nama, aksi, nomor_id, chat_id, pesan_id, antrean_id, isi_ringkas, hasil, ip, user_agent, waktu) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [$u['id'], $u['nama'], $aksi, $nomor, $chat, $pesan, $antrean, $isi !== null ? mb_substr($isi, 0, 255) : null, $antrean ? 'menunggu' : 'berhasil', ip(), ua()]);
}

/** Login dengan akun ERP (password_verify; md5 lama seperti ERP). Hanya user di IZIN_USER_ID & status Aktif. Maks 5 gagal / 15 menit per IP. */
function coba_login(string $nama, string $sandi): string {
    $gagal = (int)q("SELECT COUNT(*) FROM akses_log WHERE ip = ? AND aksi = 'login_gagal' AND waktu > NOW() - INTERVAL 15 MINUTE", [ip()])->fetchColumn();
    if ($gagal >= 5) return 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.';
    $erp = env()['ERP_DB'] ?? 'skinlyfe_erp';
    $u = q("SELECT id, full_name, password, status FROM `$erp`.user WHERE (username = ? OR email = ?) LIMIT 1", [$nama, $nama])->fetch();
    $ok = $u && (password_verify($sandi, (string)$u['password']) || hash_equals((string)$u['password'], md5($sandi)));
    if (!$ok || $u['status'] !== 'Aktif' || !in_array((int)$u['id'], izin_user(), true)) {
        q("INSERT INTO akses_log (user_id, nama, aksi, keterangan, ip, user_agent, waktu) VALUES (?, ?, 'login_gagal', ?, ?, ?, NOW())",
          [$u['id'] ?? null, $u['full_name'] ?? null, mb_substr('akun: ' . $nama . ($ok ? ' (tidak diizinkan)' : ''), 0, 255), ip(), ua()]);
        return 'Akun atau kata sandi salah, atau akun ini tidak punya akses.';
    }
    session_regenerate_id(true);
    $_SESSION['uid'] = (int)$u['id']; $_SESSION['nama'] = (string)$u['full_name']; $_SESSION['aktif'] = time(); $_SESSION['csrf'] = bin2hex(random_bytes(24));
    catat_akses('login');
    return '';
}
function json_out($x, int $kode = 200): void { http_response_code($kode); header('Content-Type: application/json; charset=utf-8'); header('Cache-Control: no-store'); echo json_encode($x, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); exit; }
function wajib_login_api(): array { $u = user(); if (!$u) json_out(['ok' => false, 'pesan' => 'Sesi habis, silakan masuk lagi.', 'login' => true], 401); return $u; }
function wajib_csrf(): void { if (!hash_equals((string)$_SESSION['csrf'], (string)($_SERVER['HTTP_X_CSRF'] ?? ''))) json_out(['ok' => false, 'pesan' => 'Token tidak valid, muat ulang halaman.'], 403); }
function e(?string $s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
