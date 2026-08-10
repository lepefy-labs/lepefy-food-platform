import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { slugify } from '@/lib/utils/format';

// Génération .ics côté serveur — remplace l'ancien Blob+createObjectURL
// client-side (EventConfirmationClient.tsx), pattern connu pour échouer sur
// iOS Safari en PWA standalone (manifest.ts, display: 'standalone'). Même
// pattern d'auth publique que reservation-qr/route.ts : token en query,
// lookup event_reservations via qr_token, vérification tenant_id,
// createServiceClient(), aucun requireAdmin (route publique protégée par le
// token, non devinable — HMAC-SHA256, cf. lib/events/qrToken.ts).
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'token requis.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: reservation } = await supabase
    .from('event_reservations')
    .select('id, tenant_id, event_id, quantity_total')
    .eq('qr_token', token)
    .maybeSingle();

  if (!reservation || reservation.tenant_id !== tenant.id) {
    return NextResponse.json({ error: 'Réservation introuvable.' }, { status: 404 });
  }

  const { data: event } = await supabase
    .from('events')
    .select('title, date_start, location')
    .eq('id', reservation.event_id)
    .maybeSingle();

  if (!event) {
    return NextResponse.json({ error: 'Événement introuvable.' }, { status: 404 });
  }

  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
    `SUMMARY:${event.title}`,
    event.location ? `LOCATION:${event.location.replace(/,/g, '\\,')}` : '',
    `DTSTART:${new Date(event.date_start).toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DESCRIPTION:Réf. #${reservation.id.slice(0, 8).toUpperCase()} — ${reservation.quantity_total} place(s)`,
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');

  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slugify(event.title)}.ics"`,
    },
  });
}
