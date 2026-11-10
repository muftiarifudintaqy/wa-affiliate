<?php
/* [10 Nov] Isi tabel balasan (waktu balas per giliran chat) dari tabel pesan. Cron tiap menit: chat yang ada pesan 3 jam terakhir.
   php hitung-balas.php --semua   → hitung ulang semua chat pribadi (data lama, juga jalan tiap malam 03:40). */
if (PHP_SAPI !== 'cli') exit;
require __DIR__ . '/../inc/boot.php';
require __DIR__ . '/../inc/balas.php';
$semua = in_array('--semua', $argv, true);
$kunci = fopen(sys_get_temp_dir() . '/wa-affiliate-hitung-balas.lock', 'c');
if (!flock($kunci, LOCK_EX | LOCK_NB)) exit;
$t = microtime(true);
$ids = q("SELECT id FROM chat WHERE jenis = 'pribadi' AND pesan_terakhir_at IS NOT NULL" . ($semua ? '' : ' AND pesan_terakhir_at >= NOW() - INTERVAL 3 HOUR'))->fetchAll(PDO::FETCH_COLUMN);
$n = hitung_balasan($ids);
if ($semua || $n) echo date('Y-m-d H:i:s') . ' hitung-balas: ' . count($ids) . ' chat, ' . $n . ' giliran, ' . round(microtime(true) - $t, 1) . " dtk\n";
