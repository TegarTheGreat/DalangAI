/**
 * Content-type per ekstensi.
 *
 * Bukan kosmetik: berkas yang diunggah dengan tipe salah tetap tersimpan, tapi
 * browser di dalam Lambda menolak memutarnya — dan gejalanya adalah video yang
 * kehilangan gambar atau suara TANPA satu pun pesan galat.
 */
const BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  avif: "image/avif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
};

export const contentTypeFor = (file: string): string => {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXT[ext] ?? "application/octet-stream";
};
