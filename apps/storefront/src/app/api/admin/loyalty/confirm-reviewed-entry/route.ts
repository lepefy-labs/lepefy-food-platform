import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

// Unica eccezione esplicita al principio "append-only" del ledger — la spec
// descrive letteralmente una transizione di stato PENDING→CONFIRMED sulla
// stessa riga, non l'inserimento di una nuova riga.
export async function POST(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as { ledgerEntryId?: string };
  if (!body.ledgerEntryId) {
    return NextResponse.json({ error: 'ledgerEntryId requis.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('points_ledger')
    .update({ status: 'CONFIRMED', requires_manual_review: false })
    .eq('id', body.ledgerEntryId)
    .eq('tenant_id', tenant.id)
    .eq('status', 'PENDING')
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Ligne introuvable ou déjà traitée.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
