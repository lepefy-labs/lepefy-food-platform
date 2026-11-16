import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { parseUpdate } from '@/lib/payments/paymentMethodWrite';
import type { PaymentMethodType } from '@lepefy/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  try {
    const body = await req.json() as Record<string, unknown>;
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });

    const supabase = createServiceClient();
    // The stored type decides which fields exist (the body may omit `method`).
    const { data: existing } = await supabase
      .from('tenant_payment_methods')
      .select('method')
      .eq('id', params.id)
      .eq('tenant_id', tenant.id)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: 'Moyen de paiement introuvable.' }, { status: 404 });

    const parsed = parseUpdate(body, existing as { method: PaymentMethodType });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    if (Object.keys(parsed.values).length === 0) return NextResponse.json({ success: true });

    const { error } = await supabase
      .from('tenant_payment_methods')
      .update(parsed.values)
      .eq('id', params.id)
      .eq('tenant_id', tenant.id);

    if (error) {
      console.error('[payment-methods][PATCH] supabase error:', error);
      return NextResponse.json({ error: 'La modification n’a pas pu être enregistrée.' }, { status: 500 });
    }

    // /card a revalidate = 300 : sans ceci, la modification resterait
    // invisible jusqu'à 5 minutes.
    revalidatePath('/card');
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[payment-methods][PATCH] error:', err);
    return NextResponse.json({ error: 'La modification n’a pas pu être enregistrée.' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { error } = await supabase
    .from('tenant_payment_methods')
    .delete()
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) {
    console.error('[payment-methods][DELETE] supabase error:', error);
    return NextResponse.json({ error: 'Le moyen de paiement n’a pas pu être supprimé.' }, { status: 500 });
  }

  revalidatePath('/card');
  return NextResponse.json({ success: true });
}
