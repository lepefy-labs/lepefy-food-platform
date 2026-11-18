import { expect, test } from '@playwright/test';
import { parseGoogleClientIds, validateGoogleClaims } from '../../src/lib/auth/googleIdTokenClaims';

const NOW = 1_800_000_000;
const AUD = 'shop-client.apps.googleusercontent.com';
const NONCE = 'a'.repeat(64);

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: 'https://accounts.google.com',
    aud: AUD,
    sub: '1234567890',
    email: 'client@gmail.com',
    email_verified: true,
    name: '  Awa Diallo ',
    nonce: NONCE,
    iat: NOW - 10,
    exp: NOW + 3600,
    ...overrides,
  };
}

const options = { audiences: [AUD], hashedNonce: NONCE, nowS: NOW };

test.describe('validateGoogleClaims', () => {
  test('accepts a valid token and trims the name', () => {
    expect(validateGoogleClaims(claims(), options)).toEqual({
      ok: true,
      identity: { sub: '1234567890', email: 'client@gmail.com', name: 'Awa Diallo' },
    });
  });

  test('accepts both Google issuers and the legacy "true" string', () => {
    expect(validateGoogleClaims(claims({ iss: 'accounts.google.com', email_verified: 'true' }), options).ok).toBe(true);
  });

  test('refuses another issuer', () => {
    expect(validateGoogleClaims(claims({ iss: 'https://evil.example' }), options)).toEqual({ ok: false, issue: 'issuer' });
  });

  test('refuses a token issued for another client, and any token when no client is configured', () => {
    expect(validateGoogleClaims(claims({ aud: 'other.apps.googleusercontent.com' }), options)).toEqual({ ok: false, issue: 'audience' });
    expect(validateGoogleClaims(claims(), { ...options, audiences: [] })).toEqual({ ok: false, issue: 'audience' });
  });

  test('accepts any configured client of the multi-tenant list', () => {
    expect(validateGoogleClaims(claims(), { ...options, audiences: ['other', AUD] }).ok).toBe(true);
  });

  test('refuses an expired token beyond the clock skew', () => {
    expect(validateGoogleClaims(claims({ exp: NOW - 60 }), options).ok).toBe(true);
    expect(validateGoogleClaims(claims({ exp: NOW - 600 }), options)).toEqual({ ok: false, issue: 'expired' });
  });

  test('refuses a token issued in the future', () => {
    expect(validateGoogleClaims(claims({ iat: NOW + 600 }), options)).toEqual({ ok: false, issue: 'not_yet_valid' });
  });

  test('refuses a missing or different nonce', () => {
    expect(validateGoogleClaims(claims({ nonce: undefined }), options)).toEqual({ ok: false, issue: 'nonce' });
    expect(validateGoogleClaims(claims({ nonce: 'b'.repeat(64) }), options)).toEqual({ ok: false, issue: 'nonce' });
    expect(validateGoogleClaims(claims(), { ...options, hashedNonce: '' })).toEqual({ ok: false, issue: 'nonce' });
  });

  test('refuses an unverified or missing e-mail', () => {
    expect(validateGoogleClaims(claims({ email_verified: false }), options)).toEqual({ ok: false, issue: 'email_unverified' });
    expect(validateGoogleClaims(claims({ email: undefined }), options)).toEqual({ ok: false, issue: 'email_missing' });
  });
});

test('parseGoogleClientIds splits and trims the env list', () => {
  expect(parseGoogleClientIds(' a.apps , ,b.apps ')).toEqual(['a.apps', 'b.apps']);
  expect(parseGoogleClientIds(undefined)).toEqual([]);
});
