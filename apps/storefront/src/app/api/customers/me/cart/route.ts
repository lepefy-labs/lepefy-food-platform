import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { parseSyncRequest, parseLegacyPutBody } from '@/lib/cart/cartRequest';
import type { CartItem, Product } from '@lepefy/types';

// Carrello serveur per clienti autenticati (continuità cross-device) —
// carts ha lo stesso principio di /api/checkout : non si persiste mai
// prezzo/nome, solo {product_id, quantity}, rihydratato dalla tabella products
// ad ogni lettura (stock/prezzo sempre aggiornati, mai fidati dal client).
// Tabella mutabile per cliente — force-dynamic da solo non basta
// (bug Next.js 14.2.x, cf. regola permanente).
//
// CONCORRENZA (migration 070) : ogni scrittura passa dalla funzione atomica
// apply_cart_mutations con optimistic concurrency control sulla colonna
// `version`. Il client invia expectedVersion + una lista di mutation
// semanticamente tipizzate (add relativo / set_quantity assoluto / remove /
// clear) invece dell'intero stato : due device che modificano il carrello
// contemporaneamente non si sovrascrivono più a vicenda.
//
// IDENTITÀ (§ tenant isolation) : tenant e customer sono SEMPRE derivati dalla
// sessione server (getTenant + getSessionCustomer). Nessun tenantId/customerId
// è mai letto dal corpo della richiesta, quindi un cliente non può leggere né
// modificare il carrello di un altro cliente o di un altro tenant.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface RawCartItem { product_id: string; quantity: number }

interface CartRow {
  items:   RawCartItem[];
  version: number;
}

interface ApplyMutationsResult {
  status:                  'ok' | 'conflict';
  version:                 number;
  items:                   RawCartItem[];
  applied_mutation_ids:    string[];
  unavailable_product_ids: string[];
}

type SupabaseServiceClient = ReturnType<typeof createServiceClient>;

function errorResponse(code: string, message: string, status: number) {
  // `error` resta una stringa come in tutte le altre route del repo
  // (retrocompatibilità con i consumer esistenti) ; `code` si aggiunge per
  // permettere al client un trattamento strutturato.
  return NextResponse.json({ error: message, code }, { status });
}

/**
 * Rihydrata [{product_id, quantity}] in CartItem[] leggendo i prodotti dal DB.
 * I prodotti inattivi/eliminati sono esclusi (stesso principio di
 * /api/checkout) e la quantità è normalizzata sullo stock reale.
 */
async function rehydrateItems(
  supabase: SupabaseServiceClient,
  tenantId: string,
  rawItems: RawCartItem[],
): Promise<{ items: CartItem[]; error: unknown }> {
  if (rawItems.length === 0) return { items: [], error: null };

  const productIds = [...new Set(rawItems.map((i) => i.product_id))];
  const { data: dbProducts, error: productsError } = await supabase
    .from('products')
    .select('id, name, slug, price, storage_type, stock, image_url, weight_grams, active')
    .eq('tenant_id', tenantId)
    .in('id', productIds) as {
      data: Array<Pick<Product, 'id' | 'name' | 'slug' | 'price' | 'storage_type' | 'stock' | 'image_url' | 'weight_grams' | 'active'>> | null;
      error: unknown;
    };

  if (productsError || !dbProducts) return { items: [], error: productsError ?? new Error('products lookup failed') };

  const productById = new Map(dbProducts.map((p) => [p.id, p]));
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

  return { items, error: null };
}

async function resolveIdentity() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const customer   = await getSessionCustomer(tenant.id);
  return { tenant, customer };
}

// ─── GET : stato canonical ─────────────────────────────────────────────────
// Risposta : { items: CartItem[], version: number }
// `items` conserva esattamente la forma precedente — l'aggiunta di `version`
// è retrocompatibile per qualunque consumer esistente.
export async function GET() {
  try {
    const { tenant, customer } = await resolveIdentity();
    if (!customer) {
      return errorResponse('CART_UNAUTHORIZED', 'Non authentifié.', 401);
    }

    const supabase = createServiceClient();

    const { data: cart } = await supabase
      .from('carts')
      .select('items, version')
      .eq('tenant_id', tenant.id)
      .eq('customer_id', customer.id)
      .maybeSingle() as { data: CartRow | null };

    const rawItems = cart?.items ?? [];
    const version  = cart?.version ?? 1;

    const { items, error } = await rehydrateItems(supabase, tenant.id, rawItems);
    if (error) {
      console.error('[api/customers/me/cart][GET] products lookup error:', error);
      return errorResponse('SERVER_ERROR', 'Erreur serveur. Veuillez réessayer.', 500);
    }

    return NextResponse.json({ items, version });
  } catch (err) {
    console.error('[api/customers/me/cart][GET] unhandled error:', err);
    return errorResponse('SERVER_ERROR', 'Erreur serveur. Veuillez réessayer.', 500);
  }
}

// ─── POST : applicazione di mutation con controllo di versione ─────────────
// Corpo    : { expectedVersion: number|null, mutations: [{id, type, productId?, quantity?}] }
// 200      : { items, version, appliedMutationIds, unavailableProductIds }
// 409      : { error, code: 'CART_CONFLICT', items, version }  ← stato canonical
//            incluso, così il client riconcilia senza una GET supplementare.
// 401/400  : { error, code }
export async function POST(req: NextRequest) {
  try {
    const { tenant, customer } = await resolveIdentity();
    if (!customer) {
      return errorResponse('CART_UNAUTHORIZED', 'Non authentifié.', 401);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse('INVALID_PAYLOAD', 'Requête invalide.', 400);
    }

    const parsed = parseSyncRequest(body);
    if (!parsed.ok) {
      return errorResponse(parsed.code, parsed.message, 400);
    }

    const supabase = createServiceClient();

    const { data, error } = await supabase.rpc('apply_cart_mutations', {
      p_tenant_id:        tenant.id,
      p_customer_id:      customer.id,
      p_expected_version: parsed.expectedVersion,
      p_mutations:        parsed.mutations,
    }) as { data: ApplyMutationsResult | null; error: unknown };

    if (error || !data) {
      console.error('[api/customers/me/cart][POST] apply_cart_mutations error:', error);
      return errorResponse('SERVER_ERROR', 'Erreur serveur. Veuillez réessayer.', 500);
    }

    const { items, error: rehydrateError } = await rehydrateItems(supabase, tenant.id, data.items ?? []);
    if (rehydrateError) {
      console.error('[api/customers/me/cart][POST] products lookup error:', rehydrateError);
      return errorResponse('SERVER_ERROR', 'Erreur serveur. Veuillez réessayer.', 500);
    }

    if (data.status === 'conflict') {
      return NextResponse.json(
        {
          error:   'Panier modifié depuis un autre appareil.',
          code:    'CART_CONFLICT',
          items,
          version: data.version,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      items,
      version:               data.version,
      appliedMutationIds:    data.applied_mutation_ids ?? [],
      unavailableProductIds: data.unavailable_product_ids ?? [],
    });
  } catch (err) {
    console.error('[api/customers/me/cart][POST] unhandled error:', err);
    return errorResponse('SERVER_ERROR', 'Erreur serveur. Veuillez réessayer.', 500);
  }
}

// ─── PUT : sostituzione full-state (LEGACY, deprecato) ─────────────────────
// Mantenuto per non rompere un eventuale consumer esistente. Passa comunque
// dalla funzione atomica (mutation 'replace'), quindi incrementa la versione e
// valida i prodotti come il POST. `expectedVersion` è opzionale : se omesso il
// comportamento resta quello di prima (sostituzione incondizionata) ; se
// fornito, il PUT beneficia dello stesso controllo di concorrenza del POST.
// Il client Lepefy non usa più questo verbo — cf. lib/cart/cartApi.ts.
export async function PUT(req: NextRequest) {
  try {
    const { tenant, customer } = await resolveIdentity();
    if (!customer) {
      return errorResponse('CART_UNAUTHORIZED', 'Non authentifié.', 401);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse('INVALID_PAYLOAD', 'Requête invalide.', 400);
    }

    const parsed = parseLegacyPutBody(body);
    if (!parsed.ok) {
      return errorResponse(parsed.code, parsed.message, 400);
    }

    const supabase = createServiceClient();

    const { data, error } = await supabase.rpc('apply_cart_mutations', {
      p_tenant_id:        tenant.id,
      p_customer_id:      customer.id,
      p_expected_version: parsed.expectedVersion,
      p_mutations:        [{
        id:    `legacy-put-${crypto.randomUUID()}`,
        type:  'replace',
        items: parsed.items,
      }],
    }) as { data: ApplyMutationsResult | null; error: unknown };

    if (error || !data) {
      console.error('[api/customers/me/cart][PUT] apply_cart_mutations error:', error);
      return errorResponse('SERVER_ERROR', 'Erreur serveur. Veuillez réessayer.', 500);
    }

    if (data.status === 'conflict') {
      return errorResponse('CART_CONFLICT', 'Panier modifié depuis un autre appareil.', 409);
    }

    return NextResponse.json({ ok: true, version: data.version });
  } catch (err) {
    console.error('[api/customers/me/cart][PUT] unhandled error:', err);
    return errorResponse('SERVER_ERROR', 'Erreur serveur. Veuillez réessayer.', 500);
  }
}
