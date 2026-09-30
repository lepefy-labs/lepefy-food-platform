import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessManagementApi } from '@/lib/gestion/featureGate';
import { badRequest, callGestionRpc, revalidateGestion } from '@/lib/gestion/rpc';
import { firstIssue, reasonSchema } from '@/lib/gestion/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireBusinessManagementApi();
  if (!gate.ok) return gate.response;
  const parsed = reasonSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const result = await callGestionRpc<{ out_reversed: boolean; out_purchase_status: string }>('reverse_supplier_receipt', {
    p_tenant_id: gate.tenant.id, p_receipt_id: params.id, p_reason: parsed.data.reason, p_actor: gate.actorId,
  });
  if (!result.ok) return result.response;
  revalidateGestion();
  return NextResponse.json({ reversed: result.row.out_reversed, purchaseStatus: result.row.out_purchase_status });
}
