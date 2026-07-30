import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { confirmSignupBonus } from '@/lib/loyalty/confirmSignupBonus';

// Riusa confirmSignupBonus() — la STESSA funzione chiamata automaticamente da
// processOrderPointsOnDelivery — non una logica di conferma duplicata. Qui
// senza il gate "primo ordine consegnato": è una conferma manuale deliberata
// dall'admin dopo revisione del pannello "bonus de bienvenue en attente".
export async function POST(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as { customerId?: string };
  if (!body.customerId) {
    return NextResponse.json({ error: 'customerId requis.' }, { status: 400 });
  }

  try {
    await confirmSignupBonus(tenant.id, body.customerId);
  } catch (err) {
    console.error('[api/admin/loyalty/confirm-signup-bonus] error:', err,
      '— customer_id:', body.customerId);
    return NextResponse.json({ error: 'Erreur lors de la confirmation.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
