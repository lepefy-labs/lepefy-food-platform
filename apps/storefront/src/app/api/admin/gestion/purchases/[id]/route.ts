import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessManagementApi } from '@/lib/gestion/featureGate';
import { getPurchaseDetail } from '@/lib/gestion/queries';
import { badRequest, callGestionRpc, revalidateGestion } from '@/lib/gestion/rpc';
import { firstIssue, updatePurchaseSchema } from '@/lib/gestion/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireBusinessManagementApi();
  if (!gate.ok) return gate.response;
  const purchase = await getPurchaseDetail(gate.tenant.id, params.id).catch(() => null);
  if (!purchase) return NextResponse.json({ error: 'Achat introuvable.' }, { status: 404 });
  return NextResponse.json({ purchase });
}

// Modification avant toute réception ; le total est recalculé en base, jamais envoyé par le client.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireBusinessManagementApi();
  if (!gate.ok) return gate.response;
  const parsed = updatePurchaseSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const { items, ...data } = parsed.data;
  const result = await callGestionRpc<{ out_purchase_id: string; out_total: number }>('save_supplier_purchase', {
    p_tenant_id: gate.tenant.id, p_purchase_id: params.id, p_data: data, p_items: items ?? null,
    p_request_key: null, p_actor: gate.actorId,
  });
  if (!result.ok) return result.response;
  revalidateGestion();
  return NextResponse.json({ id: result.row.out_purchase_id, total: Number(result.row.out_total) });
}
