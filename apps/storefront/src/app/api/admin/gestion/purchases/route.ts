import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessManagementApi } from '@/lib/gestion/featureGate';
import { listPurchases, type PurchaseFilters } from '@/lib/gestion/queries';
import { badRequest, callGestionRpc, revalidateGestion } from '@/lib/gestion/rpc';
import { createPurchaseSchema, firstIssue } from '@/lib/gestion/schemas';
import { PURCHASE_STATUSES } from '@/lib/gestion/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const LIST_STATUSES: readonly string[] = [...PURCHASE_STATUSES, 'open', 'to_receive', 'unpaid'];

export async function GET(req: NextRequest) {
  const gate = await requireBusinessManagementApi();
  if (!gate.ok) return gate.response;
  const search = req.nextUrl.searchParams;
  const status = search.get('status') ?? '';
  const purchases = await listPurchases(gate.tenant.id, {
    supplierId: search.get('supplier') ?? undefined,
    q: search.get('q') ?? undefined,
    status: LIST_STATUSES.includes(status) ? status as PurchaseFilters['status'] : undefined,
  });
  return NextResponse.json({ purchases });
}

export async function POST(req: NextRequest) {
  const gate = await requireBusinessManagementApi();
  if (!gate.ok) return gate.response;
  const parsed = createPurchaseSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const { requestKey, items, ...data } = parsed.data;
  const result = await callGestionRpc<{ out_purchase_id: string; out_reference: string; out_created: boolean; out_total: number }>(
    'save_supplier_purchase',
    {
      p_tenant_id: gate.tenant.id, p_purchase_id: null, p_data: data, p_items: items,
      p_request_key: requestKey, p_actor: gate.actorId,
    },
  );
  if (!result.ok) return result.response;
  revalidateGestion();
  return NextResponse.json(
    { id: result.row.out_purchase_id, reference: result.row.out_reference, created: result.row.out_created },
    { status: result.row.out_created ? 201 : 200 },
  );
}
