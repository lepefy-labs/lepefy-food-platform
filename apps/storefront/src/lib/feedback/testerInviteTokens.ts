import { createHash, randomBytes } from 'node:crypto';

export const TESTER_SESSION_COOKIE = 'lepefy_tester_feedback_session';
export const TESTER_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 45;
export const TESTER_INVITE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

export function createOpaqueToken() {
  return randomBytes(32).toString('base64url');
}

export function hashOpaqueToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isOpaqueToken(value: string) {
  return /^[A-Za-z0-9_-]{40,80}$/.test(value);
}

export function isInviteTokenExpired(createdAt: string | null) {
  if (!createdAt) return true;
  const created = new Date(createdAt).getTime();
  return !Number.isFinite(created) || Date.now() - created > TESTER_INVITE_MAX_AGE_MS;
}
