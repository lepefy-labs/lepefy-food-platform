import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import type { CartItem, Product } from '@lepefy/types';

// Carrello serveur pour clients authentifiés (continuité cross-device) —
// checkout_sessions/carts a le même principe que /api/checkout : on ne
// persiste jamais prix/nom, seulement {product_id, quantity}, rihydraté
// depuis products à chaque lecture (stock/prix toujours à jour, jamais fiés
// au client). Table mutable par client — force-dynamic seul ne suffit pas
// (bug Next.js 14.2.x, cf. règle permanente).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface CartRow {
  items: Array<{ product_id: string; quantity: number }>;
}

export async function GET() {
  try {
    const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant      = await getTenant(tenantSlug);
    const customer    = await getSessionCustomer(tenant.id);

    if (!customer) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
    }

    const supabase = createServiceClient();

    const { data: cart } = await supabase
      .from('carts')
      .select('items')
      .eq('tenant_id', tenant.id)
      .eq('customer_id', customer.id)
      .maybeSingle() as { data: CartRow | null };

    const rawItems = cart?.items ?? [];
    if (rawItems.length === 0) {
      return NextResponse.json({ items: [] });
    }

    const productIds = [...new Set(rawItems.map((i) => i.product_id))];
    const { data: dbProducts, error: productsError } = await supabase
      .from('products')
      .select('id, name, slug, price, storage_type, stock, image_url, weight_grams, active')
      .eq('tenant_id', tenant.id)
      .in('id', productIds) as {
        data: Array<Pick<Product, 'id' | 'name' | 'slug' | 'price' | 'storage_type' | 'stock' | 'image_url' | 'weight_grams' | 'active'>> | null;
        error: unknown;
      };

    if (productsError || !dbProducts) {
      console.error('[api/customers/me/cart][GET] products lookup error:', productsError);
      return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
    }

    const productById = new Map(dbProducts.map((p) => [p.id, p]));

    // Produit inactif/supprimé depuis l'ajout au panier → silencieusement
    // écarté (même principe que /api/checkout : jamais une erreur bloquante,
    // le panier se contente de refléter ce qui est réellement achetable).
    const items: CartItem[] = [];
    for (const row of rawItems) {
      const p = productById.get(row.product_id);
      if (!p || !p.active) continue;
      items.push({
        product: {
          id:           p.id,
          name:         p.name,
          slug:         p.slug,
          price:        p.price,
          image_url:    p.image_url,
          weight_grams: p.weight_grams,
          stock:        p.stock,
          storage_type: p.storage_type,
        },
        quantity: Math.min(row.quantity, p.stock),
      });
    }

    return NextResponse.json({ items });
  } catch (err) {
    console.error('[api/customers/me/cart][GET] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
  }
}

interface PutBody {
  items?: Array<{ productId: string; quantity: number }>;
}

export async function PUT(req: NextRequest) {
  try {
    const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant      = await getTenant(tenantSlug);
    const customer    = await getSessionCustomer(tenant.id);

    if (!customer) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
    }

    const body: PutBody = await req.json();
    const rawItems = body.items ?? [];

    // Validation minimale — les lignes invalides sont écartées en silence,
    // pas de raison de faire échouer toute la requête pour une erreur
    // ponctuelle côté client (état local incohérent, race condition, etc.).
    const items = rawItems
      .filter((i) => typeof i.productId === 'string' && i.productId.length > 0
        && Number.isInteger(i.quantity) && i.quantity > 0)
      .map((i) => ({ product_id: i.productId, quantity: i.quantity }));

    const supabase = createServiceClient();

    const { error } = await supabase
      .from('carts')
      .upsert(
        {
          tenant_id:   tenant.id,
          customer_id: customer.id,
          items,
          updated_at:  new Date().toISOString(),
        },
        { onConflict: 'tenant_id,customer_id' },
      );

    if (error) {
      console.error('[api/customers/me/cart][PUT] upsert error:', error);
      return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/customers/me/cart][PUT] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
  }
}
