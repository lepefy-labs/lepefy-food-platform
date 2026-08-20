import type { CartItem } from '@lepefy/types';

// Server di carrello in memoria che riproduce fedelmente la semantica della
// funzione SQL `apply_cart_mutations` (migration 070) :
//   - version incrementata ad ogni applicazione riuscita
//   - expectedVersion non coincidente → 409 con lo stato canonical
//   - `add` relativo, `set_quantity` assoluto, `remove`, `clear`
//   - idempotenza per mutation id
//   - validazione prodotto (esiste / attivo / tenant corretto) e clamp allo stock
//
// La funzione SQL vera è verificata a parte su un PostgreSQL reale
// (supabase/tests/070_cart_versioning.test.sql, eseguito con psql). Questo
// doppio serve a testare il CLIENT — queue, retry, riconciliazione, merge —
// senza dipendere da un database.

export interface FakeProduct {
  id:       string;
  name:     string;
  price:    number;
  stock:    number;
  active:   boolean;
  tenantId: string;
}

interface RawItem { product_id: string; quantity: number }

interface Mutation {
  id:         string;
  type:       'add' | 'set_quantity' | 'remove' | 'clear';
  productId?: string;
  quantity?:  number;
}

export interface RequestLogEntry {
  method:          string;
  expectedVersion: number | null;
  mutationIds:     string[];
  body?:           unknown;
}

export class FakeCartServer {
  version = 1;
  items: RawItem[] = [];
  applied = new Set<string>();
  readonly requests: RequestLogEntry[] = [];

  /** Numero di richieste che devono fallire prima di rispondere normalmente. */
  failNext = 0;
  /** Status HTTP usato dai fallimenti programmati (0 = errore di rete). */
  failStatus = 0;

  constructor(
    private readonly products: FakeProduct[],
    private readonly tenantId = 'tenant-1',
  ) {}

  private product(id: string): FakeProduct | undefined {
    return this.products.find((p) => p.id === id && p.active && p.tenantId === this.tenantId);
  }

  private rehydrate(): CartItem[] {
    const out: CartItem[] = [];
    for (const raw of this.items) {
      const p = this.product(raw.product_id);
      if (!p) continue;
      out.push({
        product: {
          id: p.id, name: p.name, slug: p.id, price: p.price,
          image_url: null, weight_grams: 400, stock: p.stock, storage_type: 'dry',
        },
        quantity: Math.min(raw.quantity, p.stock),
      });
    }
    return out;
  }

  apply(expectedVersion: number | null, mutations: Mutation[]) {
    if (expectedVersion !== null && expectedVersion !== this.version) {
      return { status: 'conflict' as const, version: this.version, items: this.rehydrate() };
    }

    const appliedIds: string[] = [];
    const unavailable: string[] = [];
    let changed = false;

    for (const m of mutations) {
      if (this.applied.has(m.id)) { appliedIds.push(m.id); continue; }

      if (m.type === 'clear') {
        this.items = [];
        changed = true;
      } else {
        const product = this.product(m.productId!);
        if (!product) {
          if (!unavailable.includes(m.productId!)) unavailable.push(m.productId!);
          appliedIds.push(m.id);
          this.applied.add(m.id);
          continue;
        }

        const index   = this.items.findIndex((i) => i.product_id === m.productId);
        const current = index >= 0 ? this.items[index]!.quantity : 0;

        let quantity: number;
        if (m.type === 'add')               quantity = current + (m.quantity ?? 0);
        else if (m.type === 'set_quantity') quantity = m.quantity ?? 0;
        else                                quantity = 0;

        quantity = Math.max(0, Math.min(quantity, product.stock));

        if (index >= 0) {
          if (quantity === 0) this.items.splice(index, 1);
          else this.items[index] = { product_id: m.productId!, quantity };
        } else if (quantity > 0) {
          this.items.push({ product_id: m.productId!, quantity });
        }
        changed = true;
      }

      appliedIds.push(m.id);
      this.applied.add(m.id);
    }

    if (changed) this.version += 1;

    return {
      status: 'ok' as const,
      version: this.version,
      items: this.rehydrate(),
      appliedMutationIds: appliedIds,
      unavailableProductIds: unavailable,
    };
  }

  /** Sostituto di globalThis.fetch da installare nei test. */
  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url    = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';

    if (!url.startsWith('/api/customers/me/cart')) {
      throw new Error(`FakeCartServer: URL inattendue ${url}`);
    }

    if (this.failNext > 0) {
      this.failNext -= 1;
      this.requests.push({ method, expectedVersion: null, mutationIds: [] });
      if (this.failStatus === 0) throw new TypeError('fetch failed');
      return jsonResponse({ error: 'boom', code: 'SERVER_ERROR' }, this.failStatus);
    }

    if (method === 'GET') {
      this.requests.push({ method, expectedVersion: null, mutationIds: [] });
      return jsonResponse({ items: this.rehydrate(), version: this.version }, 200);
    }

    const body = JSON.parse(String(init?.body ?? '{}')) as {
      expectedVersion: number | null; mutations: Mutation[];
    };
    this.requests.push({
      method,
      expectedVersion: body.expectedVersion,
      mutationIds:     body.mutations.map((m) => m.id),
      body,
    });

    const result = this.apply(body.expectedVersion, body.mutations);
    if (result.status === 'conflict') {
      return jsonResponse(
        { error: 'conflict', code: 'CART_CONFLICT', items: result.items, version: result.version },
        409,
      );
    }
    return jsonResponse(result, 200);
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

export function installFetch(server: FakeCartServer): void {
  Object.defineProperty(globalThis, 'fetch', {
    value: server.fetch, configurable: true, writable: true,
  });
}

/** Fetch che rifiuta sempre — simula l'assenza totale di rete. */
export function installFailingFetch(): void {
  Object.defineProperty(globalThis, 'fetch', {
    value: async () => { throw new TypeError('fetch failed'); },
    configurable: true, writable: true,
  });
}
