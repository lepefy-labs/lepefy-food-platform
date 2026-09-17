import Link from 'next/link';
import { IconRosetteDiscountCheck, IconStar } from '@tabler/icons-react';

export interface ReviewableOrderItem {
  id: string;
  createdAt: string;
}

export function ReviewableOrders({ orders }: { orders: ReviewableOrderItem[] }) {
  if (orders.length === 0) return null;
  return (
    <section className="mx-auto max-w-3xl px-4 pt-6 sm:px-6 sm:pt-8" aria-labelledby="reviewable-orders-title">
      <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-amber-600"><IconRosetteDiscountCheck size={20} /></span>
          <div className="min-w-0 flex-1">
            <h2 id="reviewable-orders-title" className="font-semibold text-gray-950">Votre expérience compte</h2>
            <p className="mt-1 text-sm leading-6 text-gray-600">Vous pouvez laisser un avis global pour {orders.length > 1 ? 'ces commandes terminées' : 'cette commande terminée'}.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {orders.slice(0, 3).map((order) => (
                <Link key={order.id} href={`/avis/donner?order=${encodeURIComponent(order.id)}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-gray-950 px-4 text-sm font-semibold text-white">
                  <IconStar size={16} /> Avis #{order.id.slice(0, 8).toUpperCase()}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
