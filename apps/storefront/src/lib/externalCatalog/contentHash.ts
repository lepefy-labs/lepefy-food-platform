import { createHash } from 'node:crypto';
import type { RawExternalProduct } from './types';

/**
 * Hash del contenuto commerciale di un prodotto esterno: cambia quando cambia
 * qualcosa che l'admin potrebbe voler riportare sul prodotto Lepefy (nome,
 * descrizione, prezzi, disponibilità, immagini). Serve a marcare "Modifié".
 */
export function externalContentHash(raw: RawExternalProduct): string {
  const stable = JSON.stringify([
    raw.name ?? null,
    raw.description ?? null,
    raw.rawPrice === null ? null : String(raw.rawPrice),
    raw.rawSalePrice === null ? null : String(raw.rawSalePrice),
    raw.currency ?? null,
    raw.availability ?? null,
    raw.isHidden ?? null,
    raw.images.map((i) => i.providerImageId ?? i.originalUrl?.split('?')[0] ?? i.previewUrl?.split('?')[0] ?? null),
  ]);
  return createHash('sha256').update(stable).digest('hex');
}
