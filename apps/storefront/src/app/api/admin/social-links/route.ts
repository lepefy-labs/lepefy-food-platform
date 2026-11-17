import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import type { SocialPlatform } from '@lepefy/types';
import { withStorefrontInvalidation } from '@/lib/cache/withStorefrontInvalidation';
import { parseSocialCreate } from '@/lib/social/socialLinkWrite';

// Route admin — dati mutabili, mai cacheable (bug noto Next.js 14.2.x sulla
// Data Cache non disattivata da force-dynamic da solo, confermato in
// produzione su evenementiel/scan/[token]/route.ts, 11/08).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export const runtime = 'nodejs';

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
    console.error('[social-links][GET] error:', error);
    return NextResponse.json({ error: 'Les réseaux sociaux n’ont pas pu être lus.' }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

async function handlePOST(req: NextRequest) {
  const slug     = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant   = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });
  const supabase = createServiceClient();

  const { data: existing, error: readError } = await supabase
    .from('tenant_social_links')
    .select('platform')
    .eq('tenant_id', tenant.id);
  if (readError) {
    console.error('[social-links][POST] read error:', readError);
    return NextResponse.json({ error: 'Le réseau social n’a pas pu être ajouté.' }, { status: 500 });
  }

  // One link per platform (unique tenant_id, platform): an existing one is
  // edited, never silently overwritten by a creation.
  const parsed = parseSocialCreate(body, (existing ?? []).map((row) => row.platform as SocialPlatform));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  const { data, error } = await supabase
    .from('tenant_social_links')
    .insert({ tenant_id: tenant.id, ...parsed.values })
    .select('*')
    .single();

  if (error) {
    console.error('[social-links][POST] insert error:', error);
    return NextResponse.json({ error: 'Le réseau social n’a pas pu être ajouté.' }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

export const POST = withStorefrontInvalidation(['shop-shell'], handlePOST);
