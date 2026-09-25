import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * Recherche client pour la saisie d'une commande assistée (nom, téléphone,
 * e-mail). Tenant-scoped, 8 résultats, champs de contact strictement utiles.
 */
export async function GET(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().replace(/[^a-zA-Z0-9À-ÿ@._+\- ]/g, '').slice(0, 60);
  if (q.length < 2) return NextResponse.json({ customers: [] });

  const digits = q.replace(/\D/g, '');
  const filters = [`full_name.ilike.%${q}%`, `email.ilike.%${q}%`, `phone.ilike.%${q}%`];
  if (digits.length >= 4) filters.push(`normalized_phone.ilike.%${digits}%`);

  const { data, error } = await createServiceClient()
    .from('customers')
    .select('id, full_name, email, phone')
    .eq('tenant_id', tenant.id)
    .or(filters.join(','))
    .order('full_name', { ascending: true, nullsFirst: false })
    .limit(8);

  if (error) {
    console.error('[admin/assisted-orders/customers] search failed:', error);
    return NextResponse.json({ error: 'Recherche indisponible.' }, { status: 500 });
  }
  return NextResponse.json({ customers: data ?? [] });
}
