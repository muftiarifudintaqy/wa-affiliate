<?php
/* [10 Nov] Waktu balas: siapa membalas, lewat mana, berapa lama (jam kerja). Dipakai api.php (halaman Waktu Balas) & cli/hitung-balas.php.
   Giliran = pesan kontak pertama yang belum dibalas → pesan tim pertama sesudahnya (pesan kontak di antaranya ikut giliran yang sama).
   Pembalas: dikirim dari web = user ERP yang login (antrean_kirim / pesan.web_user_id); selain itu dikirim dari HP tim atau perangkat
   tertaut lain → orangnya tidak bisa diketahui, ditulis "dari HP – <nomor>". Balasan yang masuk lewat sinkron riwayat WA = via 'riwayat'. */

/** Detik di dalam jam kerja antara $a dan $b (Unix, WIB): Sen-Jum 08:00-17:00, Sab 08:00-12:00, Minggu libur. */
function detik_kerja(int $a, int $b): int {
    if ($b <= $a) return 0;
    $hari = function (int $d) use ($a, $b): int {   // detik kerja 1 hari (mulai tengah malam $d) yang jatuh di [a, b]
        $h = (int)date('N', $d); if ($h === 7) return 0;
        $x = max($a, $d + 8 * 3600); $y = min($b, $d + ($h === 6 ? 12 : 17) * 3600);
        return $y > $x ? $y - $x : 0;
    };
    $d = strtotime(date('Y-m-d 00:00:00', $a));
    $tot = $hari($d); $d += 86400;
    while ($d <= $b && (int)date('N', $d) !== 1) { $tot += $hari($d); $d += 86400; }
    // minggu penuh (Senin 00:00 s/d Minggu) di dalam [a, b] = 49 jam kerja; chat yang menunggu berbulan-bulan tetap cepat dihitung
    while ($d + 7 * 86400 <= $b) { $tot += 49 * 3600; $d += 7 * 86400; }
    for (; $d <= $b; $d += 86400) $tot += $hari($d);
    return $tot;
}

/** Hitung ulang giliran balas untuk daftar chat pribadi; return jumlah giliran tersimpan. */
function hitung_balasan(array $chat_ids): int {
    if (!$chat_ids) return 0;
    $n = 0;
    foreach (array_chunk(array_values(array_unique(array_map('intval', $chat_ids))), 200) as $pot) {
        $tanda = implode(',', array_fill(0, count($pot), '?'));
        $ps = q("SELECT p.id, p.chat_id, p.nomor_id, p.wa_id, p.dari_tim, p.dari_web, p.web_user_id, p.dari_riwayat, UNIX_TIMESTAMP(p.waktu) t
                 FROM pesan p JOIN chat c ON c.id = p.chat_id WHERE c.jenis = 'pribadi' AND p.chat_id IN ($tanda) ORDER BY p.chat_id, p.waktu, p.id", $pot)->fetchAll();
        // nama pengirim web: antrean_kirim (user_nama saat kirim) → akun ERP
        $web = [];
        $ids = array_values(array_unique(array_filter(array_map(fn($p) => $p['dari_tim'] && $p['dari_web'] ? $p['wa_id'] : null, $ps))));
        foreach (array_chunk($ids, 500) as $w)
            foreach (q('SELECT wa_id, user_id, user_nama FROM antrean_kirim WHERE wa_id IN (' . implode(',', array_fill(0, count($w), '?')) . ')', $w)->fetchAll() as $a) $web[$a['wa_id']] = $a;
        $erp = env()['ERP_DB'] ?? 'skinlyfe_erp'; $nama_erp = [];
        $per_chat = [];
        foreach ($ps as $p) $per_chat[(int)$p['chat_id']][] = $p;
        foreach ($pot as $cid) {
            $gil = []; $buka = null;
            foreach ($per_chat[$cid] ?? [] as $p) {
                if (!$p['dari_tim']) {
                    if ($buka === null) $buka = ['nomor_id' => (int)$p['nomor_id'], 'masuk_pesan_id' => (int)$p['id'], 'masuk' => (int)$p['t'], 'jumlah' => 1];
                    else $buka['jumlah']++;
                    continue;
                }
                if ($buka === null) continue;   // pesan tim tanpa pesan kontak yang menunggu: bukan balasan
                $via = $p['dari_web'] ? 'web' : ($p['dari_riwayat'] ? 'riwayat' : 'hp');
                $uid = $via === 'web' ? (int)($web[$p['wa_id']]['user_id'] ?? $p['web_user_id']) ?: null : null;
                $unama = $via === 'web' ? ($web[$p['wa_id']]['user_nama'] ?? null) : null;
                if ($via === 'web' && !$unama && $uid) {   // uid negatif = akun lokal (owner) di akun_lihat
                    if (!array_key_exists($uid, $nama_erp)) $nama_erp[$uid] = ($uid < 0 ? q('SELECT nama FROM akun_lihat WHERE id = ?', [-$uid]) : q("SELECT full_name FROM `$erp`.user WHERE id = ?", [$uid]))->fetchColumn() ?: null;
                    $unama = $nama_erp[$uid];
                }
                $gil[] = $buka + ['balas_pesan_id' => (int)$p['id'], 'balas' => (int)$p['t'], 'via' => $via, 'uid' => $uid, 'unama' => $unama];
                $buka = null;
            }
            if ($buka !== null) $gil[] = $buka + ['balas_pesan_id' => null, 'balas' => null, 'via' => null, 'uid' => null, 'unama' => null];
            $simpan = [];
            foreach ($gil as $g) {
                q('INSERT INTO balasan (nomor_id, chat_id, masuk_pesan_id, masuk_at, jumlah_masuk, balas_pesan_id, balas_at, via, web_user_id, web_user_nama, detik_kerja, detik_total, dihitung_at)
                   VALUES (?, ?, ?, FROM_UNIXTIME(?), ?, ?, IF(? IS NULL, NULL, FROM_UNIXTIME(?)), ?, ?, ?, ?, ?, NOW())
                   ON DUPLICATE KEY UPDATE nomor_id = VALUES(nomor_id), masuk_at = VALUES(masuk_at), jumlah_masuk = VALUES(jumlah_masuk), balas_pesan_id = VALUES(balas_pesan_id),
                     balas_at = VALUES(balas_at), via = VALUES(via), web_user_id = VALUES(web_user_id), web_user_nama = VALUES(web_user_nama), detik_kerja = VALUES(detik_kerja),
                     detik_total = VALUES(detik_total), dihitung_at = NOW()',
                  [$g['nomor_id'], $cid, $g['masuk_pesan_id'], $g['masuk'], $g['jumlah'], $g['balas_pesan_id'], $g['balas'], $g['balas'], $g['via'], $g['uid'], $g['unama'],
                   $g['balas'] ? detik_kerja($g['masuk'], $g['balas']) : null, $g['balas'] ? $g['balas'] - $g['masuk'] : null]);
                $simpan[] = $g['masuk_pesan_id']; $n++;
            }
            // giliran lama yang tidak ada lagi (mis. pesan riwayat lebih tua masuk belakangan) dibuang — tabel ini hasil hitungan, sumbernya tetap tabel pesan
            if ($simpan) q('DELETE FROM balasan WHERE chat_id = ? AND masuk_pesan_id NOT IN (' . implode(',', array_fill(0, count($simpan), '?')) . ')', array_merge([$cid], $simpan));
            else q('DELETE FROM balasan WHERE chat_id = ?', [$cid]);
        }
    }
    return $n;
}
