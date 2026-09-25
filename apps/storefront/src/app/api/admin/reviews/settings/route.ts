import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getTenantFeatureSetting } from '@/lib/entitlements/tenantFeatureSettings';
import { withStorefrontInvalidation } from '@/lib/cache/withStorefrontInvalidation';

const schema = z.object({
  enabled: z.boolean(),
  publicDisplay: z.boolean(),
  minPublicCount: z.number().int().min(1).max(50),
  blacklistTerms: z.array(z.string().trim().min(1).max(80)).max(100),
});

async function handlePATCH(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Configuration invalide.' }, { status: 400 });
  const current = await getTenantFeatureSetting(tenant.id, 'reviews');
  const config = {
    ...(current?.config ?? {}),
    public_display: parsed.data.publicDisplay,
    min_public_count: parsed.data.minPublicCount,
    blacklist_terms: [...new Set(parsed.data.blacklistTerms.map((term) => term.toLowerCase()))],
    request_delay_hours: 24,
    reminder_after_days: 7,
    invite_expiry_days: 30,
    ai_moderation_enabled: false,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { error } = await db.from('tenant_feature_settings').upsert({
    tenant_id: tenant.id,
    feature_key: 'reviews',
    enabled: parsed.data.enabled,
    config,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id,feature_key' });
  if (error) return NextResponse.json({ error: 'Impossible d’enregistrer la configuration.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export const PATCH = withStorefrontInvalidation(['shop-shell'], handlePATCH);
