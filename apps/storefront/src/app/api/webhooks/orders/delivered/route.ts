import { NextRequest, NextResponse } from 'next/server';
import { processOrderPointsOnDelivery } from '@/lib/loyalty/processOrderPointsOnDelivery';

// Endpoint interne, idempotent (processOrderPointsOnDelivery vérifie
// orders.points_processed). Le hook principal appelle la fonction
// directement en process depuis PATCH /api/admin/orders/[id] (voir rapport
// final pour le point exact) — cet endpoint existe pour tout déclencheur
// externe futur (ex. resynchronisation n8n) sans dupliquer la logique.
export async function POST(req: NextRequest) {
  const body = await req.json() as { orderId?: string };

  if (!body.orderId) {
    return NextResponse.json({ error: 'orderId requis.' }, { status: 400 });
  }

  try {
    await processOrderPointsOnDelivery(body.orderId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/webhooks/orders/delivered] unhandled error:', err, '— order_id:', body.orderId);
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });
  }
}
