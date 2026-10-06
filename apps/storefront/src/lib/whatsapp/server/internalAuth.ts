import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { internalSecret } from '@/lib/whatsapp/config';

/** Bearer WHATSAPP_INTERNAL_SECRET (n8n), comparaison en temps constant ; secret absent = refus. */
export function isAuthorizedInternalRequest(request: NextRequest): boolean {
  const secret = internalSecret();
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (!secret || !provided) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
