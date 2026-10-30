/** Machine credential helpers (pure): format, hashing, header parsing. Only the SHA-256 is ever stored. */
import { createHash, randomBytes } from 'node:crypto';

export const TOKEN_PREFIX = 'lpe_eng_';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 256 random bits. Shown once at creation. */
export function generateToken(): { token: string; hash: string; prefix: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashToken(token), prefix: token.slice(0, 12) };
}

export function parseBearer(header: string | null | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  const token = match?.[1] ?? '';
  return token.startsWith(TOKEN_PREFIX) && token.length >= 40 && token.length <= 100 ? token : null;
}
