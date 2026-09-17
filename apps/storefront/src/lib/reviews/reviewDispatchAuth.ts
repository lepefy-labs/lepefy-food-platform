import { timingSafeEqual } from 'node:crypto';

export function reviewDispatchAuthorized(header: string | null, expected = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''): boolean {
  const supplied = header?.startsWith('Bearer ') ? header.slice(7) : '';
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}
