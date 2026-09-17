import { sign } from 'node:crypto';
import type { LoyaltyBrand } from './brand';

interface Config { issuerId: string; email: string; privateKey: string }
export interface WalletCard {
  tenantId: string; tenantSlug: string; customerId: string; cardNumber: string;
  fullName: string | null; balance: number; brand: LoyaltyBrand; accountUrl: string;
}

export function signJwt(payload: Record<string, unknown>, privateKey: string): string {
  const input = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url') + '.' +
    Buffer.from(JSON.stringify(payload)).toString('base64url');
  return input + '.' + sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url');
}

export function googleObject(card: WalletCard, issuerId: string) {
  const classId = issuerId + '.loyalty_' + card.tenantId;
  return {
    id: issuerId + '.loyalty_' + card.tenantId + '_' + card.customerId,
    classId,
    state: 'ACTIVE',
    accountId: card.cardNumber,
    accountName: card.fullName || 'Client',
    barcode: { type: 'QR_CODE', value: card.cardNumber, alternateText: card.cardNumber },
    loyaltyPoints: { label: 'Points confirmés', balance: { string: String(card.balance) } },
    hexBackgroundColor: card.brand.background,
    linksModuleData: { uris: [{ uri: card.accountUrl, description: 'Ma carte et mon solde actuel', id: 'account' }] },
    textModulesData: [{ id: 'balance-info', header: 'Solde de points',
      body: 'Solde au dernier ajout de la carte. Consultez votre compte pour le solde actuel.' }],
  };
}

export async function issueGoogleWallet(card: WalletCard, config: Config): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt({
    iss: config.email, scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }, config.privateKey);
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!tokenResponse.ok) throw new Error('Google Wallet authentication failed');
  const token = await tokenResponse.json() as { access_token: string };
  const headers = { Authorization: 'Bearer ' + token.access_token, 'Content-Type': 'application/json' };
  const object = googleObject(card, config.issuerId);
  const logo = card.brand.logoUrl;
  if (!logo || new URL(logo).protocol !== 'https:') throw new Error('A public HTTPS logo is required');

  // Existing classes are left intact, preserving the issuer's review state.
  const classResponse = await fetch('https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass', {
    method: 'POST', headers, cache: 'no-store', signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      id: object.classId, issuerName: card.brand.name, programName: card.brand.name + ' Club',
      programLogo: { sourceUri: { uri: logo }, contentDescription: { defaultValue: { language: 'fr-FR', value: card.brand.name } } },
      reviewStatus: 'UNDER_REVIEW',
    }),
  });
  if (!classResponse.ok && classResponse.status !== 409) throw new Error('Google Wallet class creation failed');
  const endpoint = 'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject';
  const response = await fetch(endpoint, {
    method: 'POST', headers, cache: 'no-store', signal: AbortSignal.timeout(15000), body: JSON.stringify(object),
  });
  if (response.status === 409) {
    const updated = await fetch(endpoint + '/' + encodeURIComponent(object.id), {
      method: 'PATCH', headers, cache: 'no-store', signal: AbortSignal.timeout(15000), body: JSON.stringify(object),
    });
    if (!updated.ok) throw new Error('Google Wallet object update failed');
  } else if (!response.ok) throw new Error('Google Wallet object creation failed');
  // Keep the save token short: no personal fields or full class in the URL.
  const jwt = signJwt({
    iss: config.email, aud: 'google', typ: 'savetowallet', iat: now,
    origins: [new URL(card.accountUrl).origin],
    payload: { loyaltyObjects: [{ id: object.id }] },
  }, config.privateKey);
  return 'https://pay.google.com/gp/v/save/' + jwt;
}
