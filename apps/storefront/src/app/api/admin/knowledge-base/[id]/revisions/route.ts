import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(params.id).success) return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  const db = createServiceClient();
  const { data: entry } = await db.from('tenant_knowledge_base').select('id').eq('id', params.id).eq('tenant_id', tenant.id).maybeSingle();
  if (!entry) return NextResponse.json({ error: 'Connaissance introuvable.' }, { status: 404 });
  const { data, error } = await db.from('tenant_knowledge_revisions')
    .select('revision, action, title, category, content, source, active, library_key, library_version, actor, recorded_at')
    .eq('tenant_id', tenant.id).eq('knowledge_id', params.id)
    .order('revision', { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: 'Historique indisponible.' }, { status: 500 });
  return NextResponse.json({ revisions: data ?? [] });
}
