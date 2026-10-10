import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { parseCardPaymentsState } from '@/lib/card/cardPaymentsAdmin';
import { loadCardPaymentsList } from '@/lib/card/cardPaymentsList';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

// Admin → Paiements carte (orders.view, see adminApiPermissions). Read only.
// The admin page renders the same list on the server (loadCardPaymentsList).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const authError = await requireAdmin(tenant.id);
  if (authError) return authError;

  const state = parseCardPaymentsState(req.nextUrl.searchParams);
  try {
    const list = await loadCardPaymentsList(createServiceClient(), tenant, state);
    return NextResponse.json({ period: state.period, from: state.from || null, to: state.to || null, status: state.status, ...list });
  } catch (error) {
    console.error('[admin/card-payments] query failed:', error);
    return NextResponse.json({ error: 'Impossible de charger les paiements.' }, { status: 500 });
  }
}
