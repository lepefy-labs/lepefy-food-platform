import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import type { SocialPlatform } from '@lepefy/types';
import { withStorefrontInvalidation } from '@/lib/cache/withStorefrontInvalidation';
import { parseSocialUpdate } from '@/lib/social/socialLinkWrite';

export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

async function handlePATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });

  const supabase = createServiceClient();
  const { data: current } = await supabase
    .from('tenant_social_links')
    .select('platform')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (!current) return NextResponse.json({ error: 'Réseau social introuvable.' }, { status: 404 });

  const parsed = parseSocialUpdate(body, current as { platform: SocialPlatform });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  if (Object.keys(parsed.values).length === 0) return NextResponse.json({ success: true });

  const { error } = await supabase
    .from('tenant_social_links')
    .update(parsed.values)
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) {
    console.error('[social-links][PATCH] error:', error);
    return NextResponse.json({ error: 'La modification n’a pas pu être enregistrée.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

async function handleDELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { error } = await supabase
    .from('tenant_social_links')
    .delete()
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) {
    console.error('[social-links][DELETE] error:', error);
    return NextResponse.json({ error: 'Le réseau social n’a pas pu être supprimé.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export const PATCH = withStorefrontInvalidation(['shop-shell'], handlePATCH);
export const DELETE = withStorefrontInvalidation(['shop-shell'], handleDELETE);
