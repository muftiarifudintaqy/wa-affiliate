<?php
/* Inbox Affiliate — halaman masuk (akun ERP) & kerangka aplikasi. noindex; hanya user di IZIN_USER_ID. */
require __DIR__ . '/../inc/boot.php';
$galat = '';
if (($_GET['keluar'] ?? '') === '1' && user()) { catat_akses('logout'); $_SESSION = []; session_destroy(); header('Location: /'); exit; }
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['nama'])) {
    if (!hash_equals((string)$_SESSION['csrf'], (string)($_POST['csrf'] ?? ''))) $galat = 'Halaman kedaluwarsa, coba lagi.';
    else { $galat = coba_login(trim((string)$_POST['nama']), (string)($_POST['sandi'] ?? '')); if ($galat === '') { header('Location: /'); exit; } }
}
$u = user();
if ($u && empty($_SESSION['inbox_dicatat'])) { $_SESSION['inbox_dicatat'] = 1; catat_akses('buka_inbox'); }
?><!doctype html>
<html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow, noarchive"><meta name="googlebot" content="noindex, nofollow">
<title>Inbox Affiliate</title>
<link rel="icon" href="/img/prepare-bulat.png"><meta name="theme-color" content="#4A55A2">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Montserrat:wght@600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/app.css?v=7">
</head><body>
<?php if (!$u): ?>
<main class="masuk">
  <form method="post" class="masuk-kartu" autocomplete="on">
    <img class="masuk-logo" src="/img/prepare.png" alt="Prepare">
    <h1>Inbox Affiliate</h1>
    <p class="masuk-sub">Masuk dengan akun ERP.</p>
    <?php if ($galat): ?><p class="masuk-galat" role="alert"><?= e($galat) ?></p><?php endif; ?>
    <label>Username atau email<input name="nama" required autofocus autocomplete="username"></label>
    <label>Kata sandi<input name="sandi" type="password" required autocomplete="current-password"></label>
    <input type="hidden" name="csrf" value="<?= e($_SESSION['csrf']) ?>">
    <button type="submit">Masuk</button>
  </form>
</main>
<?php else: ?>
<div id="app" class="app" data-csrf="<?= e($_SESSION['csrf']) ?>" data-user="<?= e($u['nama']) ?>">
  <nav class="rel" aria-label="Nomor">
    <img class="rel-logo" src="/img/prepare-bulat.png" alt="Prepare">
    <div id="relNomor" class="rel-nomor"></div>
    <div class="rel-bawah">
      <button data-hal="inbox" class="rel-btn on" title="Inbox">💬</button>
      <button data-hal="ringkasan" class="rel-btn" title="Ringkasan harian">📊</button>
      <button data-hal="hubungkan" class="rel-btn" title="Hubungkan nomor">🔗</button>
      <button data-hal="audit" class="rel-btn" title="Audit">🧾</button>
      <a href="/?keluar=1" class="rel-btn" title="Keluar (<?= e($u['nama']) ?>)">⎋</a>
    </div>
  </nav>
  <section id="halInbox" class="hal inbox">
    <div class="inbox-isi">
    <aside class="daftar">
      <header class="daftar-atas"><h2 id="judulNomor">Semua nomor</h2><span id="statusNomor" class="kecil"></span></header>
      <div class="ringkas" id="ringkas" aria-label="Belum dibalas per akun"></div>
      <div class="cari"><input id="cari" type="search" placeholder="Cari nama, nomor, atau isi pesan" aria-label="Cari">
        <button type="button" class="saring" id="saringBelum" aria-pressed="false" title="Tampilkan hanya chat yang belum dibalas">Belum dibalas</button></div>
      <div id="hasilCari" class="hasil-cari" hidden></div>
      <ul id="daftarChat" class="daftar-chat" aria-label="Daftar chat"></ul>
    </aside>
    <main class="obrolan" id="obrolan">
      <div class="kosong-obrolan" id="kosongObrolan"><p>Pilih chat di sebelah kiri.</p><p class="kecil">Membuka chat tidak mengirim tanda dibaca ke kontak.</p></div>
      <header class="obrolan-atas" id="obrolanAtas" hidden>
        <button class="kembali" id="kembali" aria-label="Kembali ke daftar">←</button>
        <span class="ava" id="avaChat"></span>
        <div class="obrolan-nama"><b id="namaChat"></b><span id="infoChat" class="kecil"></span></div>
        <button id="btnDibaca" class="btn-garis">Tandai dibaca</button>
      </header>
      <div class="isi" id="isiPesan" aria-live="polite"></div>
      <footer class="tulis" id="tulis" hidden>
        <div class="kutip-bar" id="kutipBar" hidden><span id="kutipTeks"></span><button id="kutipBatal" aria-label="Batal membalas">✕</button></div>
        <div class="tulis-baris">
          <button id="btnEmoji" class="ikon" aria-label="Emoji">😊</button>
          <label class="ikon" aria-label="Lampirkan gambar atau dokumen">📎<input type="file" id="lampiran" hidden></label>
          <textarea id="ketik" rows="1" placeholder="Ketik pesan"></textarea>
          <button id="btnRekam" class="ikon" aria-label="Rekam voice note">🎤</button>
          <button id="btnKirim" class="kirim" aria-label="Kirim">➤</button>
        </div>
        <div class="emoji-panel" id="emojiPanel" hidden></div>
      </footer>
    </main>
    </div>
  </section>
  <section id="halRingkasan" class="hal panel-hal" hidden></section>
  <section id="halHubungkan" class="hal panel-hal" hidden></section>
  <section id="halAudit" class="hal panel-hal" hidden></section>
</div>
<div class="modal" id="modal" hidden><div class="modal-kartu"><button class="modal-tutup" id="modalTutup" aria-label="Tutup">✕</button><div id="modalIsi"></div></div></div>
<div class="toast" id="toast" role="status" hidden></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script src="/app.js?v=5"></script>
<?php endif; ?>
</body></html>
