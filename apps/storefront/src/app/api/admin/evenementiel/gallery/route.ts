import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

// Route admin — dati mutabili, mai cacheable (bug noto Next.js 14.2.x sulla
// Data Cache non disattivata da force-dynamic da solo, confermato in
// produzione su evenementiel/scan/[token]/route.ts, 11/08).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('event_gallery_photos')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('sort_order', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as Record<string, unknown>;
  const imageUrl = String(body.image_url ?? '').trim();

  if (!imageUrl) {
    return NextResponse.json({ error: 'image_url requis.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: last } = await supabase
    .from('event_gallery_photos')
    .select('sort_order')
    .eq('tenant_id', tenant.id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSortOrder = (last?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from('event_gallery_photos')
    .insert({
      tenant_id:   tenant.id,
      event_id:    body.event_id ? String(body.event_id) : null,
      image_url:   imageUrl,
      caption:     body.caption ? String(body.caption).trim() : null,
      sort_order:  nextSortOrder,
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data, { status: 201 });
}
