import { createPrivateKey, X509Certificate } from 'node:crypto';

function pem(value: string | undefined): string {
  return (value ?? '').replace(/\\n/g, '\n');
}

export function getWalletConfig(slug: string) {
  // Deployment secrets must be explicitly bound to one tenant.
  const enabled = process.env.LOYALTY_WALLET_TENANT_SLUG === slug;
  const google = enabled && process.env.GOOGLE_WALLET_ISSUER_ID &&
    process.env.GOOGLE_WALLET_CLIENT_EMAIL && process.env.GOOGLE_WALLET_PRIVATE_KEY
    ? {
      issuerId: process.env.GOOGLE_WALLET_ISSUER_ID,
      email: process.env.GOOGLE_WALLET_CLIENT_EMAIL,
      privateKey: pem(process.env.GOOGLE_WALLET_PRIVATE_KEY),
    } : null;
  const apple = enabled && process.env.APPLE_WALLET_PASS_TYPE_ID && process.env.APPLE_WALLET_TEAM_ID &&
    process.env.APPLE_WALLET_CERTIFICATE && process.env.APPLE_WALLET_PRIVATE_KEY && process.env.APPLE_WALLET_WWDR_CERTIFICATE
    ? {
      passTypeId: process.env.APPLE_WALLET_PASS_TYPE_ID,
      teamId: process.env.APPLE_WALLET_TEAM_ID,
      certificate: pem(process.env.APPLE_WALLET_CERTIFICATE),
      privateKey: pem(process.env.APPLE_WALLET_PRIVATE_KEY),
      wwdr: pem(process.env.APPLE_WALLET_WWDR_CERTIFICATE),
      passphrase: process.env.APPLE_WALLET_KEY_PASSPHRASE,
    } : null;
  return { google, apple };
}

export function getWalletAvailability(slug: string, logoUrl: string | null) {
  const config = getWalletConfig(slug);
  let google = false;
  let apple = false;
  try {
    google = !!logoUrl && new URL(logoUrl).protocol === 'https:' && !!config.google && /^\d+$/.test(config.google.issuerId) &&
      createPrivateKey(config.google.privateKey).asymmetricKeyType === 'rsa';
  } catch { /* Incomplete or malformed configuration stays unavailable. */ }
  try {
    if (config.apple) {
      const cert = new X509Certificate(config.apple.certificate);
      const wwdr = new X509Certificate(config.apple.wwdr);
      const key = createPrivateKey({ key: config.apple.privateKey, passphrase: config.apple.passphrase });
      const now = Date.now();
      apple = key.asymmetricKeyType === 'rsa' && cert.checkPrivateKey(key) &&
        cert.verify(wwdr.publicKey) &&
        cert.subject.split('\n').includes('UID=' + config.apple.passTypeId) &&
        cert.subject.split('\n').includes('OU=' + config.apple.teamId) &&
        now >= Date.parse(cert.validFrom) && now < Date.parse(cert.validTo) &&
        now >= Date.parse(wwdr.validFrom) && now < Date.parse(wwdr.validTo);
    }
  } catch { /* Expired/mismatched certificates must never advertise a working pass. */ }
  return { google, apple };
}
