import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { listInbox, parseInboxFilter } from '@/lib/whatsapp/adminQueries';
import { requireWhatsAppApi } from '@/lib/whatsapp/server/featureGate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/** GET boîte de réception (whatsapp.view), toujours limitée au tenant du déploiement. */
export async function GET(request: NextRequest) {
  const gate = await requireWhatsAppApi();
  if (!gate.ok) return gate.response;
  try {
    const items = await listInbox(createServiceClient(), gate.tenant.id, parseInboxFilter(request.nextUrl.searchParams.get('filter')));
    return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Lecture impossible.' }, { status: 500 });
  }
}
