import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { withStorefrontInvalidation } from '@/lib/cache/withStorefrontInvalidation';
import { planReorder } from '@/lib/admin/listOrder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/** PUT { ids: string[] } — every social link of the tenant in display order. */
async function handlePUT(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => null) as { ids?: unknown } | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });

  const supabase = createServiceClient();
  const { data: rows, error: readError } = await supabase
    .from('tenant_social_links')
    .select('id, sort_order')
    .eq('tenant_id', tenant.id);
  if (readError) {
    console.error('[social-links][order] read error:', readError);
    return NextResponse.json({ error: 'Impossible de lire les réseaux sociaux.' }, { status: 500 });
  }

  const plan = planReorder(rows ?? [], body.ids);
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 409 });

  for (const update of plan.updates) {
    const { error } = await supabase
      .from('tenant_social_links')
      .update({ sort_order: update.sort_order })
      .eq('id', update.id)
      .eq('tenant_id', tenant.id);
    if (error) {
      console.error('[social-links][order] update error:', error);
      return NextResponse.json({ error: 'L’ordre n’a pas pu être enregistré entièrement. Rechargez la page.' }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true, updated: plan.updates.length });
}

export const PUT = withStorefrontInvalidation(['shop-shell'], handlePUT);
