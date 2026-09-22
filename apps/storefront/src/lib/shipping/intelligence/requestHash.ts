import { createHash } from 'node:crypto';

/**
 * Clé d'identité d'une demande provider : deux demandes strictement
 * identiques (origine, pays + CAP de destination, colis poids × dimensions)
 * produisent le même hash. Le tenant n'y figure pas — toute lecture filtre
 * tenant_id séparément. Le hash sert de clé de recherche ; la correspondance
 * est ensuite revérifiée champ par champ (requestIdentity.ts). Aucune
 * tolérance de poids/volume : c'est la seule équivalence admise pour un
 * réemploi en campagne.
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
