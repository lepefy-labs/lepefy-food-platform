import crypto from 'crypto';

// Signature HMAC partagée par tous les points server-side qui émettent ou
// valident un lien de suivi commande (email n8n, régénération admin, page
// /orders, validation /orders/[id]). Le pendant client (CopyTrackingButton)
// ne peut pas importer ce module — il tourne dans le navigateur et rejoue le
// même algorithme via Web Crypto — mais doit rester bit-à-bit identique.
export function generateTrackingToken(orderId: string, email: string): string {
  return crypto
    .createHmac('sha256', process.env.TRACKING_SECRET!)
    .update(orderId + email)
    .digest('hex');
}

export function isValidTrackingToken(orderId: string, email: string, token: string): boolean {
  if (!process.env.TRACKING_SECRET || !token) return false;
  const expected = generateTrackingToken(orderId, email);
  try {
    return crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
