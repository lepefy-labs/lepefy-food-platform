import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import type { SocialPlatform } from '@lepefy/types';

export const runtime = 'nodejs';

const VALID_PLATFORMS: SocialPlatform[] = ['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'x'];

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const body   = await req.json() as Record<string, unknown>;

  const supabase = createServiceClient();

  const updatePayload: Record<string, unknown> = {};

  if ('platform'   in body && VALID_PLATFORMS.includes(body.platform as SocialPlatform)) {
    updatePayload.platform = body.platform;
  }
  if ('url'        in body) updatePayload.url        = String(body.url ?? '').trim();
  if ('sort_order' in body) updatePayload.sort_order = parseInt(String(body.sort_order), 10) || 0;
  if ('active'     in body) updatePayload.active     = Boolean(body.active);

  const { error } = await supabase
    .from('tenant_social_links')
    .update(updatePayload)
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createServiceClient();

  const { error } = await supabase
    .from('tenant_social_links')
    .delete()
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
