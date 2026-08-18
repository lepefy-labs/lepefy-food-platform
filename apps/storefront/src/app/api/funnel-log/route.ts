import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

// Endpoint pubblico, scrittura sola — mai awaited lato client (fetch con
// keepalive: true, errori ignorati). Nessuna business logic: un solo INSERT,
// risposta immediata. Un fallimento qui non deve MAI riflettersi sul flusso
// di pagamento.
interface FunnelLogBody {
  module:       'shop' | 'card' | 'event' | 'rental';
  event_type:   string;
  reference_id?: string | null;
  detail?:      Record<string, unknown> | null;
}

export async function POST(req: NextRequest) {
  try {
    const body: FunnelLogBody = await req.json();
    if (!body.module || !body.event_type) {
      return NextResponse.json({ error: 'Dati mancanti.' }, { status: 400 });
    }

    const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant = await getTenant(slug);
    const supabase = createServiceClient();

    await supabase.from('payment_funnel_logs').insert({
      tenant_id:    tenant.id,
      module:       body.module,
      event_type:   body.event_type,
      reference_id: body.reference_id ?? null,
      detail:       body.detail ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    // Silenzioso di proposito — mai far fallire il checkout per un log.
    console.error('[funnel-log] error (non bloccante):', err);
    return NextResponse.json({ ok: false });
  }
}
