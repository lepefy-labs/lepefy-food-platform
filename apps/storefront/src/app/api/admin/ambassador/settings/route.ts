import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { withStorefrontInvalidation } from '@/lib/cache/withStorefrontInvalidation';
import {
  ambassadorSettingsIssues,
  ambassadorSettingsSchema,
  normalizeAmbassadorSettings,
} from '@/lib/ambassador/ambassadorAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SETTINGS_COLUMNS = [
  'ambassador_min_purchase_amount',
  'ambassador_min_commission_amount',
  'ambassador_max_commission_amount',
  'ambassador_loyalty_from_second_order',
  'ambassador_first_order_discount_type',
  'ambassador_first_order_discount_value',
  'ambassador_payout_threshold_amount',
  'ambassador_commission_mode',
  'ambassador_split_pool_amount',
  'ambassador_split_pool_ambassador_percent',
].join(', ');

// The whole program is saved at once and checked against the same invariants
// the form shows (lib/ambassador/ambassadorAdmin.ts): a configuration that
// would break commission creation at delivery is never written.
async function handlePATCH(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const parsed = ambassadorSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Paramètres invalides : les montants doivent être des nombres positifs.' }, { status: 400 });
  }
  const settings = normalizeAmbassadorSettings(parsed.data);
  const issues = ambassadorSettingsIssues(settings);
  if (issues.length > 0) {
    return NextResponse.json({ error: issues[0], issues }, { status: 400 });
  }

  const { data, error } = await createServiceClient()
    .from('tenants')
    .update(settings)
    .eq('id', tenant.id)
    .select(SETTINGS_COLUMNS)
    .single();

  if (error || !data) {
    console.error('[ambassador settings] update failed', tenant.id, error);
    return NextResponse.json({ error: 'Enregistrement du programme ambassadeur impossible.' }, { status: 500 });
  }
  return NextResponse.json(data);
}

export const PATCH = withStorefrontInvalidation(['tenant'], handlePATCH);
