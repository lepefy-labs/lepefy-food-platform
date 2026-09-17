import { test, expect } from '@playwright/test';
import { generateKeyPairSync, verify, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signJwt, googleObject, issueGoogleWallet, type WalletCard } from '../../src/lib/loyalty/wallet/google';
import { applePassJson } from '../../src/lib/loyalty/wallet/apple';
import { signManifest, zipPass } from '../../src/lib/loyalty/wallet/passArchive';
import { getLoyaltyBrand } from '../../src/lib/loyalty/wallet/brand';
import { getWalletAvailability } from '../../src/lib/loyalty/wallet/config';

const card: WalletCard = {
  tenantId: 'tenant-a', tenantSlug: 'chloefood', customerId: 'customer-a',
  cardNumber: '2000000000015', fullName: 'Élodie Rossi', balance: 240,
  accountUrl: 'https://shop.chloefood.com/compte/carte-fidelite',
  brand: { name: 'ChloéFood', logoUrl: 'https://shop.chloefood.com/logo.png',
    background: '#195B9E', accent: '#F8D817', textAccent: '#F8D817', foreground: '#ffffff' },
};

test('Wallet pass identities isolate both tenant and customer; QR encodes the real card', () => {
  const first = googleObject(card, '12345');
  expect(first.barcode.value).toBe(card.cardNumber);
  expect(first.loyaltyPoints.balance.string).toBe('240');
  expect(googleObject({ ...card, tenantId: 'tenant-b' }, '12345').id).not.toBe(first.id);
  expect(googleObject({ ...card, customerId: 'customer-b' }, '12345').id).not.toBe(first.id);
  const pass = applePassJson(card, { passTypeId: 'pass.com.example.loyalty', teamId: 'EXAMPLE' });
  expect(pass.barcodes[0]!.message).toBe(card.cardNumber);
  expect(pass.storeCard.headerFields[0]!.value).toBe(240);
  expect(pass.serialNumber).not.toBe(applePassJson({ ...card, tenantId: 'tenant-b' },
    { passTypeId: 'pass.com.example.loyalty', teamId: 'EXAMPLE' }).serialNumber);
});

test('ChloéFood palette is branded while other tenants retain their configured colors', () => {
  const tenant = { slug: 'chloefood', name: 'ChloéFood', logo_url: null, primary_color: '#008800', secondary_color: '#ffee00' };
  expect(getLoyaltyBrand(tenant).background).toBe('#195B9E');
  expect(getLoyaltyBrand({ ...tenant, slug: 'other' }).background).toBe('#008800');
  expect(getLoyaltyBrand({ ...tenant, slug: 'other', primary_color: '#ffffff' }).foreground).toBe('#1a1a1a');
});

test('Google JWT signature validates independently with the public key', () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const jwt = signJwt({ aud: 'google', payload: { loyaltyObjects: [{ id: '12345.card' }] } }, key);
  const [header, payload, signature] = jwt.split('.');
  expect(verify('RSA-SHA256', Buffer.from(header + '.' + payload), keys.publicKey,
    Buffer.from(signature!, 'base64url'))).toBe(true);
  expect(verify('RSA-SHA256', Buffer.from(header + '.' + payload + 'x'), keys.publicKey,
    Buffer.from(signature, 'base64url'))).toBe(false);
});

test('Wallet configuration never enables a different tenant', () => {
  const previous = process.env.LOYALTY_WALLET_TENANT_SLUG;
  process.env.LOYALTY_WALLET_TENANT_SLUG = 'tenant-a';
  try { expect(getWalletAvailability('tenant-b', card.brand.logoUrl)).toEqual({ google: false, apple: false }); }
  finally {
    if (previous === undefined) delete process.env.LOYALTY_WALLET_TENANT_SLUG;
    else process.env.LOYALTY_WALLET_TENANT_SLUG = previous;
  }
});

test('Google re-add updates an existing object and issues a short reference-only save token', async () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const config = { issuerId: '12345', email: 'wallet@example.iam.gserviceaccount.com',
    privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
  const original = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'test-token' }));
    if (init?.method === 'POST') return new Response('{}', { status: 409 });
    return new Response('{}');
  }) as typeof fetch;
  try {
    const url = await issueGoogleWallet(card, config);
    expect(calls.map(c => c.init?.method)).toEqual(['POST', 'POST', 'POST', 'PATCH']);
    const jwt = url.split('/').pop()!;
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString());
    expect(payload.payload.loyaltyObjects).toEqual([{ id: googleObject(card, config.issuerId).id }]);
    expect(JSON.stringify(payload)).not.toContain(card.fullName);
    expect(JSON.stringify(payload)).not.toContain(card.cardNumber);
    expect(url.length).toBeLessThan(1800);
  } finally { globalThis.fetch = original; }
});

test('Google provider failures do not produce a save link', async () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{}', { status: 403 })) as typeof fetch;
  try {
    await expect(issueGoogleWallet(card, { issuerId: '12345', email: 'test@example.com',
      privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() })).rejects.toThrow();
  } finally { globalThis.fetch = original; }
});

test('Apple detached CMS verifies with OpenSSL; ZIP validates with an independent reader', () => {
  // CI runs on Ubuntu. These fixtures are temporary synthetic certificates,
  // never Apple production credentials, and never written to the repository.
  const dir = mkdtempSync(join(tmpdir(), 'loyalty-wallet-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=Wallet Unit Test', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')],
      { stdio: 'pipe' });
    const cert = readFileSync(join(dir, 'cert.pem'), 'utf8');
    const key = readFileSync(join(dir, 'key.pem'), 'utf8');
    const pass = Buffer.from(JSON.stringify(applePassJson(card, { passTypeId: 'pass.test', teamId: 'TEST' })));
    const manifest = Buffer.from(JSON.stringify({ 'pass.json': createHash('sha1').update(pass).digest('hex') }));
    const signature = signManifest(manifest, cert, key, cert);
    writeFileSync(join(dir, 'manifest.json'), manifest);
    writeFileSync(join(dir, 'signature'), signature);
    const verified = execFileSync('openssl', ['cms', '-verify', '-binary', '-inform', 'DER',
      '-in', join(dir, 'signature'), '-content', join(dir, 'manifest.json'), '-noverify'], { stdio: 'pipe' });
    expect(verified.equals(manifest)).toBe(true);
    writeFileSync(join(dir, 'manifest.json'), Buffer.from('tampered'));
    expect(() => execFileSync('openssl', ['cms', '-verify', '-binary', '-inform', 'DER',
      '-in', join(dir, 'signature'), '-content', join(dir, 'manifest.json'), '-noverify'], { stdio: 'pipe' })).toThrow();
    writeFileSync(join(dir, 'test.pkpass'), zipPass({ 'pass.json': pass, 'manifest.json': manifest, signature }));
    expect(execFileSync('unzip', ['-t', join(dir, 'test.pkpass')], { encoding: 'utf8' })).toContain('No errors detected');
    const extracted = execFileSync('unzip', ['-p', join(dir, 'test.pkpass'), 'pass.json']);
    expect(extracted.equals(pass)).toBe(true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
