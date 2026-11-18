// Pure validation of a Google ID token's claims (no I/O, unit-tested).
// The signature is checked separately (googleIdToken.ts); this module only
// decides whether already-verified claims may sign a customer in.

export const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'] as const;

/** Tolerated clock difference between Google and our server. */
export const CLOCK_SKEW_S = 120;

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string | null;
}

export type GoogleClaimsIssue =
  | 'issuer'
  | 'audience'
  | 'expired'
  | 'not_yet_valid'
  | 'nonce'
  | 'email_missing'
  | 'email_unverified';

export type GoogleClaimsResult =
  | { ok: true; identity: GoogleIdentity }
  | { ok: false; issue: GoogleClaimsIssue };

/** Client IDs accepted as audience, from a comma-separated env value. */
export function parseGoogleClientIds(value: string | undefined | null): string[] {
  return (value ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

export function validateGoogleClaims(
  claims: Record<string, unknown>,
  options: { audiences: string[]; hashedNonce: string; nowS: number },
): GoogleClaimsResult {
  const { audiences, hashedNonce, nowS } = options;

  if (typeof claims.iss !== 'string' || !(GOOGLE_ISSUERS as readonly string[]).includes(claims.iss)) {
    return { ok: false, issue: 'issuer' };
  }

  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (audiences.length === 0 || !aud.some((a) => typeof a === 'string' && audiences.includes(a))) {
    return { ok: false, issue: 'audience' };
  }

  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < nowS) {
    return { ok: false, issue: 'expired' };
  }
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_S > nowS) {
    return { ok: false, issue: 'not_yet_valid' };
  }

  // The browser hands Google sha256(rawNonce) and keeps rawNonce for us: a
  // token replayed from another page load carries another nonce.
  if (typeof claims.nonce !== 'string' || !hashedNonce || claims.nonce !== hashedNonce) {
    return { ok: false, issue: 'nonce' };
  }

  if (typeof claims.email !== 'string' || !claims.email.includes('@')) {
    return { ok: false, issue: 'email_missing' };
  }
  // Google sends a boolean, some older tokens the string "true".
  if (claims.email_verified !== true && claims.email_verified !== 'true') {
    return { ok: false, issue: 'email_unverified' };
  }

  if (typeof claims.sub !== 'string' || !claims.sub) {
    return { ok: false, issue: 'issuer' };
  }

  const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : null;
  return { ok: true, identity: { sub: claims.sub, email: claims.email, name } };
}
