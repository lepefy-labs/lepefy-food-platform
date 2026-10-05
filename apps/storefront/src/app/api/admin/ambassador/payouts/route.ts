import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';
import { payoutRequestSchema } from '@/lib/ambassador/ambassadorAdmin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// « Verser » — records a manual transfer made outside the platform for the
// commissions the admin saw in the modal. One update filtered on tenant,
// ambassador and status CONFIRMED: a commission already paid (or cancelled)
// by someone else in the meantime is skipped, never paid twice.
export async function POST(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const parsed = payoutRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Demande de versement invalide.' }, { status: 400 });
  }
  const { ambassadorId, commissionIds, paymentNote } = parsed.data;
  const db = createServiceClient();

  const { data: ambassador, error: ambassadorError } = await db
    .from('customers')
    .select('id, ambassador_profile_completed_at')
    .eq('id', ambassadorId)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (ambassadorError) {
    return NextResponse.json({ error: 'Versement impossible pour le moment.' }, { status: 500 });
  }
  if (!ambassador) {
    return NextResponse.json({ error: 'Ambassadeur introuvable.' }, { status: 404 });
  }
  if (!ambassador.ambassador_profile_completed_at) {
    return NextResponse.json({
      error: 'Profil incomplet : l’ambassadeur doit renseigner son nom et un moyen de paiement avant tout versement.',
      code: 'PROFILE_INCOMPLETE',
    }, { status: 409 });
  }

  const { data: paid, error } = await db
    .from('ambassador_commissions')
    .update({
      status: 'PAID',
      paid_at: new Date().toISOString(),
      paid_by_admin_id: await getAdminId(),
      payment_note: paymentNote || null,
    })
    .eq('tenant_id', tenant.id)
    .eq('ambassador_customer_id', ambassadorId)
    .eq('status', 'CONFIRMED')
    .in('id', commissionIds)
    .select('id, commission_amount');

  if (error) {
    console.error('[ambassador payout] update failed', tenant.id, error);
    return NextResponse.json({ error: 'Versement impossible pour le moment.' }, { status: 500 });
  }

  const rows = paid ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Ces commissions ont déjà été versées ou annulées.', code: 'NOTHING_TO_PAY' }, { status: 409 });
  }
  const paidTotal = Math.round(rows.reduce((sum, row) => sum + Number(row.commission_amount), 0) * 100) / 100;
  return NextResponse.json({
    paidIds: rows.map((row) => row.id as string),
    paidCount: rows.length,
    paidTotal,
    skippedCount: commissionIds.length - rows.length,
  });
}
