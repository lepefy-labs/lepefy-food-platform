import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';

// "Nommer ambassadeur" — no self-upgrade possible, admin-only action.
// Le lien /invite/[code] fonctionne immédiatement (aucune dépendance à
// ambassador_profile_completed_at) : seul le versement dépend du profil complet.
// Idempotent : un client déjà ambassadeur garde sa date de nomination.
export async function POST(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => null) as { customerId?: string } | null;
  if (!body?.customerId) {
    return NextResponse.json({ error: 'customerId requis.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: customer, error: readError } = await supabase
    .from('customers')
    .select('id, is_ambassador')
    .eq('id', body.customerId)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: 'Nomination impossible pour le moment.' }, { status: 500 });
  if (!customer) return NextResponse.json({ error: 'Client introuvable.' }, { status: 404 });
  if (customer.is_ambassador) return NextResponse.json(customer);

  const { data, error } = await supabase
    .from('customers')
    .update({
      is_ambassador: true,
      promoted_to_ambassador_at: new Date().toISOString(),
      promoted_to_ambassador_by: await getAdminId(),
    })
    .eq('id', body.customerId)
    .eq('tenant_id', tenant.id)
    .select('id, is_ambassador')
    .single();

  if (error) {
    console.error('[ambassador promote] update failed', tenant.id, error);
    return NextResponse.json({ error: 'Nomination impossible pour le moment.' }, { status: 500 });
  }

  return NextResponse.json(data);
}
