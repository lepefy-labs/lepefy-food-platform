import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessManagementApi } from '@/lib/gestion/featureGate';
import { badRequest, callGestionRpc, revalidateGestion } from '@/lib/gestion/rpc';
import { allocateSchema, firstIssue } from '@/lib/gestion/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireBusinessManagementApi();
  if (!gate.ok) return gate.response;
  const parsed = allocateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const result = await callGestionRpc<{ out_allocation_id: string; out_created: boolean }>('allocate_supplier_payment', {
    p_tenant_id: gate.tenant.id, p_payment_id: params.id, p_purchase_id: parsed.data.purchase_id,
    p_amount: parsed.data.amount, p_request_key: parsed.data.requestKey, p_actor: gate.actorId,
  });
  if (!result.ok) return result.response;
  revalidateGestion();
  return NextResponse.json(
    { id: result.row.out_allocation_id, created: result.row.out_created },
    { status: result.row.out_created ? 201 : 200 },
  );
}
