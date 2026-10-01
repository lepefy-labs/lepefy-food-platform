import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessManagementApi } from '@/lib/gestion/featureGate';
import { badRequest, callGestionRpc, revalidateGestion } from '@/lib/gestion/rpc';
import { dueDateSchema, firstIssue } from '@/lib/gestion/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Échéance de paiement (financière) : modifiable même après réception, jamais sur un achat annulé.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireBusinessManagementApi();
  if (!gate.ok) return gate.response;
  const parsed = dueDateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const result = await callGestionRpc<{ out_payment_due_date: string | null; out_changed: boolean }>('set_supplier_purchase_due_date', {
    p_tenant_id: gate.tenant.id, p_purchase_id: params.id, p_due_date: parsed.data.payment_due_date, p_actor: gate.actorId,
  });
  if (!result.ok) return result.response;
  revalidateGestion();
  return NextResponse.json({ paymentDueDate: result.row.out_payment_due_date, changed: result.row.out_changed });
}
