import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

// QR d'entrée — encode directement le qr_token opaque (bearer, voir
// lib/events/qrToken.ts), lu tel quel par le scanner admin
// (html5-qrcode, même lib que /admin/loyalty/scan) puis envoyé à
// POST /api/admin/evenementiel/scan. Pas de satori/overlay logo ici
// (contrairement à /api/shop/qr-code) : ce QR n'est jamais imprimé en
// grand format, juste affiché sur la page de confirmation.
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
    .select('id, tenant_id')
    .eq('qr_token', token)
    .maybeSingle();

  if (!reservation || reservation.tenant_id !== tenant.id) {
    return NextResponse.json({ error: 'Réservation introuvable.' }, { status: 404 });
  }

  const svg = await QRCode.toString(token, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 260,
    color: { dark: tenant.primary_color, light: '#ffffff' },
  });

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
