import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { assignBarcodeToProduct } from '@/lib/barcode';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  // Segnala se esistono etichette già generate (immutabili) per questo prodotto:
  // cambiare il barcode dopo la stampa fisica disallinea merce/etichetta a scaffale.
  const { count } = await supabase
    .from('label_print_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .eq('product_id', params.id)
    .eq('status', 'generated');

  try {
    const code = await assignBarcodeToProduct(supabase, tenant.id, params.id);
    return NextResponse.json({
      barcode: code,
      hadPrintedLabels: (count ?? 0) > 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
