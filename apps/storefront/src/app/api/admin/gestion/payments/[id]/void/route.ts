import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessManagementApi } from '@/lib/gestion/featureGate';
import { badRequest, callGestionRpc, revalidateGestion } from '@/lib/gestion/rpc';
import { firstIssue, reasonSchema } from '@/lib/gestion/schemas';
import { createServiceClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/adminRbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireBusinessManagementApi();
  if (!gate.ok) return gate.response;
  const parsed = reasonSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));

  // Annuler un paiement déjà vérifié est une correction forte : capability critique en plus de treasury.manage.
  const { data: payment } = await createServiceClient().from('supplier_payments').select('status')
    .eq('tenant_id', gate.tenant.id).eq('id', params.id).maybeSingle();
  if (!payment) return NextResponse.json({ error: 'Paiement introuvable.' }, { status: 404 });
  if (payment.status === 'verified') {
    const denied = await requirePermission(gate.tenant.id, 'supplier_payments.verify');
    if (denied) return denied;
  }

  const result = await callGestionRpc<{ out_status: string; out_changed: boolean; out_reversed_allocations: number }>(
    'void_supplier_payment',
    { p_tenant_id: gate.tenant.id, p_payment_id: params.id, p_reason: parsed.data.reason, p_actor: gate.actorId },
  );
  if (!result.ok) return result.response;
  revalidateGestion();
  return NextResponse.json({
    status: result.row.out_status, changed: result.row.out_changed, reversedAllocations: result.row.out_reversed_allocations,
  });
}
