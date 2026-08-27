import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { htmlToPdf } from '@/lib/labels/gotenberg';
import { buildReservationTableCardsHtml, loadEventReservationExportData } from '@/lib/events/adminReservationExports';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const eventId = req.nextUrl.searchParams.get('event_id');
  if (!eventId) return NextResponse.json({ error: 'event_id requis.' }, { status: 400 });

  const data = await loadEventReservationExportData(createServiceClient(), tenant.id, eventId);
  if (!data) return NextResponse.json({ error: 'Événement introuvable.' }, { status: 404 });

  const pdfBuffer = await htmlToPdf(
    buildReservationTableCardsHtml(data, tenant.name, tenant.logo_url, req.nextUrl.origin),
  );
  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="codes-reservations-a5.pdf"',
      'Cache-Control': 'no-store',
    },
  });
}
