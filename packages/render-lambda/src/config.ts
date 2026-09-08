import { DEFAULT_LAMBDA_CONFIG } from "./render";

/**
 * Konfigurasi render cloud dari ENVIRONMENT (ADR-0019).
 *
 * Sengaja dari env, bukan dari scene-plan: nama fungsi Lambda dan bucket adalah
 * milik MESIN/akun yang menjalankan, bukan milik dokumen video. Menaruhnya di
 * plan berarti ia ikut ter-commit, ter-diff, dan ter-undo — dan proyek yang
 * dibagikan akan menunjuk infrastruktur orang lain.
 *
 * Hasilnya bukan boolean: pemakainya harus bisa menyebut APA yang kurang,
 * bukan sekadar bahwa sesuatu kurang.
 */

export interface CloudEnv {
  AWS_REGION?: string;
  DALANG_LAMBDA_FUNCTION?: string;
  DALANG_LAMBDA_BUCKET?: string;
  DALANG_LAMBDA_SERVE_URL?: string;
  DALANG_LAMBDA_MEMORY_MB?: string;
  DALANG_LAMBDA_FRAMES_PER_LAMBDA?: string;
}

export interface CloudConfig {
  region: string;
  functionName: string;
  bucketName: string;
  serveUrl: string;
  memorySizeInMb: number;
  framesPerLambda: number;
}

const REQUIRED: Array<[keyof CloudEnv, string]> = [
  ["AWS_REGION", "region AWS, mis. ap-southeast-1"],
  [
    "DALANG_LAMBDA_FUNCTION",
    "nama fungsi Lambda hasil `remotion lambda functions deploy`",
  ],
  ["DALANG_LAMBDA_BUCKET", "nama bucket S3 Remotion (remotionlambda-…)"],
  ["DALANG_LAMBDA_SERVE_URL", "URL situs hasil `remotion lambda sites create`"],
];

/** Baca konfigurasi, atau jelaskan APA yang kurang — bukan sekadar gagal. */
export const readCloudConfig = (
  env: CloudEnv = process.env as CloudEnv,
): { ok: true; config: CloudConfig } | { ok: false; missing: string[] } => {
  const missing = REQUIRED.filter(([key]) => !env[key]?.trim()).map(
    ([key, hint]) => `${key} — ${hint}`,
  );
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    config: {
      region: env.AWS_REGION as string,
      functionName: env.DALANG_LAMBDA_FUNCTION as string,
      bucketName: env.DALANG_LAMBDA_BUCKET as string,
      serveUrl: env.DALANG_LAMBDA_SERVE_URL as string,
      memorySizeInMb: Number(
        env.DALANG_LAMBDA_MEMORY_MB ?? DEFAULT_LAMBDA_CONFIG.memorySizeInMb,
      ),
      framesPerLambda: Number(
        env.DALANG_LAMBDA_FRAMES_PER_LAMBDA ?? DEFAULT_LAMBDA_CONFIG.framesPerLambda,
      ),
    },
  };
};
