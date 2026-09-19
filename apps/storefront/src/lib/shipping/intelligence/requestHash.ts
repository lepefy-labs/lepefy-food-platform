import { createHash } from 'node:crypto';

/**
 * Clé d'équivalence rapide pour une observation : deux scénarios strictement
 * identiques (mêmes valeurs arrondies) produisent le même hash. Le
 * rapprochement approximatif (tolérance de poids/volume) est fait séparément
 * en base — ce hash ne sert qu'au chemin rapide de correspondance exacte.
 */
export function computeRequestHash(input: {
  provider: string;
  originCountry: string;
  originPostalCode: string;
  destinationCountry: string;
  destinationPostalCode: string;
  numParcels: number;
  parcels: Array<{ weightG: number; lengthCm: number; widthCm: number; heightCm: number }>;
}): string {
  const normalizedParcels = [...input.parcels]
    .map((p) => `${p.weightG}x${p.lengthCm}x${p.widthCm}x${p.heightCm}`)
    .sort()
    .join('|');
  const raw = [
    input.provider,
    input.originCountry,
    input.originPostalCode,
    input.destinationCountry,
    input.destinationPostalCode,
    input.numParcels,
    normalizedParcels,
  ].join('::');
  return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}
