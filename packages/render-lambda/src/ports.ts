/**
 * Yang dibutuhkan target Lambda dari dunia luar — DI-INJECT (ADR-0019).
 *
 * Pola yang sama dengan seluruh provider di repo ini, dan alasannya sama: agar
 * urutan langkahnya (unggah aset, mulai render, pantau kemajuan, unduh hasil)
 * bisa diuji tanpa akun AWS, tanpa jaringan, dan tanpa biaya. Yang tidak bisa
 * diuji di sini hanyalah apakah AWS menjawab seperti yang dijanjikan
 * dokumentasinya — dan untuk itu ada `dalang cloud:check`.
 */

/** Sebagian `RenderProgress` Remotion yang benar-benar dipakai target ini. */
export interface LambdaRenderProgress {
  /** 0..1 */
  overallProgress: number;
  done: boolean;
  fatalErrorEncountered: boolean;
  errors: Array<{ message: string }>;
  /** URL keluaran di S3, ada setelah selesai. */
  outputFile: string | null;
  outputSizeInBytes: number | null;
  lambdasInvoked: number;
  estimatedBillingDurationInMilliseconds: number | null;
  costs: { accruedSoFar: number };
}

export interface StartRenderInput {
  serveUrl: string;
  composition: string;
  inputProps: Record<string, unknown>;
  codec: "h264" | "h265" | "vp9" | "prores";
  audioCodec?: "aac" | "opus" | "pcm-16" | null;
  crf?: number;
  scale?: number;
  imageFormat?: "jpeg" | "png";
  privacy?: "public" | "private" | "no-acl";
}

export interface StartedRender {
  renderId: string;
  bucketName: string;
}

/**
 * Jembatan tipis ke `@remotion/lambda-client`. Sengaja hanya berisi apa yang
 * dipakai: setiap field tambahan adalah janji yang harus ditepati fake-nya juga.
 */
export interface LambdaRenderClient {
  startRender(input: StartRenderInput): Promise<StartedRender>;
  getProgress(input: {
    renderId: string;
    bucketName: string;
  }): Promise<LambdaRenderProgress>;
  /** Unduh hasil dari S3 ke path lokal; kembalikan ukurannya (byte). */
  download(input: {
    renderId: string;
    bucketName: string;
    outPath: string;
  }): Promise<number>;
}

/**
 * Penyimpanan objek untuk ASET PLAN (bukan situs).
 *
 * `urlFor` mengembalikan URL PER BERKAS, bukan satu URL dasar, karena bawaan
 * yang aman adalah URL bertanda tangan yang berumur pendek — dan tanda
 * tangannya berbeda untuk setiap objek. Penyimpanan yang memang publik boleh
 * saja mengembalikan URL yang bisa ditebak; kontraknya tidak memaksakan.
 */
export interface AssetStore {
  /** Sudah ada dengan isi yang sama? Dipakai supaya render kedua tidak mengunggah ulang. */
  has(projectId: string, file: string, sha256: string): Promise<boolean>;
  upload(input: {
    projectId: string;
    file: string;
    bytes: Uint8Array;
    contentType: string;
    sha256: string;
  }): Promise<void>;
  /** URL yang bisa diambil browser di dalam Lambda, tanpa kredensial AWS. */
  urlFor(projectId: string, file: string): Promise<string>;
}
