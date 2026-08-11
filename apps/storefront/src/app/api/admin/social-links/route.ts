import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import type { SocialPlatform } from '@lepefy/types';

// Route admin — dati mutabili, mai cacheable (bug noto Next.js 14.2.x sulla
// Data Cache non disattivata da force-dynamic da solo, confermato in
// produzione su evenementiel/scan/[token]/route.ts, 11/08).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export const runtime = 'nodejs';

const VALID_PLATFORMS: SocialPlatform[] = ['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'x'];

export async function GET() {
  const slug     = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant   = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('tenant_social_links')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('sort_order', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const slug     = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant   = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body     = await req.json();
  const supabase = createServiceClient();

  const platform = VALID_PLATFORMS.includes(body.platform) ? body.platform : 'instagram';

  // unique(tenant_id, platform) — un link par plateforme : upsert logique
  // pour ne jamais faire échouer la création sur un conflit d'unicité.
  const { data, error } = await supabase
    .from('tenant_social_links')
    .upsert(
      {
        tenant_id:  tenant.id,
        platform,
        url:        String(body.url ?? '').trim(),
        sort_order: parseInt(body.sort_order, 10) || 0,
        active:     Boolean(body.active),
      },
      { onConflict: 'tenant_id,platform' },
    )
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
