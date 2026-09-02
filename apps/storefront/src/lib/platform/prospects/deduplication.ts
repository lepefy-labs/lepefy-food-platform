import type { Identity } from './types';
export function normalizeText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
export function normalizedDomain(value?: string | null): string | null {
  if (!value) return null;
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? u.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '') : null; }
  catch { return null; }
}
export function identityKey(p: Identity) {
  // An address is required: common shop names + postal code alone are ambiguous.
  return p.postal_code && p.address && p.business_name
    ? [p.country, normalizeText(p.business_name), normalizeText(p.postal_code), normalizeText(p.address)].join(':') : null;
}
export function sameIdentity(a: Identity, b: Identity): boolean {
  if (a.siret && b.siret) return a.siret === b.siret; // Never collapse distinct establishments sharing a domain.
  if (normalizedDomain(a.website_url) && normalizedDomain(a.website_url) === normalizedDomain(b.website_url)) {
    return Boolean(a.postal_code && a.postal_code === b.postal_code && normalizeText(a.business_name) === normalizeText(b.business_name));
  }
  return Boolean(identityKey(a) && identityKey(a) === identityKey(b));
}
