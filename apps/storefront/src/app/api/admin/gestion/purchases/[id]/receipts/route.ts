import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessManagementApi } from '@/lib/gestion/featureGate';
import { badRequest, callGestionRpc, revalidateGestion } from '@/lib/gestion/rpc';
import { firstIssue, receiptSchema } from '@/lib/gestion/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Réception + mouvements de stock + incrément de products.stock : une seule transaction (RPC), idempotente.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireBusinessManagementApi();
  if (!gate.ok) return gate.response;
  const parsed = receiptSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const result = await callGestionRpc<{ out_receipt_id: string; out_reference: string; out_created: boolean; out_purchase_status: string }>(
    'record_supplier_receipt',
    {
      p_tenant_id: gate.tenant.id, p_purchase_id: params.id, p_items: parsed.data.items,
      p_received_at: parsed.data.received_at ?? null, p_notes: parsed.data.notes,
      p_request_key: parsed.data.requestKey, p_actor: gate.actorId,
    },
  );
  if (!result.ok) return result.response;
  revalidateGestion();
  return NextResponse.json({
    id: result.row.out_receipt_id, reference: result.row.out_reference,
    created: result.row.out_created, purchaseStatus: result.row.out_purchase_status,
  }, { status: result.row.out_created ? 201 : 200 });
}
