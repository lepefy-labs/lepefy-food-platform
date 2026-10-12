import { NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createPublicClient } from '@/lib/supabase/public';
import { normalizeFulfillmentPolicy } from '@/lib/fulfillment/fulfillmentPolicy';
import type { ProductFulfillmentPolicy } from '@lepefy/types';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 100;

export interface ProductFulfillmentResponse {
  policies: Record<string, ProductFulfillmentPolicy>;
}

/**
 * Mode de réception actuel des produits d'un panier (migration 155), lu
 * frais : le panier local peut dater d'avant un changement en admin. Guide
 * le panier et le checkout ; `/api/checkout` reste la seule autorité.
 * GET /api/products/fulfillment?ids=<uuid>,<uuid>
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('ids') ?? '';
  const ids = Array.from(new Set(raw.split(',').map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0) return NextResponse.json({ policies: {} } satisfies ProductFulfillmentResponse);
  if (ids.length > MAX_IDS || ids.some((id) => !UUID.test(id))) {
    return NextResponse.json({ error: 'Produits invalides.' }, { status: 400 });
  }

  try {
    const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
    const { data, error } = await createPublicClient()
      .from('products')
      .select('id, fulfillment_policy')
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .in('id', ids) as { data: Array<{ id: string; fulfillment_policy: string | null }> | null; error: unknown };
    if (error || !data) throw error ?? new Error('fulfillment_lookup_failed');

    const policies = Object.fromEntries(data.map((row) => [row.id, normalizeFulfillmentPolicy(row.fulfillment_policy)]));
    return NextResponse.json({ policies } satisfies ProductFulfillmentResponse, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[products/fulfillment] lookup failed:', error);
    return NextResponse.json({ error: 'Vérification impossible.' }, { status: 503 });
  }
}
