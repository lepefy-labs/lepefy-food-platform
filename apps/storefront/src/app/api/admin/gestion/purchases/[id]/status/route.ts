import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessManagementApi } from '@/lib/gestion/featureGate';
import { badRequest, callGestionRpc, revalidateGestion } from '@/lib/gestion/rpc';
import { firstIssue, purchaseStatusSchema } from '@/lib/gestion/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireBusinessManagementApi();
  if (!gate.ok) return gate.response;
  const parsed = purchaseStatusSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  if (parsed.data.status === 'cancelled' && !parsed.data.reason) return badRequest('Un motif est obligatoire pour annuler.');
  const result = await callGestionRpc<{ out_status: string; out_changed: boolean }>('set_supplier_purchase_status', {
    p_tenant_id: gate.tenant.id, p_purchase_id: params.id, p_status: parsed.data.status,
    p_reason: parsed.data.reason, p_actor: gate.actorId,
  });
  if (!result.ok) return result.response;
  revalidateGestion();
  return NextResponse.json({ status: result.row.out_status, changed: result.row.out_changed });
}
