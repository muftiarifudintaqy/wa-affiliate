# Inbox Affiliate — affiliate.prepareofficial.com

Inbox WhatsApp (mirip WhatsApp Web) untuk 6 nomor kantor tim affiliate Prepare. Hanya akun ERP yang diizinkan (IZIN_USER_ID).

- `server/` — proses Node (Baileys, linked device, platform Desktop, riwayat penuh), service `wa-affiliate.service`, terpisah dari bot absensi.
  Antrean kirim maks 1 aksi / 2 detik / nomor, tanpa broadcast/auto-reply, tidak pernah kirim tanda dibaca otomatis.
- `web/public/` — DocumentRoot vhost `affiliate.prepareofficial.com` (noindex, HSTS). `web/inc/boot.php` = login, sesi 8 jam, CSRF, log akses.
- `sql/skema.sql` — database `wa_affiliate` (terpisah dari ERP). Riwayat disimpan selamanya; media > 6 bulan dikompres.

Di luar repo: `/etc/wa-affiliate.env` (DB, IZIN_USER_ID, DATA_DIR), `/var/lib/wa-affiliate/{sesi,media,unggah,php-sesi}`, log `/var/log/wa-affiliate/`.
