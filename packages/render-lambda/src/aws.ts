import { downloadMedia, getAwsClient } from "@remotion/lambda";
import type { AwsRegion } from "@remotion/lambda-client";
import {
  getRenderProgress,
  presignUrl,
  renderMediaOnLambda,
} from "@remotion/lambda-client";
import type {
  AssetStore,
  LambdaRenderClient,
  LambdaRenderProgress,
  StartRenderInput,
} from "./ports";

/**
 * Adapter AWS sungguhan untuk port di `ports.ts` (ADR-0019).
 *
 * Lapisan ini SENGAJA setipis mungkin dan tanpa logika: seluruh urutan langkah,
 * penanganan galat, batas waktu, dan estimasi biaya hidup di `render.ts` yang
 * teruji tanpa AWS. Yang ada di sini hanya pemetaan ke SDK — bagian yang memang
 * tidak bisa dibuktikan tanpa akun sungguhan.
 *
 * Kontraknya diambil dari tipe paket terpasang, bukan dari ingatan. Dua hal
 * yang mudah salah kalau menebak, dan sudah diperiksa terhadap 4.0.518:
 *  - `renderMediaOnLambda`, `getRenderProgress`, dan `presignUrl` DEPRECATED di
 *    `@remotion/lambda`; yang hidup ada di `@remotion/lambda-client`.
 *  - `deploySite` juga deprecated, digantikan `bundle()` + `deploySiteFromBundle()`.
 */

export interface AwsConfig {
  region: AwsRegion;
  functionName: string;
  bucketName: string;
  /** Umur URL bertanda tangan, detik. Harus lebih panjang dari render. */
  signedUrlTtlSeconds?: number;
}

const DEFAULT_TTL_SECONDS = 6 * 60 * 60;

/** Prefix objek aset, terpisah dari berkas situs Remotion di bucket yang sama. */
export const assetKey = (projectId: string, file: string): string =>
  `dalang-assets/${projectId}/${file}`;

export const createS3AssetStore = (config: AwsConfig): AssetStore => {
  const { client, sdk } = getAwsClient({ region: config.region, service: "s3" });

  return {
    has: async (projectId, file, sha256) => {
      try {
        const head = await client.send(
          new sdk.HeadObjectCommand({
            Bucket: config.bucketName,
            Key: assetKey(projectId, file),
          }),
        );
        // Checksum isi disimpan sebagai metadata: nama berkas yang sama dengan
        // isi berbeda WAJIB terunggah ulang, kalau tidak render memakai versi
        // lama tanpa satu pun tanda.
        return head.Metadata?.["dalang-sha256"] === sha256;
      } catch {
        return false;
      }
    },

    upload: async ({ projectId, file, bytes, contentType, sha256 }) => {
      await client.send(
        new sdk.PutObjectCommand({
          Bucket: config.bucketName,
          Key: assetKey(projectId, file),
          Body: bytes,
          ContentType: contentType,
          Metadata: { "dalang-sha256": sha256 },
        }),
      );
    },

    urlFor: (projectId, file) =>
      presignUrl({
        region: config.region,
        bucketName: config.bucketName,
        objectKey: assetKey(projectId, file),
        expiresInSeconds: config.signedUrlTtlSeconds ?? DEFAULT_TTL_SECONDS,
      }),
  };
};

export const createLambdaRenderClient = (config: AwsConfig): LambdaRenderClient => ({
  startRender: async (input: StartRenderInput) => {
    const out = await renderMediaOnLambda({
      region: config.region,
      functionName: config.functionName,
      serveUrl: input.serveUrl,
      composition: input.composition,
      inputProps: input.inputProps,
      codec: input.codec,
      forceBucketName: config.bucketName,
      ...(input.audioCodec ? { audioCodec: input.audioCodec } : {}),
      ...(input.crf === undefined ? {} : { crf: input.crf }),
      ...(input.scale === undefined ? {} : { scale: input.scale }),
      ...(input.imageFormat ? { imageFormat: input.imageFormat } : {}),
      ...(input.privacy ? { privacy: input.privacy } : {}),
    });
    return { renderId: out.renderId, bucketName: out.bucketName };
  },

  getProgress: async ({ renderId, bucketName }): Promise<LambdaRenderProgress> => {
    const progress = await getRenderProgress({
      renderId,
      bucketName,
      functionName: config.functionName,
      region: config.region,
    });
    return {
      overallProgress: progress.overallProgress,
      done: progress.done,
      fatalErrorEncountered: progress.fatalErrorEncountered,
      errors: progress.errors.map((error) => ({ message: error.message })),
      outputFile: progress.outputFile,
      outputSizeInBytes: progress.outputSizeInBytes,
      lambdasInvoked: progress.lambdasInvoked,
      estimatedBillingDurationInMilliseconds:
        progress.estimatedBillingDurationInMilliseconds,
      costs: { accruedSoFar: progress.costs.accruedSoFar },
    };
  },

  // Pakai downloadMedia() milik Remotion, BUKAN GetObject dengan kunci tebakan:
  // nama berkas keluaran mengikuti codec (out.mp4 / out.webm / out.mov), jadi
  // kunci yang ditulis tangan akan benar untuk MP4 dan diam-diam salah untuk
  // format lain.
  download: async ({ renderId, bucketName, outPath }) => {
    const out = await downloadMedia({
      region: config.region,
      bucketName,
      renderId,
      outPath,
    });
    return out.sizeInBytes;
  },
});
