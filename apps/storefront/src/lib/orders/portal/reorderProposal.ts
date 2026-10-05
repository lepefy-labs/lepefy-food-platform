import type { CartItem } from '@lepefy/types';
import { computeQuantityRuleState, getMaximumValidQuantity } from '@/lib/purchaseQuantityRules';

/**
 * « Commander à nouveau » depuis le portail : proposition calculée côté
 * serveur à partir des lignes d'origine et de l'état ACTUEL du catalogue
 * (produit du tenant, actif, prix, minimum/pas, stock). Le jeton du portail
 * n'autorise que cette lecture : l'ajout passe ensuite par le panier normal
 * (store local / sync authentifiée revalidée), et le checkout revalide tout,
 * y compris les règles de groupe combinables.
 */
export interface ReorderOriginalLine {
  product_id: string | null;
  name: string;
  quantity: number;
}

export interface ReorderCatalogProduct {
  id: string;
  name: string;
  slug: string;
  price: number;
  image_url: string | null;
  weight_grams: number | null;
  stock: number | null;
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
  min_order_quantity: number | null;
  order_quantity_step: number | null;
  active: boolean;
}

export interface ReorderProposal {
  lines: Array<{ product: CartItem['product']; quantity: number }>;
  unavailable: Array<{ name: string; reason: 'discontinued' | 'out_of_stock' }>;
  adjusted: Array<{ name: string; from: number; to: number; reason: 'minimum' | 'stock' }>;
}

export function buildReorderProposal(original: ReorderOriginalLine[], catalog: ReorderCatalogProduct[]): ReorderProposal {
  const byId = new Map(catalog.map((product) => [product.id, product]));
  const wanted = new Map<string, { name: string; quantity: number }>();
  const proposal: ReorderProposal = { lines: [], unavailable: [], adjusted: [] };

  for (const line of original) {
    if (!line.product_id) { proposal.unavailable.push({ name: line.name, reason: 'discontinued' }); continue; }
    const entry = wanted.get(line.product_id) ?? { name: line.name, quantity: 0 };
    entry.quantity += Math.max(0, Math.trunc(line.quantity));
    wanted.set(line.product_id, entry);
  }

  for (const [productId, entry] of Array.from(wanted.entries())) {
    const product = byId.get(productId);
    if (!product || !product.active) { proposal.unavailable.push({ name: entry.name, reason: 'discontinued' }); continue; }
    const minimum = Math.max(1, product.min_order_quantity ?? 1);
    const step = Math.max(1, product.order_quantity_step ?? 1);
    const stock = Math.max(0, product.stock ?? 0);
    const max = getMaximumValidQuantity(stock, minimum, step);
    if (max === 0) { proposal.unavailable.push({ name: product.name, reason: 'out_of_stock' }); continue; }

    const ruled = computeQuantityRuleState(Math.max(entry.quantity, minimum), minimum, step).nextValidQuantity;
    const quantity = Math.min(ruled, max);
    if (quantity !== entry.quantity) {
      proposal.adjusted.push({ name: product.name, from: entry.quantity, to: quantity, reason: quantity < entry.quantity ? 'stock' : 'minimum' });
    }
    proposal.lines.push({
      quantity,
      // Prix et règles actuels du catalogue, jamais les prix historiques.
      product: {
        id: product.id, name: product.name, slug: product.slug, price: Number(product.price),
        image_url: product.image_url, weight_grams: product.weight_grams, stock,
        storage_type: product.storage_type, min_order_quantity: minimum, order_quantity_step: step,
      },
    });
  }
  return proposal;
}
