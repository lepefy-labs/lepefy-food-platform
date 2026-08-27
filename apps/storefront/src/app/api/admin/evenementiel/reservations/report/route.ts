import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { buildReservationsCsv, loadEventReservationExportData } from '@/lib/events/adminReservationExports';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const eventId = req.nextUrl.searchParams.get('event_id');
  if (!eventId) return NextResponse.json({ error: 'event_id requis.' }, { status: 400 });

  const data = await loadEventReservationExportData(createServiceClient(), tenant.id, eventId);
  if (!data) return NextResponse.json({ error: 'Événement introuvable.' }, { status: 404 });

  const csv = buildReservationsCsv(data, tenant.currency);
  const safeTitle = data.event.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'evenement';
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="reservations-${safeTitle}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
