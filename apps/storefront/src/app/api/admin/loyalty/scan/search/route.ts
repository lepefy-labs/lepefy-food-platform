import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import {
  SCAN_SEARCH_LIMIT,
  SCAN_SEARCH_MIN_LENGTH,
  cardLastDigits,
  maskEmail,
  sanitizeScanSearch,
} from '@/lib/loyalty/loyaltyScan';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Forgotten card at the till: find a card holder by name or phone. Same roles
// as lookup/confirm (loyalty.scan, tenant_cashier included), so the payload is
// deliberately minimal — name, masked e-mail, card last digits, max 5 rows.
// The full record is only loaded by lookup?customerId= once one is picked.
export async function GET(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');

  const denied = await requireAdmin(tenant.id, ['tenant_admin', 'tenant_cashier']);
  if (denied) return denied;

  const q = sanitizeScanSearch(req.nextUrl.searchParams.get('q') ?? '');
  if (q.length < SCAN_SEARCH_MIN_LENGTH) return NextResponse.json({ customers: [] });

  const digits = q.replace(/\D/g, '');
  const filters = [`full_name.ilike.%${q}%`, `phone.ilike.%${q}%`];
  if (digits.length >= 4) filters.push(`normalized_phone.ilike.%${digits}%`);

  const { data, error } = await createServiceClient()
    .from('customers')
    .select('id, full_name, email, loyalty_card_number')
    .eq('tenant_id', tenant.id)
    .not('loyalty_card_number', 'is', null)
    .or(filters.join(','))
    .order('full_name', { ascending: true, nullsFirst: false })
    .limit(SCAN_SEARCH_LIMIT);

  if (error) {
    console.error('[loyalty/scan/search] search failed:', error);
    return NextResponse.json({ error: 'Recherche indisponible.' }, { status: 500 });
  }

  return NextResponse.json({
    customers: (data ?? []).map((customer) => ({
      id: customer.id,
      fullName: customer.full_name,
      maskedEmail: maskEmail(customer.email),
      cardLast4: cardLastDigits(customer.loyalty_card_number),
    })),
  });
}
