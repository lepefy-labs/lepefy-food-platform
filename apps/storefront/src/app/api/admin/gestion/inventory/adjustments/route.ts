import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessManagementApi } from '@/lib/gestion/featureGate';
import { badRequest, callGestionRpc, revalidateGestion } from '@/lib/gestion/rpc';
import { adjustmentSchema, firstIssue } from '@/lib/gestion/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Rectification de stock motivée : products.stock + mouvement + audit dans la même transaction (RPC).
// Ne crée jamais de coût d'achat.
export async function POST(req: NextRequest) {
  const gate = await requireBusinessManagementApi();
  if (!gate.ok) return gate.response;
  const parsed = adjustmentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const result = await callGestionRpc<{ out_movement_id: string; out_created: boolean; out_stock_after: number }>('adjust_inventory', {
    p_tenant_id: gate.tenant.id, p_product_id: parsed.data.product_id, p_delta: parsed.data.delta,
    p_reason: parsed.data.reason, p_note: parsed.data.note, p_request_key: parsed.data.requestKey, p_actor: gate.actorId,
  });
  if (!result.ok) return result.response;
  revalidateGestion();
  return NextResponse.json({ id: result.row.out_movement_id, created: result.row.out_created, stockAfter: result.row.out_stock_after });
}
