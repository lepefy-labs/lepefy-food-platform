'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconShoppingCart } from '@tabler/icons-react';
import { LepefyImage } from '@/components/images/LepefyImage';
import { useCartStore } from '@/stores/cartStore';
import { formatPrice } from '@/lib/utils/format';
import { logFunnelEvent } from '@/lib/funnelLog';
import { normalizeFulfillmentPolicy } from '@/lib/fulfillment/fulfillmentPolicy';
import { pickSellingFormatFields } from '@/lib/storefrontCopy/sellingFormat';
import type { ComebackLine } from '@/lib/checkout/cartComeback';
import type { ProductCardProduct } from '@/components/catalog/ProductCard';

type Line = ComebackLine<ProductCardProduct & { stock: number | null }>;

/**
 * « Votre panier vous attend » : remet les articles disponibles dans le panier
 * (règles minimum/pas du store, quantité existante jamais diminuée), puis
 * ouvre le panier ; le client refait le checkout normal.
 */
export default function CartComebackClient({ sessionId, lines, currency }: { sessionId: string; lines: Line[]; currency: string }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const busy = useRef(false);
  const available = lines.filter((line) => line.product && line.quantity > 0);
  const total = available.reduce((sum, line) => sum + (line.unitPrice ?? 0) * line.quantity, 0);

  function restore() {
    if (busy.current || available.length === 0) return;
    busy.current = true;
    setAdding(true);
    const cart = useCartStore.getState();
    for (const line of available) {
      const product = line.product!;
      const existing = cart.items.find((item) => item.product.id === product.id);
      if (existing) {
        if (existing.quantity < line.quantity) cart.updateQuantity(product.id, line.quantity);
        continue;
      }
      cart.addItem({
        id: product.id,
        name: product.name,
        slug: product.slug,
        price: product.price,
        image_url: product.image_url,
        weight_grams: product.weight_grams,
        stock: product.stock ?? 999,
        storage_type: product.storage_type ?? null,
        min_order_quantity: product.min_order_quantity,
        order_quantity_step: product.order_quantity_step,
        fulfillment_policy: normalizeFulfillmentPolicy(product.fulfillment_policy),
        ...pickSellingFormatFields(product),
      }, line.quantity);
    }
    logFunnelEvent({ module: 'shop', event_type: 'checkout_resumed', reference_id: sessionId, detail: { kind: 'cart_rebuilt', lines: available.length } });
    router.push('/cart');
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
      <h1 className="font-display text-2xl font-bold text-gray-950 sm:text-3xl">Votre panier vous attend</h1>
      <p className="mt-2 text-gray-700">Prix et disponibilités mis à jour aujourd’hui. Rien n’est débité avant le paiement.</p>

      <ul className="mt-5 space-y-3">
        {lines.map((line, index) => {
          const unavailable = !line.product || line.quantity === 0;
          return (
            <li key={`${line.product?.id ?? 'x'}-${index}`} className={`flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3 ${unavailable ? 'opacity-70' : ''}`}>
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-gray-50">
                {line.product?.image_url && <LepefyImage src={line.product.image_url} variant="thumbnail" alt="" fill sizes="64px" className="object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-950">{line.name}</p>
                {unavailable ? (
                  <p className="text-sm font-semibold text-gray-700">Plus disponible pour le moment</p>
                ) : (
                  <p className="text-sm text-gray-700">
                    {line.quantity} × {formatPrice(line.unitPrice ?? 0, currency)}
                    {line.adjusted && <span className="ml-1 font-semibold text-amber-900">(au lieu de {line.previousQuantity})</span>}
                  </p>
                )}
              </div>
              {!unavailable && <strong className="shrink-0 tabular-nums text-gray-950">{formatPrice((line.unitPrice ?? 0) * line.quantity, currency)}</strong>}
            </li>
          );
        })}
      </ul>

      {available.length > 0 ? (
        <div className="mt-6 grid gap-3">
          <p className="flex justify-between text-base font-semibold text-gray-950"><span>Prix des produits</span><span className="tabular-nums">{formatPrice(total, currency)}</span></p>
          <button
            type="button"
            onClick={restore}
            disabled={adding}
            className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl px-6 text-base font-extrabold text-white disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            <IconShoppingCart size={20} aria-hidden="true" /> {adding ? 'Un instant…' : 'Remettre dans mon panier'}
          </button>
          <Link href="/" className="text-center text-sm font-semibold underline underline-offset-2" style={{ color: 'var(--color-primary)' }}>Voir le catalogue</Link>
        </div>
      ) : (
        <div className="mt-6 text-center">
          <p className="text-gray-700">Ces produits ne sont plus disponibles pour le moment.</p>
          <Link href="/" className="mt-3 inline-flex min-h-12 items-center rounded-2xl px-6 font-bold text-white" style={{ backgroundColor: 'var(--color-primary)' }}>Voir le catalogue</Link>
        </div>
      )}
    </div>
  );
}
