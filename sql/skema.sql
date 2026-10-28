-- Inbox Affiliate (affiliate.prepareofficial.com) — database terpisah `wa_affiliate`. Riwayat disimpan selamanya.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS nomor (
  id TINYINT UNSIGNED PRIMARY KEY,
  label VARCHAR(80) NOT NULL,
  jid VARCHAR(60) NULL,                       -- nomor yang tertaut (628xx@s.whatsapp.net)
  foto_path VARCHAR(255) NULL, nama_wa VARCHAR(120) NULL, foto_at DATETIME NULL,   -- foto profil WA nomor ini (media/profil/<id>.jpg)
  status ENUM('belum','menghubungkan','perlu_scan','terhubung','terputus') NOT NULL DEFAULT 'belum',
  qr TEXT NULL, qr_at DATETIME NULL,
  terakhir_terhubung DATETIME NULL, terakhir_putus DATETIME NULL, alasan_putus VARCHAR(120) NULL,
  notif_putus_tgl DATE NULL,                   -- WA ke Mufti maks 1x/hari per nomor
  riwayat_progres TINYINT UNSIGNED NULL,      -- % sinkron riwayat penuh saat ditautkan
  minta_tautkan TINYINT(1) NOT NULL DEFAULT 0, minta_putuskan TINYINT(1) NOT NULL DEFAULT 0,
  aktif TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nomor_id TINYINT UNSIGNED NOT NULL,
  jid VARCHAR(80) NOT NULL,
  jenis ENUM('pribadi','grup') NOT NULL,
  judul VARCHAR(200) NULL,
  simpan TINYINT(1) NOT NULL DEFAULT 1,       -- grup: 0 sampai dicentang manual di halaman Hubungkan
  pesan_terakhir_at DATETIME NULL, cuplikan VARCHAR(200) NULL, cuplikan_dari_tim TINYINT(1) NULL,
  belum_dibalas_sejak DATETIME NULL,          -- pesan kontak pertama yang belum dibalas tim
  waktu_balas_rata_detik INT UNSIGNED NULL,
  UNIQUE KEY u_chat (nomor_id, jid), KEY k_urut (nomor_id, pesan_terakhir_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kontak (
  nomor_id TINYINT UNSIGNED NOT NULL,
  jid VARCHAR(80) NOT NULL,
  nama VARCHAR(200) NULL,
  pertama_dilihat DATETIME NOT NULL,
  PRIMARY KEY (nomor_id, jid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pesan (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nomor_id TINYINT UNSIGNED NOT NULL,
  chat_id INT UNSIGNED NOT NULL,
  wa_id VARCHAR(80) NOT NULL,
  dari_tim TINYINT(1) NOT NULL,
  pengirim_jid VARCHAR(80) NULL,              -- pengirim di grup
  jenis VARCHAR(20) NOT NULL,                 -- teks, gambar, video, voice, audio, dokumen, stiker, lokasi, kontak, lain
  teks MEDIUMTEXT NULL,                       -- teks terkini (versi asli di pesan_versi versi_ke=0 bila diedit)
  kutipan_wa_id VARCHAR(80) NULL,
  waktu DATETIME NOT NULL,                    -- jam kirim (detik)
  status TINYINT NOT NULL DEFAULT 1,          -- 0 antre, 1 terkirim, 2 diterima, 3 dibaca, 4 diputar
  terkirim_at DATETIME NULL, diterima_at DATETIME NULL, dibaca_at DATETIME NULL,
  diedit TINYINT(1) NOT NULL DEFAULT 0,
  dihapus_semua_at DATETIME NULL, dihapus_saya_at DATETIME NULL,
  dari_web TINYINT(1) NOT NULL DEFAULT 0, web_user_id INT NULL,
  dari_riwayat TINYINT(1) NOT NULL DEFAULT 0,
  raw MEDIUMTEXT NULL,                        -- pesan asli (JSON) untuk balas/quote & unduh ulang media
  diterima_server_at DATETIME NOT NULL,
  UNIQUE KEY u_pesan (nomor_id, chat_id, wa_id), KEY k_chat (chat_id, waktu), KEY k_waktu (nomor_id, waktu),
  FULLTEXT KEY ft_teks (teks)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pesan_versi (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pesan_id BIGINT UNSIGNED NOT NULL,
  versi_ke SMALLINT UNSIGNED NOT NULL,        -- 0 = asli
  teks MEDIUMTEXT NULL,
  waktu DATETIME NOT NULL,
  sumber ENUM('asli','hp','kontak','web') NOT NULL,
  web_user_id INT NULL,
  UNIQUE KEY u_versi (pesan_id, versi_ke)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pesan_reaksi (
  pesan_id BIGINT UNSIGNED NOT NULL,
  jid VARCHAR(80) NOT NULL,                   -- yang bereaksi ('tim' = nomor ini)
  emoji VARCHAR(16) NOT NULL,
  waktu DATETIME NOT NULL,
  dari_web TINYINT(1) NOT NULL DEFAULT 0, web_user_id INT NULL,
  PRIMARY KEY (pesan_id, jid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pesan_terima_grup (
  pesan_id BIGINT UNSIGNED NOT NULL,
  jid VARCHAR(80) NOT NULL,
  status TINYINT NOT NULL,                    -- 2 diterima, 3 dibaca, 4 diputar
  waktu DATETIME NOT NULL,
  PRIMARY KEY (pesan_id, jid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS media (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pesan_id BIGINT UNSIGNED NOT NULL,
  mime VARCHAR(120) NULL, nama_file VARCHAR(255) NULL,
  ukuran BIGINT UNSIGNED NULL, durasi INT UNSIGNED NULL,
  path VARCHAR(255) NULL,                     -- relatif terhadap DATA_DIR/media
  path_putar VARCHAR(255) NULL,               -- voice note versi m4a (bisa diputar di iPhone)
  status ENUM('antre','ok','gagal') NOT NULL DEFAULT 'antre', percobaan TINYINT UNSIGNED NOT NULL DEFAULT 0, galat VARCHAR(200) NULL,
  dikompres_at DATETIME NULL, ukuran_asli BIGINT UNSIGNED NULL,
  UNIQUE KEY u_pesan (pesan_id), KEY k_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS antrean_kirim (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nomor_id TINYINT UNSIGNED NOT NULL,
  chat_id INT UNSIGNED NOT NULL,
  aksi ENUM('teks','gambar','dokumen','voice','reaksi','edit','hapus_semua','hapus_saya','tandai_dibaca') NOT NULL,
  isi MEDIUMTEXT NULL, media_path VARCHAR(255) NULL, nama_file VARCHAR(255) NULL, mime VARCHAR(120) NULL,
  target_pesan_id BIGINT UNSIGNED NULL,       -- pesan yang diedit/dihapus/direaksi/dikutip
  user_id INT NOT NULL, user_nama VARCHAR(120) NULL,
  status ENUM('menunggu','diproses','terkirim','gagal') NOT NULL DEFAULT 'menunggu',
  wa_id VARCHAR(80) NULL, galat VARCHAR(255) NULL,
  dibuat_at DATETIME NOT NULL, dikirim_at DATETIME NULL,
  KEY k_status (status, nomor_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_web (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL, nama VARCHAR(120) NULL,
  aksi VARCHAR(30) NOT NULL, nomor_id TINYINT UNSIGNED NULL, chat_id INT UNSIGNED NULL, pesan_id BIGINT UNSIGNED NULL, antrean_id BIGINT UNSIGNED NULL,
  isi_ringkas VARCHAR(255) NULL, hasil VARCHAR(255) NULL,
  ip VARCHAR(45) NULL, user_agent VARCHAR(255) NULL, waktu DATETIME NOT NULL,
  KEY k_waktu (waktu)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS akses_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL, nama VARCHAR(120) NULL,
  aksi VARCHAR(30) NOT NULL,                  -- login, login_gagal, logout, buka_inbox, buka_chat, buka_media, hubungkan
  nomor_id TINYINT UNSIGNED NULL, chat_id INT UNSIGNED NULL, keterangan VARCHAR(255) NULL,
  ip VARCHAR(45) NULL, user_agent VARCHAR(255) NULL, waktu DATETIME NOT NULL,
  KEY k_waktu (waktu), KEY k_ip (ip, aksi, waktu)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ringkasan_harian (
  tanggal DATE NOT NULL, nomor_id TINYINT UNSIGNED NOT NULL,
  chat_masuk INT UNSIGNED NOT NULL DEFAULT 0, chat_keluar INT UNSIGNED NOT NULL DEFAULT 0,
  pesan_masuk INT UNSIGNED NOT NULL DEFAULT 0, pesan_keluar INT UNSIGNED NOT NULL DEFAULT 0,
  kontak_baru INT UNSIGNED NOT NULL DEFAULT 0, waktu_balas_rata_detik INT UNSIGNED NULL, belum_dibalas_1jam INT UNSIGNED NOT NULL DEFAULT 0,
  dihitung_at DATETIME NOT NULL,
  PRIMARY KEY (tanggal, nomor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notif_sistem (
  kode VARCHAR(60) PRIMARY KEY,               -- mis. disk-2026-10-28 (maks 1x/hari)
  dikirim_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO nomor (id, label) VALUES (1,'Aff 1'),(2,'Aff 2'),(3,'Aff 3'),(4,'Aff 4'),(5,'Aff 5'),(6,'Aff 6');

-- [28 Okt] nama kontak seperti WhatsApp: nama tersimpan di buku kontak HP tim (nama_simpan) > pushName > nama bisnis > nomor; LID → nomor HP
ALTER TABLE kontak ADD COLUMN nama_simpan VARCHAR(200) NULL AFTER nama, ADD COLUMN push_name VARCHAR(200) NULL AFTER nama_simpan, ADD COLUMN nama_bisnis VARCHAR(200) NULL AFTER push_name,
  ADD COLUMN pn VARCHAR(32) NULL AFTER nama_bisnis, ADD COLUMN lid VARCHAR(40) NULL AFTER pn, ADD COLUMN diperbarui_at DATETIME NULL, ADD KEY k_pn (nomor_id, pn), ADD KEY k_lid (nomor_id, lid);
ALTER TABLE chat ADD COLUMN pn VARCHAR(32) NULL AFTER jid, ADD COLUMN lid VARCHAR(40) NULL AFTER pn, ADD KEY k_pn (nomor_id, pn);
CREATE TABLE IF NOT EXISTS lid_map (
  nomor_id TINYINT UNSIGNED NOT NULL, lid VARCHAR(40) NOT NULL, pn VARCHAR(32) NOT NULL, sumber VARCHAR(20) NOT NULL, diperbarui_at DATETIME NOT NULL,
  PRIMARY KEY (nomor_id, lid), KEY k_pn (nomor_id, pn)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- [28 Okt] foto profil kontak/grup (cache per chat, antrean pelan)
ALTER TABLE chat ADD COLUMN foto_path VARCHAR(255) NULL, ADD COLUMN foto_at DATETIME NULL, ADD COLUMN foto_ada TINYINT(1) NULL, ADD KEY k_foto (foto_at);
