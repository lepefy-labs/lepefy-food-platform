import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessManagementApi } from '@/lib/gestion/featureGate';
import { getSupplier } from '@/lib/gestion/queries';
import { badRequest, callGestionRpc, revalidateGestion } from '@/lib/gestion/rpc';
import { firstIssue, updateSupplierSchema } from '@/lib/gestion/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireBusinessManagementApi();
  if (!gate.ok) return gate.response;
  const supplier = await getSupplier(gate.tenant.id, params.id).catch(() => null);
  if (!supplier) return NextResponse.json({ error: 'Fournisseur introuvable.' }, { status: 404 });
  return NextResponse.json({ supplier });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireBusinessManagementApi();
  if (!gate.ok) return gate.response;
  const parsed = updateSupplierSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const result = await callGestionRpc<{ out_supplier_id: string; out_updated: boolean }>('update_supplier', {
    p_tenant_id: gate.tenant.id, p_supplier_id: params.id, p_data: parsed.data, p_actor: gate.actorId,
  });
  if (!result.ok) return result.response;
  revalidateGestion();
  return NextResponse.json({ id: result.row.out_supplier_id, updated: result.row.out_updated });
}
