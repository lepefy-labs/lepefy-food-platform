import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';

// "Promouvoir ambassadeur" — no self-upgrade possible, admin-only action.
// Le lien /invite/[code] fonctionne immédiatement (aucune dépendance à
// ambassador_profile_completed_at) : seule la visibilité "payable" côté
// admin dépend du profil complet.
export async function POST(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as { customerId?: string };
  if (!body.customerId) {
    return NextResponse.json({ error: 'customerId requis.' }, { status: 400 });
  }

  const adminId = await getAdminId();
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('customers')
    .update({
      is_ambassador: true,
      promoted_to_ambassador_at: new Date().toISOString(),
      promoted_to_ambassador_by: adminId,
    })
    .eq('id', body.customerId)
    .eq('tenant_id', tenant.id)
    .select('id, is_ambassador')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
