import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessManagementApi } from '@/lib/gestion/featureGate';
import { callGestionRpc, revalidateGestion } from '@/lib/gestion/rpc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Capability critique supplier_payments.verify (mappe centrale) : seul un paiement vérifié réduit la dette.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireBusinessManagementApi();
  if (!gate.ok) return gate.response;
  const result = await callGestionRpc<{ out_status: string; out_changed: boolean }>('verify_supplier_payment', {
    p_tenant_id: gate.tenant.id, p_payment_id: params.id, p_actor: gate.actorId,
  });
  if (!result.ok) return result.response;
  revalidateGestion();
  return NextResponse.json({ status: result.row.out_status, changed: result.row.out_changed });
}
