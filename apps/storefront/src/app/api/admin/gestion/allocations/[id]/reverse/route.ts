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
  const result = await callGestionRpc<{ out_changed: boolean }>('reverse_supplier_payment_allocation', {
    p_tenant_id: gate.tenant.id, p_allocation_id: params.id, p_reason: parsed.data.reason, p_actor: gate.actorId,
  });
  if (!result.ok) return result.response;
  revalidateGestion();
  return NextResponse.json({ changed: result.row.out_changed });
}
