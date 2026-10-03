# ADR-0045: Dalang dipakai dari agent yang sudah dipakai orang — tanpa kunci API model

**Status:** diterima (diterapkan) · **Tanggal:** 3 Oktober 2026

## Konteks

Pertanyaannya: bisakah Dalang dipakai lewat Claude Code, Codex, atau agent sejenis,
sehingga yang tidak punya API key model tetap bisa memakainya?

"Memakai" di sini bisa berarti dua hal yang berbeda, dan keduanya perlu dijawab
terpisah:

- **A. Agent luar memegang kemudi.** Pengguna membuka Claude Code (atau Codex,
  Gemini CLI, ...) di folder kerjanya dan berkata "buatkan video promo kopi 60
  detik". Agent-nya yang berpikir, dan langganan pengguna di agent itu yang
  membayar. Dalang hanya memberinya garis waktu.
- **B. Agent Dalang sendiri (`dalang chat`) memakai Claude Code/Codex sebagai
  otaknya.** Chat Dalang berjalan di atas model yang dipanggil lewat AI SDK;
  mengganti model itu dengan biner agent lain berarti menjadikan agent sebagai
  "model".

Jawaban sebelum ADR ini untuk A: **sudah bisa, tetapi tidak bisa ditemukan dan
tidak bisa dimulai dari nol.** Server MCP (ADR-0023) sudah ada sejak lama, dan
Claude Code, Codex, dan klien MCP mana pun bisa memasangnya. Yang kurang, dan
terukur:

1. **Tidak ada pemasangan satu-perintah.** Pengguna harus tahu bahwa servernya
   ada, bentuk konfigurasi tiap klien (JSON di enam tempat berbeda, TOML di
   satu), dan perintah yang menjalankan CLI ini dari proses lain.
2. **Agent luar tidak tahu cara bekerja di sini.** Tidak ada panduan: ia tidak
   diberi tahu bahwa `plan.json` tidak boleh ditulis langsung, bahwa ekspor
   selalu punya daftar yang tidak ikut, atau bahwa aset dan suara datang dari
   perintah CLI.
3. **Folder kosong adalah jalan buntu.** Server hanya melayani proyek yang SUDAH
   ada. Agent yang dihadapkan folder kosong tidak punya cara membuat proyek
   selain menulis `plan.json` dengan tangannya — satu-satunya hal yang dilarang
   `dalang_apply_patch` dan diperingatkan keras oleh instruksi servernya sendiri.

Untuk B: **tidak dibangun**, dengan alasan di bagian "Yang tidak dilakukan".

## Keputusan

### 1. Dua jalur, dinamai terang di dokumentasi

| | Siapa yang berpikir | Butuh kunci model? |
| --- | --- | --- |
| Agent luar memegang kemudi (`dalang agen`) | Claude Code / Codex / Gemini CLI / Cursor / VS Code / opencode | Tidak — memakai langganan agent itu |
| Agent Dalang sendiri (`dalang chat`, panel Chat Studio) | model yang dipilih lewat registry (ADR-0044) | Ya, **atau** model lokal (`ollama/...`, `lmstudio/...`) tanpa kunci dan tanpa cloud |

### 2. `dalang agen daftar | siapkan | uji`

- **`siapkan [akar] --untuk …`** menulis konfigurasi MCP untuk enam klien dan
  berkas panduannya, idempoten dan tidak menimpa:
  - Claude Code `.mcp.json`; Gemini CLI `.gemini/settings.json`; Cursor
    `.cursor/mcp.json`; VS Code `.vscode/mcp.json` (kunci `servers`, bukan
    `mcpServers`); opencode `opencode.json` (`command` berupa larik).
  - **Codex tidak disentuh.** Konfigurasinya di rumah pengguna
    (`~/.codex/config.toml`); Dalang mencetak `codex mcp add dalang -- …` dan
    cuplikan TOML untuk disalin.
  - Hanya entri `dalang` yang disentuh; server lain dan kunci tambahan milik
    pengguna di entri itu (mis. `env`) dipertahankan. Berkas yang tak bisa dibaca
    dengan pasti — JSON rusak, JSONC berkomentar, bentuk tak dikenal — DILEWATI
    dengan cuplikan untuk disalin tangan dan kode keluar 1, bukan ditebak dan
    ditulis ulang.
  - Tanpa `--untuk`: yang ditemukan di PATH. Bila tak ada satu pun, galat yang
    menyebut pilihannya — bukan menulis lima berkas ke folder pengguna.
  - `--hanya-baca`, `--izinkan-render`, `--tanpa-panduan`, dan `--cetak` (hanya
    menampilkan rencana).
- **`uji [akar]`** menjalankan server persis seperti yang dilakukan agent
  (klien MCP di atas stdio, dengan perintah yang sama), lalu mendaftar tool dan
  proyeknya. Ini cara membuktikan sambungannya hidup TANPA membuka agent mana pun.
- **`daftar [akar]`** menampilkan agent yang didukung, mana yang ada di PATH, dan
  statusnya di ruang kerja ini (tersambung / belum / perlu diperbarui / berkas
  tak terbaca / manual).

Perintah server yang ditulis ke konfigurasi: biner node yang SEDANG berjalan +
pemuat tsx + `main.ts`, semuanya path absolut. Bukan `pnpm dalang`, bukan `npx`:
klien MCP menjalankan perintahnya dari folder mana pun tanpa PATH pengguna, dan
`pnpm --dir` mengubah folder kerja sehingga path relatif proyek bergeser.
Konsekuensinya diucapkan keras kepada pengguna: bila checkout dipindah, jalankan
`siapkan` lagi. (Dalang belum diterbitkan sebagai paket; saat itu terjadi, hanya
`defaultLaunch` yang berubah.)

### 3. Panduan dibangkitkan dari kode, bukan ditulis tangan

`AGENTS.md` (Codex, Cursor, VS Code, opencode), `CLAUDE.md`, `GEMINI.md` memuat
satu blok di antara penanda `<!-- dalang:mulai -->` … `<!-- dalang:selesai -->`.
Menjalankan lagi menimpa HANYA blok itu; teks pengguna di luarnya tidak disentuh,
dan penanda yang rusak (satu ujung saja) membuat berkas dilewati.

Isinya: aturan (jangan menulis `plan.json`; jangan mengarang aset; sampaikan
`tidakIkut` dan `peringatan` apa adanya; kritik struktur bukan bukti video bagus),
alur kerja, tabel tool, perintah CLI dengan awalan yang bisa disalin, dan bagian
Biaya.

Tabel tool berasal dari `MCP_TOOLS` (katalog sebagai data), dan **sebuah tes
menyamakan katalog itu dengan tool yang DILAYANI server lewat klien MCP**
sungguhan — dengan dan tanpa port render. Panduan yang ditulis tangan menyebut
tool yang sudah diganti namanya; yang ini menjadi tes merah.

Bagian Biaya sengaja jujur tentang apa yang TIDAK diketahuinya: `dalang generate`
tidak punya `--dry-run`, jadi panduan tidak menjanjikannya. Ia hanya
mengatakan bahwa sebagian penyedia berbayar (mis. ElevenLabs) dan sebagian gratis
(Edge TTS, Openverse), menunjuk `dalang doctor` untuk melihat mana yang aktif,
dan meminta agent menanyakan pengguna sebelum menjalankan `generate` bila ada yang
berbayar. Gerbang persetujuannya adalah yang sudah dimiliki tiap klien untuk
perintah shell — itu, bukan tool MCP, tempat manusia berada di lingkaran.

### 4. `dalang_list_templates` dan `dalang_new_project`

Menutup jalan buntu folder kosong. Konsisten dengan ADR-0023 §7: tidak memanggil
model, tidak mengunduh aset, tidak membelanjakan apa pun — hanya menulis satu
`plan.json` kerangka di bawah akar. Pagarnya sendiri, kebalikan dari
`resolvePlanPath` (yang memastikan berkas SUDAH ada di dalam akar; ini memastikan
yang akan dibuat BELUM ada):

- nama = SATU nama folder (`[A-Za-z0-9][A-Za-z0-9_-]{0,62}`): tanpa `/`, tanpa
  `..`, tanpa titik di depan;
- keberadaan diperiksa dengan `lstat`, bukan `existsSync`: yang kedua mengikuti
  symlink, sehingga symlink menggantung ke luar akar terbaca "tidak ada";
- TIDAK PERNAH menimpa, ditolak pada mode `--hanya-baca`;
- template terpasang pengguna ikut terlihat lewat port `TemplateSource` yang
  disuntikkan CLI, supaya paket MCP tidak mengimpor paket agent beserta seluruh
  pohon SDK model.

Sembilan tool kini dilayani tanpa render, sepuluh dengan `--izinkan-render`.

## Bukti

**Bentuk `.mcp.json` Claude Code dipastikan dengan biner aslinya.** Konfigurasi
dihasilkan oleh `claude mcp add --scope project` (Claude Code 2.1.288) dan bentuknya
disalin; lalu berkas yang ditulis `dalang agen siapkan` dibaca balik
`claude mcp get dalang`: scope proyek, tipe stdio, perintah dan argumen utuh,
status "Pending approval (run `claude` to approve)" — persis yang dikatakan
panduan kepada pengguna. Itu satu-satunya klien yang bisa diperiksa dengan binernya
di sini.

**Server hidup dari perintah yang ditulis.** `dalang agen uji` dan gerbang CI
`gate:agen` membaca perintah dari `.mcp.json` yang BARU ditulis (tidak menyusunnya
ulang), menjalankannya lewat klien MCP di atas stdio — hidup dalam ±3 detik —
lalu memakainya untuk satu alur kerja agent utuh: proyek baru, ubah naskah lewat
patch, `get_plan` menunjukkan naskah baru dan `plan.json` di disk ikut berubah,
undo mengembalikan naskah asli, tulis subtitle, ekspor OTIO (dengan daftar
`tidakIkut`), dan tiga penolakan pagar (menimpa, `../keluar`, `/etc`). 28
pemeriksaan, tanpa jaringan, model, maupun peramban.

**Gerbang dan tes dibuktikan bisa gagal.** Perintah server diberi subperintah
salah ketik: gerbang gagal dengan pesan yang memuat perintah lengkap dan stderr
server (`unknown command 'mcpx'`). Server tidak mendaftarkan `dalang_new_project`:
gerbang menolak karena tool yang dilayani berbeda dari katalog panduan. Pagar nama
dilonggarkan sampai menerima `/`, dan pemeriksaan `lstat` diganti `existsSync`:
**versi pertama tes tidak gagal pada keduanya** — penolakan datang dari `mkdir`
yang kebetulan menolong, bukan dari pagarnya — sehingga tesnya diperketat untuk
menuntut PESAN pagar, dan baru kemudian keduanya gagal sebagaimana mestinya.
Penimpaan seluruh berkas panduan dan penghapusan server lain saat penggabungan diuji
dengan cara yang sama dan langsung gagal sebagaimana mestinya.

## Yang tidak dilakukan

- **`dalang chat` memakai Claude Code/Codex sebagai model (jalur B).** Tiga alasan,
  masing-masing cukup:
  1. Loop agent Dalang butuh model yang melakukan tool-calling terstruktur dan
     mengembalikan penggunaan token untuk guardrail anggaran. Biner agent bukan
     itu: ia menjalankan loopnya sendiri.
  2. Tool Dalang yang berbiaya (suara, gambar) bergantung pada persetujuan
     interaktif di REPL. Biner yang dijalankan non-interaktif (`claude -p`) tidak
     punya tempat menampilkan persetujuan itu, jadi tool berbiaya harus dicabut —
     dan yang tersisa persis delapan tool MCP yang sudah dimiliki jalur A.
  3. Memparse tool-call dari teks keluaran agent lain rapuh, dan mengunci Dalang
     pada format keluaran biner pihak ketiga yang berubah tiap rilis.
  Jalur A memberi hasil yang sama tanpa satu pun dari risiko itu. Mode tanpa layar
  tersedia bagi yang mau memakainya dari skrip: Claude Code punya `-p/--print`,
  `--mcp-config`, `--allowedTools` (bendera-bendera ini ada di `claude --help`
  versi 2.1.288), tetapi satu panggilan sungguhan memakai model, sehingga resep
  lengkapnya TIDAK dijalankan di sini.
- **Menyunting `~/.codex/config.toml`.** Berkas pribadi di luar proyek; Dalang
  mencetak perintah dan cuplikannya.
- **Tool MCP untuk `generate`/`render`.** Tetap keputusan ADR-0023 §7: berbiaya dan
  berat, dan tempat manusia berada di lingkaran adalah persetujuan shell klien.

## Batas yang dinyatakan

- Hanya Claude Code yang diperiksa dengan binernya. Konfigurasi Codex, Gemini CLI,
  Cursor, VS Code, dan opencode ditulis menurut dokumentasi masing-masing dan
  BELUM dijalankan dengan klien aslinya. `dalang agen uji` membuktikan sisi
  server-nya sehat; bila sebuah klien menolak berkasnya, itulah tempat melihat
  bedanya.
- Tidak diuji di Windows (kutipan shell di panduan mengikuti POSIX; konfigurasi
  JSON-nya sendiri tidak melewati shell).
- Agent luar bisa salah memakai alat yang diberikan; panduan mengurangi
  kemungkinannya, tidak menghilangkannya, dan kualitas video akhir tetap harus
  dilihat mata manusia.
