<?php
/* [10 Nov] Kelola akun LIHAT SAJA Inbox Affiliate. Sandi dibaca dari stdin (tidak masuk argumen/log), disimpan password_hash, tidak pernah dicetak.
   php akun-lihat.php daftar
   php akun-lihat.php tambah <username> <nama...>   (sandi awal dari stdin; wajib diganti saat login pertama)
   php akun-lihat.php reset <username>              (sandi sementara dari stdin; wajib diganti lagi)
   php akun-lihat.php nonaktif|aktif <username> */
if (PHP_SAPI !== 'cli') exit;
require __DIR__ . '/../inc/boot.php';
[$aksi, $un] = [$argv[1] ?? '', strtolower(trim($argv[2] ?? ''))];
$sandi = function () { $s = rtrim((string)stream_get_contents(STDIN), "\r\n"); if (mb_strlen($s) < 8) { fwrite(STDERR, "sandi dari stdin minimal 8 karakter\n"); exit(1); } return $s; };
switch ($aksi) {
case 'daftar':
    foreach (q('SELECT username, nama, aktif, wajib_ganti, dibuat_at, sandi_diganti_at, login_terakhir FROM akun_lihat ORDER BY id')->fetchAll() as $a)
        printf("%-12s %-16s %s %s login terakhir %s\n", $a['username'], $a['nama'], $a['aktif'] ? 'aktif' : 'NONAKTIF', $a['wajib_ganti'] ? 'wajib ganti sandi' : 'sandi sudah diganti ' . $a['sandi_diganti_at'], $a['login_terakhir'] ?? '-');
    break;
case 'tambah':
    $nama = trim(implode(' ', array_slice($argv, 3)));
    if (!preg_match('/^[a-z0-9._-]{3,60}$/', $un) || $nama === '') { fwrite(STDERR, "username (a-z 0-9 . _ -) & nama wajib\n"); exit(1); }
    if (q('SELECT 1 FROM akun_lihat WHERE username = ?', [$un])->fetchColumn()) { fwrite(STDERR, "username $un sudah ada\n"); exit(1); }
    q('INSERT INTO akun_lihat (username, nama, sandi_hash, wajib_ganti, aktif, dibuat_at) VALUES (?, ?, ?, 1, 1, NOW())', [$un, $nama, password_hash($sandi(), PASSWORD_DEFAULT)]);
    echo "akun $un ($nama) dibuat: lihat saja, wajib ganti sandi saat login pertama\n"; break;
case 'reset':
    $n = q('UPDATE akun_lihat SET sandi_hash = ?, wajib_ganti = 1 WHERE username = ?', [password_hash($sandi(), PASSWORD_DEFAULT), $un])->rowCount();
    echo $n ? "sandi $un direset, wajib ganti saat login berikutnya\n" : "username $un tidak ada\n"; break;
case 'nonaktif': case 'aktif':
    $n = q('UPDATE akun_lihat SET aktif = ? WHERE username = ?', [$aksi === 'aktif' ? 1 : 0, $un])->rowCount();
    echo $n ? "$un $aksi\n" : "username $un tidak ada / tidak berubah\n"; break;
default:
    fwrite(STDERR, "aksi: daftar | tambah | reset | nonaktif | aktif\n"); exit(1);
}
