import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { isUuid, NALA_ATTRIBUTION_MODEL } from '@/lib/ai/nalaAttributionCore';
import { resolveNalaAttributions } from '@/lib/ai/nalaConversionAttribution';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (
    body?.eventType !== 'add_to_cart'
    || !isUuid(body?.productId)
    || !isUuid(body?.interactionId)
    || !isUuid(body?.clientSessionId)
    || !isUuid(body?.idempotencyKey)
    || !Number.isInteger(body?.quantity)
    || body.quantity < 1
    || body.quantity > 999
  ) {
    return new NextResponse(null, { status: 204 });
  }

  try {
    const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
    const supabase = createServiceClient();
    const [attribution] = await resolveNalaAttributions({
      supabase,
      tenantId: tenant.id,
      candidates: [{
        productId: body.productId,
        interactionId: body.interactionId,
        clientSessionId: body.clientSessionId,
      }],
      cartProductIds: [body.productId],
    });
    if (!attribution) return new NextResponse(null, { status: 204 });

    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, price')
      .eq('id', body.productId)
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .maybeSingle();
    if (productError || !product) return new NextResponse(null, { status: 204 });

    const { error } = await supabase.from('nala_conversion_events').upsert({
      tenant_id: tenant.id,
      nala_session_id: attribution.sessionId,
      nala_interaction_id: attribution.interactionId,
      event_type: 'add_to_cart',
      product_id: product.id,
      quantity: body.quantity,
      unit_price: product.price,
      currency: (tenant.currency ?? 'EUR').toUpperCase(),
      attribution_model: NALA_ATTRIBUTION_MODEL,
      idempotency_key: body.idempotencyKey,
      occurred_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,idempotency_key' });

    if (error) console.error('[nala-attribution] Add-to-cart analytics write failed.', { tenantId: tenant.id, error });
  } catch (error) {
    console.error('[nala-attribution] Add-to-cart analytics failed; cart is unaffected.', { error });
  }

  return new NextResponse(null, { status: 204 });
}
