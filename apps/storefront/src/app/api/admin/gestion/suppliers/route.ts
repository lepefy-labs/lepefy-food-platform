import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessManagementApi } from '@/lib/gestion/featureGate';
import { listSuppliers } from '@/lib/gestion/queries';
import { badRequest, callGestionRpc, revalidateGestion } from '@/lib/gestion/rpc';
import { createSupplierSchema, firstIssue } from '@/lib/gestion/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(req: NextRequest) {
  const gate = await requireBusinessManagementApi();
  if (!gate.ok) return gate.response;
  const status = req.nextUrl.searchParams.get('status');
  const suppliers = await listSuppliers(gate.tenant.id, {
    q: req.nextUrl.searchParams.get('q') ?? undefined,
    status: status === 'inactive' || status === 'all' ? status : 'active',
  });
  return NextResponse.json({ suppliers });
}

export async function POST(req: NextRequest) {
  const gate = await requireBusinessManagementApi();
  if (!gate.ok) return gate.response;
  const parsed = createSupplierSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const { requestKey, ...data } = parsed.data;
  const result = await callGestionRpc<{ out_supplier_id: string; out_code: string; out_created: boolean }>('create_supplier', {
    p_tenant_id: gate.tenant.id, p_data: data, p_request_key: requestKey, p_actor: gate.actorId,
  });
  if (!result.ok) return result.response;
  revalidateGestion();
  return NextResponse.json(
    { id: result.row.out_supplier_id, code: result.row.out_code, created: result.row.out_created },
    { status: result.row.out_created ? 201 : 200 },
  );
}
