import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { planReorder } from '@/lib/payments/paymentMethodForm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * PUT { ids: string[] } — the full list of the tenant's payment methods in the
 * new display order. sort_order becomes the position (0, 1, 2…); only rows
 * whose position changed are written.
 */
export async function PUT(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: rows, error: readError } = await supabase
    .from('tenant_payment_methods')
    .select('id, sort_order')
    .eq('tenant_id', tenant.id);
  if (readError) {
    console.error('[payment-methods][order] read error:', readError);
    return NextResponse.json({ error: 'Impossible de lire les moyens de paiement.' }, { status: 500 });
  }

  const plan = planReorder(rows ?? [], body.ids);
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 409 });

  for (const update of plan.updates) {
    const { error } = await supabase
      .from('tenant_payment_methods')
      .update({ sort_order: update.sort_order })
      .eq('id', update.id)
      .eq('tenant_id', tenant.id);
    if (error) {
      console.error('[payment-methods][order] update error:', error);
      return NextResponse.json({ error: 'L’ordre n’a pas pu être enregistré entièrement. Rechargez la page.' }, { status: 500 });
    }
  }

  revalidatePath('/card');
  return NextResponse.json({ success: true, updated: plan.updates.length });
}
