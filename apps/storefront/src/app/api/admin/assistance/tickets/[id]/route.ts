import { NextResponse } from 'next/server';
import { supportTenantApi } from '@/lib/support/server/access';
import { tenantThread } from '@/lib/support/server/tenantService';
import { supportErrorResponse } from '@/lib/support/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Conversation of the shop's own request (public projection only), for the refresh while the page is open. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const guard = await supportTenantApi({ write: false });
  if (!guard.ok) return guard.response;
  try {
    const thread = await tenantThread(guard.tenant.id, params.id, guard.adminId);
    if (!thread) return NextResponse.json({ error: 'Demande introuvable.' }, { status: 404 });
    return NextResponse.json({ thread }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return supportErrorResponse(error, 'Conversation indisponible pour le moment.');
  }
}
