import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Lien d'accès à une démo privée : `<exp>.<label>.<signature>`, HMAC-SHA256
 * avec DEMO_ACCESS_SECRET. Le libellé (ex. « tata-pao ») sert seulement à
 * savoir à qui le lien a été donné ; il ne donne aucun droit en plus.
 * Pas de donnée personnelle dans le jeton.
 */

export const DEMO_ACCESS_COOKIE = 'lepefy_demo_access';
const LABEL = /^[a-z0-9-]{1,40}$/;

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(`demo-access:${payload}`).digest('base64url');
}

export function createDemoAccessToken(secret: string, label: string, expiresAt: Date): string {
  if (!secret || secret.length < 32) throw new Error('DEMO_ACCESS_SECRET trop court (32 caractères minimum).');
  if (!LABEL.test(label)) throw new Error('Libellé invalide (a-z, 0-9, tiret, 40 caractères).');
  const payload = `${Math.floor(expiresAt.getTime() / 1000)}.${label}`;
  return `${payload}.${sign(secret, payload)}`;
}

export interface DemoAccess { label: string; expiresAt: Date }

export function verifyDemoAccessToken(secret: string | undefined, token: string | null | undefined, now = new Date()): DemoAccess | null {
  if (!secret || secret.length < 32 || !token || token.length > 200) return null;
  const [exp, label, signature, extra] = token.split('.');
  if (extra !== undefined || !exp || !label || !signature) return null;
  if (!/^\d{9,11}$/.test(exp) || !LABEL.test(label)) return null;
  const expected = Buffer.from(sign(secret, `${exp}.${label}`));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  const expiresAt = new Date(Number(exp) * 1000);
  if (expiresAt.getTime() <= now.getTime()) return null;
  return { label, expiresAt };
}
