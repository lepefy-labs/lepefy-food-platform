import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';

export async function POST(req: NextRequest) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  if (!tenant.ai_image_generation) {
    return NextResponse.json(
      { error: 'AI image generation not enabled for this tenant' },
      { status: 403 }
    );
  }

  const body = await req.json() as {
    productId?: string;
    productName?: string;
    categorySlug?: string;
    prompt?: string;
  };

  const { productId, productName, categorySlug, prompt } = body;

  if (!productName || !productId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // ── SIMULATION — replace with real AI call when provider is chosen ─────────
  await new Promise(r => setTimeout(r, 2000));

  const categoryKeywords: Record<string, string> = {
    'epices':          'spice,seasoning,african',
    'legumes':         'vegetable,african,fresh',
    'farines':         'flour,cassava,african',
    'poissons':        'fish,smoked,african',
    'sauces-huiles':   'palm,oil,sauce',
    'snacks':          'nuts,snack,african',
    'viandes-sechees': 'dried,meat,african',
    'boissons':        'drink,beverage,bottle',
  };

  const keyword = categoryKeywords[categorySlug ?? ''] ?? 'food,african';
  const simulatedUrl = `https://picsum.photos/seed/${productId}/800/800`;

  return NextResponse.json({
    imageUrl:  simulatedUrl,
    simulated: true,
    prompt,
  });
}
