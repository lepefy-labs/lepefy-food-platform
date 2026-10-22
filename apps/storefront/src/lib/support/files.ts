import { SUPPORT_LIMITS, type SupportImageMime } from './domain';

/**
 * Screenshot checks without image processing: the type comes from the bytes
 * (never from the browser's header or the file name) and the size from the
 * image header, so the conversation reserves the right space before loading.
 */

export function sniffSupportImage(bytes: Uint8Array): SupportImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

export const SUPPORT_IMAGE_EXTENSION: Record<SupportImageMime, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;

/** Width × height read from the header; null when it cannot be read (the file stays valid). */
export function imageDimensions(bytes: Uint8Array, mime: SupportImageMime): { width: number; height: number } | null {
  try {
    if (mime === 'image/png' && bytes.length >= 24) {
      return valid(u32be(bytes, 16), u32be(bytes, 20));
    }
    if (mime === 'image/webp' && bytes.length >= 30) {
      const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
      if (chunk === 'VP8X') return valid(u24le(bytes, 24) + 1, u24le(bytes, 27) + 1);
      if (chunk === 'VP8L') {
        const b = bytes.subarray(21, 25);
        return valid(1 + (((b[1]! & 0x3f) << 8) | b[0]!), 1 + (((b[3]! & 0x0f) << 10) | (b[2]! << 2) | ((b[1]! & 0xc0) >> 6)));
      }
      if (chunk === 'VP8 ') return valid(u16le(bytes, 26) & 0x3fff, u16le(bytes, 28) & 0x3fff);
      return null;
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) { i += 1; continue; }
        const marker = bytes[i + 1]!;
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) { i += marker === 0xff ? 1 : 2; continue; }
        const length = u16be(bytes, i + 2);
        // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC).
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return valid(u16be(bytes, i + 7), u16be(bytes, i + 5));
        }
        if (length < 2) return null;
        i += 2 + length;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function valid(width: number, height: number): { width: number; height: number } | null {
  return width > 0 && height > 0 && width <= 40_000 && height <= 40_000 ? { width, height } : null;
}

export type SupportFileCheck =
  | { ok: true; mime: SupportImageMime; width: number | null; height: number | null }
  | { ok: false; error: string };

/** Server-side validation of one upload (size, real type). */
export function checkSupportImage(bytes: Uint8Array): SupportFileCheck {
  if (bytes.byteLength === 0) return { ok: false, error: 'Le fichier est vide.' };
  if (bytes.byteLength > SUPPORT_LIMITS.attachmentBytes) return { ok: false, error: 'Image trop lourde : 5 Mo au maximum.' };
  const mime = sniffSupportImage(bytes);
  if (!mime) return { ok: false, error: 'Format accepté : capture ou photo JPEG, PNG ou WebP.' };
  const size = imageDimensions(bytes, mime);
  return { ok: true, mime, width: size?.width ?? null, height: size?.height ?? null };
}
