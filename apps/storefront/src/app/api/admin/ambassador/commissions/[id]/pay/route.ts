import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';

// "Marquer comme payé" — action manuelle unique, aucun payout automatique.
// payment_note est libre (référence virement, etc.) — pas de validation de
// contenu, c'est une note interne à l'admin.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as { paymentNote?: string };
  const adminId = await getAdminId();
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('ambassador_commissions')
    .update({
      status: 'PAID',
      paid_at: new Date().toISOString(),
      paid_by_admin_id: adminId,
      payment_note: body.paymentNote?.trim() || null,
    })
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .eq('status', 'CONFIRMED')
    .select('id, status')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Commission introuvable ou déjà traitée.' }, { status: 400 });
  }

  return NextResponse.json(data);
}
