import crypto from 'crypto';

// Autorise un client non connecté (checkout guest, flux external_link) à
// consulter/modifier sa propre checkout_session sans exiger de login — même
// principe et même secret que le token de suivi commande (generateTrackingToken).
// Mirror exact de l'algorithme, jamais un nouveau secret introduit ici.
export function generateCheckoutSessionAccessToken(sessionId: string, email: string): string {
  return crypto
    .createHmac('sha256', process.env.TRACKING_SECRET!)
    .update(sessionId + email)
    .digest('hex');
}

export function isValidCheckoutSessionAccessToken(sessionId: string, email: string, token: string): boolean {
  if (!process.env.TRACKING_SECRET || !token) return false;
  const expected = generateCheckoutSessionAccessToken(sessionId, email);
  try {
    return crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
