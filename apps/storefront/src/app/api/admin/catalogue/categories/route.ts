import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  const { data, error } = await createServiceClient().from('categories')
    .select('id, name, slug, catalog_scope').eq('tenant_id', tenant.id).order('position').order('name');
  if (error) return NextResponse.json({ error: 'Impossible de charger les catégories.' }, { status: 500 });
  return NextResponse.json({ categories: data ?? [] });
}

async function saveCategory(req: NextRequest, update: boolean) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Données invalides.' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  const scope = body.catalog_scope;
  if (!name || name.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120 || (scope !== 'shop' && scope !== 'gadgets') || (update && (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)))) {
    return NextResponse.json({ error: 'Vérifiez le nom, l’adresse et la destination de la catégorie.' }, { status: 400 });
  }
  const supabase = createServiceClient();
  const values = { name, slug, catalog_scope: scope };
  const query = update
    ? supabase.from('categories').update(values).eq('id', body.id).eq('tenant_id', tenant.id)
    : supabase.from('categories').insert({ ...values, tenant_id: tenant.id });
  const { data, error } = await query.select('id, name, slug, catalog_scope').maybeSingle();
  if (error) return NextResponse.json({ error: error.code === '23505' ? 'Cette adresse de catégorie existe déjà.' : 'Impossible d’enregistrer la catégorie.' }, { status: error.code === '23505' ? 409 : 500 });
  if (!data) return NextResponse.json({ error: 'Catégorie introuvable.' }, { status: 404 });
  revalidatePath('/');
  revalidatePath('/gadgets');
  revalidatePath('/products/[slug]', 'page');
  revalidatePath('/admin/catalogue', 'layout');
  return NextResponse.json({ category: data }, { status: update ? 200 : 201 });
}

export async function POST(req: NextRequest) { return saveCategory(req, false); }
export async function PATCH(req: NextRequest) { return saveCategory(req, true); }
