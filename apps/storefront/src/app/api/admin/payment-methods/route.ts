import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { parseCreate } from '@/lib/payments/paymentMethodWrite';
import type { PaymentMethodType } from '@lepefy/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function POST(req: NextRequest) {
  const slug     = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant   = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  try {
    const body = await req.json() as Record<string, unknown>;
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });
    const supabase = createServiceClient();

    // Card and Apple Pay are single-instance: read the types already configured.
    const { data: existing, error: readError } = await supabase
      .from('tenant_payment_methods')
      .select('method')
      .eq('tenant_id', tenant.id);
    if (readError) {
      console.error('[payment-methods][POST] read error:', readError);
      return NextResponse.json({ error: 'Le moyen de paiement n’a pas pu être ajouté.' }, { status: 500 });
    }

    const parsed = parseCreate(body, (existing ?? []).map((row) => row.method as PaymentMethodType));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { data, error } = await supabase
      .from('tenant_payment_methods')
      .insert({ tenant_id: tenant.id, ...parsed.values })
      .select('*')
      .single();

    if (error) {
      console.error('[payment-methods][POST] supabase error:', error);
      return NextResponse.json({ error: 'Le moyen de paiement n’a pas pu être ajouté.' }, { status: 500 });
    }

    // /card a revalidate = 300 : sans ceci, la modification resterait
    // invisible jusqu'à 5 minutes.
    revalidatePath('/card');
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error('[payment-methods][POST] error:', err);
    return NextResponse.json({ error: 'Le moyen de paiement n’a pas pu être ajouté.' }, { status: 500 });
  }
}
