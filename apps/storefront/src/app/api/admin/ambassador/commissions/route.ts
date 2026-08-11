import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import type { AmbassadorCommissionStatus } from '@lepefy/types';

// Route admin — dati mutabili, mai cacheable (bug noto Next.js 14.2.x sulla
// Data Cache non disattivata da force-dynamic da solo, confermato in
// produzione su evenementiel/scan/[token]/route.ts, 11/08).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const VALID_STATUSES: AmbassadorCommissionStatus[] = ['CONFIRMED', 'PAID', 'CANCELLED'];

// Liste filtrable par statut — utilisée par CommissionsSection pour le
// re-fetch côté client au changement de filtre (le premier rendu, non
// filtré, vient directement de page.tsx en server component).
export async function GET(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const statusParam = req.nextUrl.searchParams.get('status');
  const supabase = createServiceClient();

  let query = supabase
    .from('ambassador_commissions')
    .select('*, ambassador:ambassador_customer_id(email, full_name, ambassador_first_name, ambassador_last_name), referred:referred_customer_id(email, full_name)')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(200);

  if (statusParam && VALID_STATUSES.includes(statusParam as AmbassadorCommissionStatus)) {
    query = query.eq('status', statusParam);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ commissions: data ?? [] });
}
