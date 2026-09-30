import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessManagementApi } from '@/lib/gestion/featureGate';
import { listPayments, listPurchases } from '@/lib/gestion/queries';
import { badRequest, callGestionRpc, revalidateGestion } from '@/lib/gestion/rpc';
import { createPaymentSchema, firstIssue } from '@/lib/gestion/schemas';
import { gestionRpcError } from '@/lib/gestion/errors';
import { createServiceClient } from '@/lib/supabase/server';
import {
  BENEFICIARY_TYPES, PAYMENT_METHODS, PAYMENT_STATUSES, validateAllocationPlan,
  type BeneficiaryType, type PaymentMethod, type PaymentStatus,
} from '@/lib/gestion/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

function pick<T extends string>(values: readonly T[], value: string | null): T | undefined {
  return (values as readonly string[]).includes(value ?? '') ? value as T : undefined;
}
const isoDate = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined);

export async function GET(req: NextRequest) {
  const gate = await requireBusinessManagementApi();
  if (!gate.ok) return gate.response;
  const search = req.nextUrl.searchParams;
  const payments = await listPayments(gate.tenant.id, {
    from: isoDate(search.get('from')),
    to: isoDate(search.get('to')),
    supplierId: search.get('supplier') ?? undefined,
    method: pick<PaymentMethod>(PAYMENT_METHODS, search.get('method')),
    status: pick<PaymentStatus>(PAYMENT_STATUSES, search.get('status')),
    beneficiaryType: pick<BeneficiaryType>(BENEFICIARY_TYPES, search.get('beneficiary')),
  });
  return NextResponse.json({ payments });
}

// Paiement + affectations dans une seule transaction (RPC), idempotent par requestKey.
export async function POST(req: NextRequest) {
  const gate = await requireBusinessManagementApi();
  if (!gate.ok) return gate.response;
  const parsed = createPaymentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const { requestKey, allocations, ...data } = parsed.data;

  if (allocations.length) {
    // Pré-contrôle pour un message clair ; la RPC revérifie tout sous verrou.
    const { data: supplier } = await createServiceClient().from('suppliers').select('id, currency')
      .eq('tenant_id', gate.tenant.id).eq('id', data.supplier_id).maybeSingle();
    if (!supplier) return NextResponse.json({ error: 'Fournisseur introuvable.' }, { status: 404 });
    const purchases = await listPurchases(gate.tenant.id, { supplierId: data.supplier_id });
    const issue = validateAllocationPlan(
      data.amount,
      { supplierId: data.supplier_id, currency: supplier.currency },
      allocations.map((allocation) => ({ purchaseId: allocation.purchase_id, amount: allocation.amount })),
      purchases.map((purchase) => ({
        id: purchase.id, allocatable: purchase.allocatable, currency: purchase.currency,
        supplierId: purchase.supplier_id, status: purchase.status,
      })),
    );
    if (issue) {
      const code = issue === 'duplicate_purchase' ? 'invalid_allocations' : issue === 'unknown_purchase' ? 'purchase_not_found' : issue;
      const info = gestionRpcError({ message: code });
      return NextResponse.json({ error: info.message, code: info.code }, { status: info.status });
    }
  }

  const result = await callGestionRpc<{ out_payment_id: string; out_reference: string; out_created: boolean }>('record_supplier_payment', {
    p_tenant_id: gate.tenant.id, p_data: data, p_allocations: allocations,
    p_request_key: requestKey, p_actor: gate.actorId,
  });
  if (!result.ok) return result.response;
  revalidateGestion();
  return NextResponse.json(
    { id: result.row.out_payment_id, reference: result.row.out_reference, created: result.row.out_created },
    { status: result.row.out_created ? 201 : 200 },
  );
}
