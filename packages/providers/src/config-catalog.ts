/**
 * Katalog konfigurasi (ADR-0032): SATU tempat yang tahu setiap variabel
 * lingkungan yang dibaca Dalang, apa yang dibukanya, dan cara mendapatkannya.
 *
 * Ini ada karena audit menemukan dua belas variabel yang dibaca kode tetapi
 * tidak tertulis di `.env.example`, sembilan di antaranya tidak disebut di
 * mana pun. Tiga kemampuan utuh — transkripsi, stiker, efek suara — hanya
 * bisa ditemukan dengan membaca kode. Menambal daftarnya sekali tidak
 * menyelesaikan apa pun: ia akan basi lagi pada fitur berikutnya.
 *
 * Jadi katalog ini yang jadi sumbernya, dan empat permukaan membacanya:
 *  - `.env.example` DIBANGKITKAN dari sini, dan tes menolak bila berbeda;
 *  - `dalang setup` menanyakan hal yang benar dengan bahasa awam;
 *  - `dalang doctor` melaporkan apa yang hidup dan apa yang kurang;
 *  - panel Pengaturan di Studio menampilkannya tanpa perlu terminal.
 *
 * Murni: hanya data dan fungsi tanpa efek. Tidak membaca berkas, tidak
 * menyentuh jaringan.
 */

/** Bagaimana nilainya diperlakukan saat ditampilkan dan disimpan. */
export type SettingKind = "rahasia" | "teks" | "path" | "angka" | "url";

export interface Setting {
  /** Nama variabel lingkungan, apa adanya. */
  key: string;
  label: string;
  kind: SettingKind;
  /**
   * true = kemampuannya tidak hidup tanpa ini. false = penghalus; kemampuan
   * tetap hidup, hanya dengan bawaan.
   */
  required: boolean;
  /** Satu kalimat: apa yang berubah kalau diisi. */
  effect: string;
  /** Langkah mendapatkannya, untuk orang yang belum pernah. */
  howTo?: readonly string[];
  /** Bentuk nilainya, untuk placeholder. BUKAN nilai sungguhan. */
  example?: string;
  /** Yang berlaku bila dikosongkan. */
  fallback?: string;
}

/**
 * Cara sebuah kemampuan dianggap hidup:
 *  - "salah-satu": satu saja dari setelan wajibnya cukup, mis. Pexels ATAU Pixabay;
 *  - "semua": semuanya harus ada, mis. render cloud butuh empat-empatnya.
 */
export type CapabilityRule = "salah-satu" | "semua";

export interface Capability {
  id: string;
  /** Judul dalam bahasa tujuan, bukan bahasa teknologi. */
  title: string;
  /** Satu kalimat untuk orang yang belum tahu ini apa. */
  plain: string;
  /** Apa yang tetap bisa dilakukan tanpa mengisi apa pun. */
  withoutIt: string;
  rule: CapabilityRule;
  /**
   * true = kemampuannya SUDAH bisa dipakai tanpa mengisi apa pun. Berbeda
   * dari "bisa jalan offline": transkripsi lokal memang tidak mengirim apa
   * pun keluar, tapi ia baru hidup setelah whisper.cpp terpasang, jadi
   * medan ini false untuknya dan `alsoActiveWhen` yang menjelaskannya.
   */
  readyWithoutConfig: boolean;
  /**
   * Jalan lain di luar variabel lingkungan yang juga menghidupkannya, mis.
   * whisper.cpp yang terpasang di PATH. Kalimat, bukan kode: yang mendeteksi
   * adalah pemanggilnya.
   */
  alsoActiveWhen?: string;
  settings: readonly Setting[];
}

const ELEVENLABS_HOWTO = [
  "Buka elevenlabs.io lalu masuk atau daftar (ada paket gratis).",
  "Klik foto profil di kanan atas, pilih API Keys.",
  "Buat kunci baru, salin, lalu tempel di sini.",
] as const;

/**
 * Urutannya sengaja: yang paling awal dibutuhkan orang baru ada di atas, dan
 * yang hanya dipakai sedikit orang ada di bawah.
 */
export const CAPABILITIES: readonly Capability[] = [
  {
    id: "chat",
    title: "Bikin video lewat percakapan",
    plain:
      "Kamu menulis maunya dengan kalimat biasa, dan agent yang menyusun naskah, memilih aset, lalu merapikan timeline.",
    withoutIt:
      "Studio dan CLI tetap berfungsi penuh untuk mengedit sendiri; panel chat mengatakan kunci apa yang kurang.",
    rule: "salah-satu",
    readyWithoutConfig: false,
    settings: [
      {
        key: "ANTHROPIC_API_KEY",
        label: "Kunci API Anthropic",
        kind: "rahasia",
        required: true,
        effect: "Menyalakan chat agent dengan model Claude.",
        howTo: [
          "Buka console.anthropic.com lalu masuk atau daftar.",
          "Masuk ke API Keys, buat kunci baru, salin.",
          "Perlu saldo terisi; pemakaian dibayar per token.",
        ],
        example: "sk-ant-...",
      },
      {
        key: "GOOGLE_GENERATIVE_AI_API_KEY",
        label: "Kunci API Google AI",
        kind: "rahasia",
        required: true,
        effect: "Menyalakan chat agent dengan model Gemini.",
        howTo: [
          "Buka aistudio.google.com/apikey lalu masuk dengan akun Google.",
          "Klik Create API key, salin.",
          "Ada kuota gratis yang cukup untuk mencoba.",
        ],
        example: "AIza...",
      },
      {
        key: "OPENAI_API_KEY",
        label: "Kunci API OpenAI",
        kind: "rahasia",
        required: true,
        effect: "Menyalakan chat agent dengan model GPT.",
        howTo: [
          "Buka platform.openai.com/api-keys lalu masuk.",
          "Klik Create new secret key, salin.",
          "Perlu saldo terisi; pemakaian dibayar per token.",
        ],
        example: "sk-...",
      },
      {
        key: "DALANG_OPENAI_COMPAT_BASE_URL",
        label: "Alamat gateway OpenAI-compatible",
        kind: "url",
        required: true,
        effect:
          "Memakai model dari Ollama, LM Studio, OpenRouter, vLLM, atau gateway lain yang bicara protokol OpenAI. Bisa sepenuhnya lokal dan gratis.",
        howTo: [
          "Ollama: pasang dari ollama.com, jalankan ollama serve, alamatnya http://localhost:11434/v1.",
          "LM Studio: nyalakan server lokalnya, alamatnya http://localhost:1234/v1.",
          "OpenRouter dan sejenisnya: pakai alamat yang tertulis di dokumentasinya, lalu isi juga kunci di bawah.",
        ],
        example: "http://localhost:11434/v1",
      },
      {
        key: "DALANG_OPENAI_COMPAT_API_KEY",
        label: "Kunci gateway OpenAI-compatible",
        kind: "rahasia",
        required: false,
        effect: "Kunci untuk gateway di atas.",
        fallback: "Kosongkan untuk server lokal seperti Ollama yang tidak memakai kunci.",
      },
      {
        key: "DALANG_MODEL",
        label: "Model orkestrator pilihanmu",
        kind: "teks",
        required: false,
        effect:
          "Memilih model tertentu alih-alih membiarkan Dalang memilihkan. Isi kalau kamu memasang lebih dari satu kunci, atau mau model yang spesifik.",
        example: "anthropic/claude-sonnet-4-5",
        fallback:
          "Dipilih otomatis dari registry models.dev sesuai kunci yang terpasang.",
      },
      {
        key: "DALANG_MODEL_VOLUME",
        label: "Model tier murah untuk riset dan penglihatan",
        kind: "teks",
        required: false,
        effect:
          "Dipakai untuk pekerjaan bervolume: riset naskah dan meninjau frame render. Model kecil yang murah cocok di sini.",
        example: "google/gemini-2.5-flash",
        fallback:
          "Memakai model orkestrator, atau tool terkait mengatakan tidak tersedia.",
      },
    ],
  },
  {
    id: "suara",
    title: "Suara narator yang terdengar manusia",
    plain:
      "Narasi dibacakan dengan suara sintetis berkualitas tinggi, lengkap dengan penanda waktu per kata untuk caption.",
    withoutIt:
      "Tetap ada suara: Edge TTS gratis tanpa kunci, dan provider silence membuat trek hening berdurasi tepat supaya timing video tetap benar.",
    rule: "salah-satu",
    readyWithoutConfig: true,
    settings: [
      {
        key: "ELEVENLABS_API_KEY",
        label: "Kunci API ElevenLabs",
        kind: "rahasia",
        required: true,
        effect:
          "Menyalakan suara ElevenLabs, termasuk Bahasa Indonesia, dengan penanda waktu per kata dari providernya sendiri.",
        howTo: ELEVENLABS_HOWTO,
        example: "sk_...",
      },
      {
        key: "ELEVENLABS_MODEL_ID",
        label: "Model suara ElevenLabs",
        kind: "teks",
        required: false,
        effect: "Memilih model suara tertentu.",
        example: "eleven_multilingual_v2",
        fallback: "eleven_multilingual_v2, yang mendukung Bahasa Indonesia.",
      },
    ],
  },
  {
    id: "stok",
    title: "Cari video dan foto stok otomatis",
    plain:
      "Scene bertipe stok mengambil footage yang cocok dari pustaka berlisensi jelas, lalu menyimpannya ke folder proyek.",
    withoutIt:
      "Scene stok tidak bisa di-resolve. Kamu tetap bisa memakai gambar dan rekaman sendiri, template animasi, dan warna solid.",
    rule: "salah-satu",
    readyWithoutConfig: false,
    settings: [
      {
        key: "PEXELS_API_KEY",
        label: "Kunci API Pexels",
        kind: "rahasia",
        required: true,
        effect: "Video dan foto gratis dengan lisensi yang boleh dipakai komersial.",
        howTo: [
          "Buka pexels.com/api lalu masuk atau daftar.",
          "Klik Get Started, isi nama proyek seadanya.",
          "Salin kunci yang muncul. Gratis, tanpa kartu kredit.",
        ],
      },
      {
        key: "PIXABAY_API_KEY",
        label: "Kunci API Pixabay",
        kind: "rahasia",
        required: true,
        effect: "Pustaka kedua, dipakai sebagai cadangan bila Pexels tidak menemukan.",
        howTo: [
          "Buka pixabay.com/api/docs lalu masuk atau daftar.",
          "Kuncinya langsung tampil di halaman itu setelah masuk.",
          "Gratis, tanpa kartu kredit.",
        ],
      },
    ],
  },
  {
    id: "transkrip",
    title: "Ubah rekaman jadi teks berwaktu",
    plain:
      "Rekaman panjang ditranskrip per kata, sehingga bisa dipotong berdasarkan kalimat dan dijadikan caption otomatis.",
    withoutIt:
      "Rekaman tetap bisa dipasang dan dipotong dengan tangan; caption ditulis sendiri.",
    rule: "salah-satu",
    // Bukan "siap tanpa konfigurasi": whisper.cpp harus terpasang dulu.
    readyWithoutConfig: false,
    alsoActiveWhen:
      "whisper.cpp terpasang di PATH beserta modelnya, yang membuat rekaman tidak pernah keluar dari mesinmu",
    settings: [
      {
        key: "WHISPER_CPP_BIN",
        label: "Lokasi program whisper.cpp",
        kind: "path",
        required: false,
        effect:
          "Transkripsi berjalan sepenuhnya di mesinmu, gratis, tanpa mengirim rekaman ke siapa pun.",
        howTo: [
          "Pasang whisper.cpp, mis. dengan brew install whisper-cpp di macOS.",
          "Unduh satu berkas model, mis. ggml-base.bin dari huggingface.co/ggerganov/whisper.cpp.",
          "Isi baris ini hanya bila programnya tidak ada di PATH; kalau ada, Dalang menemukannya sendiri.",
        ],
        example: "/usr/local/bin/whisper-cli",
        fallback: "Dicari otomatis di PATH.",
      },
      {
        key: "WHISPER_CPP_MODEL",
        label: "Berkas model whisper.cpp",
        kind: "path",
        required: false,
        effect: "Model yang dipakai transkripsi lokal.",
        example: "~/models/ggml-base.bin",
        fallback: "Dicari otomatis di folder model yang lazim.",
      },
      {
        key: "DEEPGRAM_API_KEY",
        label: "Kunci API Deepgram",
        kind: "rahasia",
        required: true,
        effect:
          "Transkripsi lewat layanan Deepgram, cepat dan akurat. Rekaman dikirim ke server mereka.",
        howTo: [
          "Buka console.deepgram.com lalu daftar.",
          "Buat API key di menu API Keys, salin.",
          "Ada saldo gratis awal untuk mencoba.",
        ],
      },
      {
        key: "DEEPGRAM_MODEL",
        label: "Model Deepgram",
        kind: "teks",
        required: false,
        effect: "Memilih model pengenalan suara tertentu.",
        example: "nova-3",
        fallback: "Bawaan provider.",
      },
    ],
  },
  {
    id: "stiker",
    title: "Stiker dan GIF beranimasi",
    plain: "Menempelkan stiker beralfa dan GIF ke scene, untuk klip yang lebih hidup.",
    withoutIt:
      "Ikon dari Iconify tetap tersedia tanpa kunci apa pun, dan bisa diwarnai sendiri.",
    rule: "salah-satu",
    readyWithoutConfig: false,
    settings: [
      {
        key: "GIPHY_API_KEY",
        label: "Kunci API GIPHY",
        kind: "rahasia",
        required: true,
        effect:
          "Pencarian stiker dan GIF GIPHY. Isinya unggahan orang lain, jadi hak pakainya perlu kamu periksa sebelum dipublikasikan.",
        howTo: [
          "Buka developers.giphy.com lalu daftar.",
          "Klik Create an App, pilih API, salin kuncinya.",
        ],
      },
      {
        key: "TENOR_API_KEY",
        label: "Kunci API Tenor",
        kind: "rahasia",
        required: true,
        effect: "Pustaka stiker kedua, dengan peringatan hak pakai yang sama.",
        howTo: [
          "Buka developers.google.com/tenor lalu ikuti langkah membuat kunci di Google Cloud.",
        ],
      },
    ],
  },
  {
    id: "sfx",
    title: "Efek suara",
    plain: "Menambahkan efek suara berlisensi terbuka ke scene.",
    withoutIt: "Sudah jalan tanpa apa pun. Token di bawah hanya menaikkan batas laju.",
    rule: "salah-satu",
    readyWithoutConfig: true,
    settings: [
      {
        key: "OPENVERSE_TOKEN",
        label: "Token Openverse",
        kind: "rahasia",
        required: false,
        effect:
          "Menaikkan batas jumlah pencarian per jam. Openverse tetap bisa dipakai tanpa ini.",
        howTo: ["Daftar di api.openverse.org lewat menu Register."],
        fallback: "Tanpa token, dengan batas laju yang lebih rendah.",
      },
    ],
  },
  {
    id: "publikasi",
    title: "Unggah langsung ke YouTube",
    plain:
      "Hasil render diunggah dari Studio atau CLI, dengan judul dan deskripsi yang sudah diturunkan dari plan.",
    withoutIt:
      "Berkas hasil render tetap ada di folder proyek dan bisa diunggah sendiri lewat browser.",
    rule: "semua",
    readyWithoutConfig: false,
    settings: [
      {
        key: "YOUTUBE_ACCESS_TOKEN",
        label: "Token akses YouTube",
        kind: "rahasia",
        required: true,
        effect:
          "Menyalakan tombol Unggah. Bawaan unggahan selalu privat, dan setiap unggahan minta konfirmasi.",
        howTo: [
          "Buka developers.google.com/oauthplayground.",
          "Di daftar kiri pilih YouTube Data API v3, centang cakupan .../auth/youtube.upload.",
          "Klik Authorize APIs, masuk dengan akun YouTube-mu, lalu Exchange authorization code for tokens.",
          "Salin Access token. Token ini biasanya kedaluwarsa dalam satu jam dan harus diambil ulang.",
        ],
        example: "ya29....",
      },
    ],
  },
  {
    id: "cloud",
    title: "Render di cloud, bukan di laptop",
    plain:
      "Render dikerjakan AWS Lambda secara paralel, jadi video panjang selesai jauh lebih cepat.",
    withoutIt:
      "Render tetap berjalan penuh di mesin ini. Untuk kebanyakan orang ini sudah cukup.",
    rule: "semua",
    readyWithoutConfig: false,
    settings: [
      {
        key: "AWS_REGION",
        label: "Region AWS",
        kind: "teks",
        required: true,
        effect: "Region tempat fungsi dan bucket render berada.",
        example: "ap-southeast-1",
      },
      {
        key: "AWS_ACCESS_KEY_ID",
        label: "AWS Access Key ID",
        kind: "rahasia",
        required: true,
        effect:
          "Kredensial AWS. Dibaca oleh SDK AWS, bukan oleh Dalang sendiri, jadi profil AWS yang sudah terpasang di mesinmu juga berlaku.",
        howTo: [
          "Buat IAM user di konsol AWS dengan izin sesuai dokumentasi Remotion Lambda.",
          "Boleh dikosongkan bila kamu sudah memakai aws configure atau profil SSO.",
        ],
      },
      {
        key: "AWS_SECRET_ACCESS_KEY",
        label: "AWS Secret Access Key",
        kind: "rahasia",
        required: true,
        effect: "Pasangan dari kunci di atas.",
      },
      {
        key: "DALANG_LAMBDA_FUNCTION",
        label: "Nama fungsi Lambda",
        kind: "teks",
        required: true,
        effect: "Fungsi render yang sudah kamu pasang di akun AWS-mu.",
        howTo: ["Jalankan npx remotion lambda functions deploy, lalu salin namanya."],
        example: "remotion-render-4-0-0-mem2048mb-disk2048mb-120sec",
      },
      {
        key: "DALANG_LAMBDA_BUCKET",
        label: "Bucket S3",
        kind: "teks",
        required: true,
        effect: "Tempat hasil render disimpan sebelum diunduh.",
        example: "remotionlambda-apsoutheast1-abc123",
      },
      {
        key: "DALANG_LAMBDA_SERVE_URL",
        label: "Serve URL situs Remotion",
        kind: "url",
        required: true,
        effect: "Bundel template yang dipakai Lambda saat merender.",
        howTo: [
          "Jalankan npx remotion lambda sites create packages/templates/src/index.ts --site-name=dalang, lalu salin URL-nya.",
        ],
      },
      {
        key: "DALANG_LAMBDA_MEMORY_MB",
        label: "Memori per invokasi",
        kind: "angka",
        required: false,
        effect: "Menaikkannya mempercepat render, dan menaikkan biaya per detik.",
        fallback: "2048",
      },
      {
        key: "DALANG_LAMBDA_FRAMES_PER_LAMBDA",
        label: "Frame per invokasi",
        kind: "angka",
        required: false,
        effect: "Semakin kecil, semakin banyak invokasi paralel.",
        fallback: "20",
      },
    ],
  },
  {
    id: "lanjutan",
    title: "Setelan lanjutan",
    plain:
      "Jarang perlu diubah. Ada di sini supaya tidak perlu membaca kode untuk menemukannya.",
    withoutIt: "Semua punya bawaan yang masuk akal.",
    rule: "salah-satu",
    readyWithoutConfig: true,
    settings: [
      {
        key: "DALANG_HOME",
        label: "Folder rumah Dalang",
        kind: "path",
        required: false,
        effect:
          "Tempat memori preferensi lintas proyek disimpan. Berguna bila satu akun OS dipakai dua orang.",
        fallback: "~/.dalang",
      },
      {
        key: "DALANG_CACHE_DIR",
        label: "Folder cache",
        kind: "path",
        required: false,
        effect: "Tempat bundel render dan snapshot registry model di-cache.",
        fallback: "~/.cache/dalang",
      },
      {
        key: "DALANG_MAX_UPLOAD_MB",
        label: "Batas ukuran unggahan rekaman",
        kind: "angka",
        required: false,
        effect: "Batas berkas yang boleh diunggah lewat panel sumber di Studio.",
        fallback: "4096",
      },
      {
        key: "REMOTION_BROWSER_EXECUTABLE",
        label: "Lokasi Chromium untuk render",
        kind: "path",
        required: false,
        effect:
          "Dipakai bila Dalang tidak menemukan peramban sendiri, mis. di server tanpa antarmuka.",
        fallback: "Dicari otomatis, termasuk Chrome Headless Shell milik Remotion.",
      },
      {
        key: "PUPPETEER_EXECUTABLE_PATH",
        label: "Lokasi Chromium alternatif",
        kind: "path",
        required: false,
        effect: "Dibaca sebagai cadangan bila baris di atas kosong.",
        fallback: "Sama seperti di atas.",
      },
      {
        key: "PLAYWRIGHT_BROWSERS_PATH",
        label: "Folder peramban Playwright",
        kind: "path",
        required: false,
        effect:
          "Folder tempat Playwright menaruh peramban; ikut dicari saat Dalang butuh Chromium.",
        fallback: "/opt/pw-browsers",
      },
    ],
  },
];

/** Semua setelan, rata, untuk pencarian per kunci. */
export const ALL_SETTINGS: readonly Setting[] = CAPABILITIES.flatMap(
  (capability) => capability.settings,
);

export const settingOf = (key: string): Setting | undefined =>
  ALL_SETTINGS.find((setting) => setting.key === key);

export const capabilityOf = (id: string): Capability | undefined =>
  CAPABILITIES.find((capability) => capability.id === id);

/** Nilai yang dianggap "terisi": bukan kosong dan bukan hanya spasi. */
export const isFilled = (value: string | undefined): boolean =>
  typeof value === "string" && value.trim() !== "";

export interface CapabilityStatus {
  id: string;
  title: string;
  /**
   * Cara ia hidup. Ikut dibawa supaya pemakainya bisa menulis kalimat yang
   * benar tanpa menengok katalog lagi: "A atau B" untuk salah-satu, "A dan B"
   * untuk semua. Versi pertama doctor menulis "atau" untuk keduanya, dan itu
   * menyuruh orang mengisi satu dari empat setelan render cloud yang
   * sebenarnya wajib semua.
   */
  rule: CapabilityRule;
  /** Kalimat jalan lain di luar env, bila kemampuannya punya. */
  alsoActiveWhen?: string;
  /** Kemampuannya bisa dipakai sekarang. */
  active: boolean;
  /** Sudah bisa dipakai tanpa mengisi apa pun. */
  readyWithoutConfig: boolean;
  /** Kunci yang sudah terisi. */
  filled: string[];
  /**
   * Yang perlu diisi supaya hidup. Kosong bila sudah aktif. Untuk aturan
   * "salah-satu", ini daftar pilihan, bukan daftar tuntutan.
   */
  missing: string[];
  /** Terisi karena hal di luar env, mis. whisper.cpp terdeteksi. */
  activeByDetection: boolean;
}

/**
 * Keadaan tiap kemampuan menurut env yang diberikan.
 *
 * `detected` memberi jalan bagi hal yang tidak bisa dilihat dari env, seperti
 * whisper.cpp yang terpasang di PATH. Katalog ini tetap murni: yang memindai
 * disk adalah pemanggilnya.
 */
export const capabilityStatuses = (
  env: Record<string, string | undefined>,
  detected: Record<string, boolean> = {},
): CapabilityStatus[] =>
  CAPABILITIES.map((capability) => {
    const filled = capability.settings
      .filter((setting) => isFilled(env[setting.key]))
      .map((setting) => setting.key);
    const requiredKeys = capability.settings
      .filter((setting) => setting.required)
      .map((setting) => setting.key);
    const requiredFilled = requiredKeys.filter((key) => filled.includes(key));
    const byEnv =
      requiredKeys.length === 0
        ? filled.length > 0
        : capability.rule === "salah-satu"
          ? requiredFilled.length > 0
          : requiredFilled.length === requiredKeys.length;
    const activeByDetection = detected[capability.id] === true;
    // Kemampuan yang memang sudah siap tanpa konfigurasi tidak boleh
    // dilaporkan mati hanya karena kunci penambahnya kosong: Edge TTS dan
    // Openverse bekerja hari ini, tanpa apa pun.
    const active = capability.readyWithoutConfig || byEnv || activeByDetection;
    return {
      id: capability.id,
      title: capability.title,
      rule: capability.rule,
      ...(capability.alsoActiveWhen ? { alsoActiveWhen: capability.alsoActiveWhen } : {}),
      active,
      readyWithoutConfig: capability.readyWithoutConfig,
      filled,
      missing: active
        ? []
        : capability.rule === "salah-satu"
          ? requiredKeys
          : requiredKeys.filter((key) => !filled.includes(key)),
      activeByDetection,
    };
  });

/**
 * Nilai rahasia yang aman dikirim ke layar: panjangnya tidak dibocorkan, dan
 * hanya empat karakter terakhir yang terlihat supaya orang bisa mengenali
 * kunci mana yang terpasang tanpa bisa memakainya.
 */
export const maskSecret = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
};
