import { createHash } from 'node:crypto';

/**
 * Hasard déterministe de la démo : même scénario + même version = mêmes
 * données, à chaque exécution et sur chaque machine.
 */

export function seedFrom(text) {
  return createHash('sha256').update(text).digest().readUInt32LE(0);
}

/** mulberry32 : petit PRNG 32 bits, suffisant pour des données d'exemple. */
export function createRandom(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(min, max) { return min + Math.floor(next() * (max - min + 1)); },
    pick(list) { return list[Math.floor(next() * list.length)]; },
    chance(probability) { return next() < probability; },
    shuffle(list) {
      const copy = [...list];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
  };
}

/**
 * UUID stable dérivé du tenant et d'une clé de seed : relancer le seed sur le
 * même tenant retrouve les mêmes lignes (idempotence), un nouveau tenant (remise
 * à zéro) obtient de nouveaux identifiants.
 */
export function stableUuid(tenantId, key) {
  const hex = createHash('sha256').update(`lepefy-demo:${tenantId}:${key}`).digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function stableHex(tenantId, key, length = 32) {
  return createHash('sha256').update(`lepefy-demo-token:${tenantId}:${key}`).digest('hex').slice(0, length);
}

export const round2 = (value) => Math.round(value * 100) / 100;
