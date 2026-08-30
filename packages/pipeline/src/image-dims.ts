/**
 * Baca dimensi PNG/JPEG dari byte header — tanpa dependensi decoder.
 * Cukup untuk ingest aset lokal (stageBox preset butuh rasio aspek).
 */

export interface ImageDims {
  width: number;
  height: number;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

export const imageDims = (bytes: Uint8Array): ImageDims | null => {
  if (bytes.length > 24 && PNG_MAGIC.every((byte, i) => bytes[i] === byte)) {
    // IHDR selalu chunk pertama: width @16, height @20 (big-endian).
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    // JPEG: pindai marker sampai SOF0..SOF15 (kecuali DHT/DAC/RST).
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1] ?? 0;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
        offset += 2;
        continue;
      }
      const length = view.getUint16(offset + 2);
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isSof) {
        return {
          height: view.getUint16(offset + 5),
          width: view.getUint16(offset + 7),
        };
      }
      offset += 2 + length;
    }
  }

  return null;
};
