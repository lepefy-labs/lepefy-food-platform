/**
 * Controlli puri sui file allegati: tipo reale dai primi byte (non dal nome
 * o dal Content-Type dichiarato) e nome file sicuro.
 */

export function detectDocumentMime(bytes: Uint8Array): string | null {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf'; // %PDF-
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Nome ASCII sicuro per il percorso storage, con estensione coerente con il tipo reale. */
export function safeFileName(original: string, mime: string): string {
  const extension = EXTENSIONS[mime] ?? 'bin';
  const base = (original.split(/[\\/]/).pop() ?? '')
    .replace(/\.[^.]*$/, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80) || 'document';
  return `${base}.${extension}`;
}
