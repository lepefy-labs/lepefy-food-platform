import 'server-only';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { getAdminId } from '@/lib/auth/getAdminId';
import type { ServiceResult } from './repository';

/**
 * Guardia comune delle route `/api/admin/platform/external-catalogs/**`:
 * solo platform owner; le scritture rifiutano un'origine diversa (CSRF).
 */
export async function guardPlatformOwner(req: NextRequest, write: boolean): Promise<{ actor: string | null } | NextResponse> {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  if (write) {
    const origin = req.headers.get('origin');
    if (origin && origin !== req.nextUrl.origin) return NextResponse.json({ error: 'Origine refusée.' }, { status: 403 });
  }
  return { actor: await getAdminId() };
}

export function respond<T>(result: ServiceResult<T>, okStatus = 200): NextResponse {
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json(result.data, { status: okStatus, headers: { 'Cache-Control': 'no-store' } });
}

export function invalid(message = 'Paramètres invalides.'): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}
