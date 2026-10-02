import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/adminRbac';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { loadCartonSuggestion } from '@/lib/shipping/loadCartonSuggestion';
import { loadOrderOperationPreparation } from '@/lib/orders/loadOrderOperationDetail';
import type { OrderItem } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requirePermission(tenant.id, 'orders.view');
  if (denied) return denied;
  const db = createServiceClient();
  const preparation = await loadOrderOperationPreparation(db, tenant.id, params.id).catch(() => 'unavailable' as const);
  if (preparation === 'unavailable') return NextResponse.json({ error: 'Préparation indisponible.' }, { status: 503 });
  if (!preparation) return NextResponse.json({ error: 'Commande introuvable.' }, { status: 404 });
  const { order, items } = preparation;
  if (order.fulfillment_type === 'pickup' || order.status === 'cancelled') return NextResponse.json({ suggestion: null, missingWeightLines: 0 });
  const weight = (order.shipping_details as { totalWeightG?: number } | null)?.totalWeightG;
  const result = await loadCartonSuggestion(db, tenant.id, items as Pick<OrderItem, 'product_id' | 'quantity'>[], weight)
    .catch(() => null);
  if (!result) return NextResponse.json({ error: 'Suggestion indisponible.' }, { status: 503 });
  return NextResponse.json(result);
}
