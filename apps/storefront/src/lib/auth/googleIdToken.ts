import 'server-only';
import { createHash, webcrypto } from 'node:crypto';
import { parseGoogleClientIds, validateGoogleClaims, type GoogleClaimsResult } from './googleIdTokenClaims';

// Verifies a Google ID token (Sign in with Google / One Tap) ourselves, with
// WebCrypto and Google's public keys, before anything is written: it lets the
// route ask a new customer for the CGV consent without opening a session.
// Supabase verifies the same token again in signInWithIdToken.

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

interface GoogleJwk extends JsonWebKey { kid?: string }

export function googleClientIds(): string[] {
  return parseGoogleClientIds(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function base64UrlToBytes(segment: string): Uint8Array {
  return new Uint8Array(Buffer.from(segment, 'base64url'));
}

async function googleKeys(): Promise<GoogleJwk[]> {
  // Google rotates its keys over days; the Data Cache keeps one copy per hour.
  const res = await fetch(GOOGLE_JWKS_URL, { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`google_jwks_${res.status}`);
  const body = (await res.json()) as { keys?: GoogleJwk[] };
  return body.keys ?? [];
}

export type GoogleTokenResult = GoogleClaimsResult | { ok: false; issue: 'malformed' | 'signature' };

export async function verifyGoogleIdToken(credential: string, rawNonce: string): Promise<GoogleTokenResult> {
  const parts = credential.split('.');
  const [headerB64, payloadB64, signatureB64] = parts;
  if (parts.length !== 3 || !headerB64 || !payloadB64 || !signatureB64) return { ok: false, issue: 'malformed' };

  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, issue: 'malformed' };
  }
  if (header.alg !== 'RS256' || !header.kid) return { ok: false, issue: 'malformed' };

  const jwk = (await googleKeys()).find((key) => key.kid === header.kid);
  if (!jwk) return { ok: false, issue: 'signature' };

  const key = await webcrypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await webcrypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(signatureB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!valid) return { ok: false, issue: 'signature' };

  return validateGoogleClaims(claims, {
    audiences: googleClientIds(),
    hashedNonce: rawNonce ? sha256Hex(rawNonce) : '',
    nowS: Math.floor(Date.now() / 1000),
  });
}
