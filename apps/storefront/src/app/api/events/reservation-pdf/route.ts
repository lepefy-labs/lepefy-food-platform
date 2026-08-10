import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { buildTicketHtml } from '@/lib/events/buildTicketHtml';
import { htmlToPdf } from '@/lib/labels/gotenberg';

// Génération PDF du billet côté serveur (Gotenberg) — remplace l'ancien
// window.print(), pattern connu pour échouer sur iOS Safari en PWA
// standalone (manifest.ts, display: 'standalone'). Même pattern d'auth
// publique que reservation-qr/route.ts (token en query, vérification
// tenant_id, aucun requireAdmin), à la différence de card/poster/route.ts
// qui est réservée à l'admin.
export const runtime = 'nodejs';
export const maxDuration = 30;

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
    .select('id, tenant_id, event_id, customer_name, amount_paid, qr_token, quantity_total')
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

  const qrUrl = `${req.nextUrl.origin}/api/events/reservation-qr?token=${encodeURIComponent(reservation.qr_token)}`;

  const html = buildTicketHtml({
    tenant: { name: tenant.name, primary_color: tenant.primary_color },
    event,
    reservation,
    qrUrl,
  });

  const pdfBuffer = await htmlToPdf(html);
  const reference = reservation.id.slice(0, 8).toUpperCase();

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="billet-${reference}.pdf"`,
    },
  });
}
