/**
 * Estimasi biaya render Lambda SEBELUM dijalankan (PRD §6.3).
 *
 * Rumusnya murni supaya bisa diuji sebagai angka. Yang diperkirakan hanya
 * bagian yang bisa diperkirakan sebelum render: durasi video menentukan jumlah
 * chunk, jumlah chunk menentukan jumlah invokasi Lambda, dan lamanya tiap
 * invokasi × memori menentukan GB-detik.
 *
 * KEJUJURAN YANG PENTING: ini estimasi kasar, dan sengaja dibuat CENDERUNG
 * LEBIH TINGGI daripada kenyataan. Gerbang persetujuan yang terlalu optimistis
 * lebih berbahaya daripada yang terlalu hati-hati — user yang menyetujui
 * "$0,04" lalu ditagih "$0,20" akan berhenti mempercayai angkanya sama sekali.
 */

/** Harga GB-detik Lambda x86 di sebagian besar region (USD). */
export const LAMBDA_USD_PER_GB_SECOND = 0.0000166667;
/** Harga per invokasi (USD). */
export const LAMBDA_USD_PER_INVOCATION = 0.0000002;

export interface LambdaCostInput {
  durationInFrames: number;
  fps: number;
  /** Frame per invokasi Lambda; Remotion menyebutnya framesPerLambda. */
  framesPerLambda: number;
  memorySizeInMb: number;
  /**
   * Perkiraan waktu dinding per frame, detik. Bawaan mengasumsikan komposisi
   * seberat preset kami di Lambda 2 GB.
   */
  secondsPerFrame?: number;
}

export interface LambdaCostBreakdown {
  usd: number;
  lambdasInvoked: number;
  gbSeconds: number;
  billedSeconds: number;
}

export const DEFAULT_SECONDS_PER_FRAME = 0.09;

export const estimateLambdaCost = ({
  durationInFrames,
  framesPerLambda,
  memorySizeInMb,
  secondsPerFrame = DEFAULT_SECONDS_PER_FRAME,
}: LambdaCostInput): LambdaCostBreakdown => {
  const frames = Math.max(1, Math.round(durationInFrames));
  const perLambda = Math.max(1, Math.round(framesPerLambda));
  // +1 invokasi untuk fungsi utama yang mengorkestrasi dan menggabungkan.
  const lambdasInvoked = Math.ceil(frames / perLambda) + 1;
  const billedSeconds = frames * secondsPerFrame;
  const gbSeconds = billedSeconds * (memorySizeInMb / 1024);
  const usd =
    gbSeconds * LAMBDA_USD_PER_GB_SECOND + lambdasInvoked * LAMBDA_USD_PER_INVOCATION;
  return {
    // Dibulatkan ke atas pada 4 desimal: lihat catatan kejujuran di atas.
    usd: Math.ceil(usd * 10_000) / 10_000,
    lambdasInvoked,
    gbSeconds: Number(gbSeconds.toFixed(3)),
    billedSeconds: Number(billedSeconds.toFixed(2)),
  };
};
