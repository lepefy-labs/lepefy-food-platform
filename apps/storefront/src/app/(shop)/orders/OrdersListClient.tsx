import Link from 'next/link';
import { IconChevronRight, IconPackage, IconReceipt } from '@tabler/icons-react';
import { formatDate, formatPrice } from '@/lib/utils/format';
import {
  toTimelineStatus,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_STEPS,
  orderStatusStepIndex,
} from '@/lib/orders/orderStatus';

export interface OrderListItem {
  id:             string;
  status:         string;
  created_at:     string;
  total:          number;
  itemCount:      number;
  trackingToken:  string;
}

interface OrdersListClientProps {
  orders: OrderListItem[];
}

function StatusProgress({ activeIdx }: { activeIdx: number }) {
  return (
    <div className="flex items-center gap-1" aria-label={`Étape ${activeIdx + 1} sur ${ORDER_STATUS_STEPS.length}`}>
      {ORDER_STATUS_STEPS.map((step, i) => (
        <span
          key={step}
          className="h-1.5 w-7 rounded-full sm:w-9"
          style={{ background: i <= activeIdx ? 'var(--color-primary)' : '#E5E7EB' }}
        />
      ))}
    </div>
  );
}

export function OrdersListClient({ orders }: OrdersListClientProps) {
  return (
    <section className="mx-auto max-w-3xl px-4 pb-8 pt-7 sm:px-6 sm:pt-9">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Historique</p>
          <h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">Mes commandes</h1>
          <p className="mt-1 text-sm text-gray-500">
            Suivez l’avancement et retrouvez le détail de vos achats.
          </p>
        </div>
        <div className="hidden rounded-2xl bg-gray-50 px-3 py-2 text-right sm:block">
          <p className="text-xs text-gray-400">Total</p>
          <p className="text-sm font-semibold text-gray-800">
            {orders.length} commande{orders.length > 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {orders.map((order) => {
          const timelineStatus = toTimelineStatus(order.status);
          const activeIdx = orderStatusStepIndex(timelineStatus);
          return (
            <Link
              key={order.id}
              href={`/orders/${order.id}?token=${order.trackingToken}`}
              className="group rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 sm:p-5"
              style={{ '--tw-ring-color': 'var(--color-primary)' } as React.CSSProperties}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-gray-950">
                      #{order.id.slice(0, 8).toUpperCase()}
                    </span>
                    <span
                      className="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
                      style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary-dark)' }}
                    >
                      {ORDER_STATUS_LABELS[timelineStatus]}
                    </span>
                  </div>

                  <div className="mt-3">
                    <StatusProgress activeIdx={activeIdx} />
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-500 sm:text-sm">
                    <span>{formatDate(order.created_at)}</span>
                    <span className="inline-flex items-center gap-1.5">
                      <IconPackage size={15} stroke={1.8} />
                      {order.itemCount} article{order.itemCount > 1 ? 's' : ''}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-3">
                  <p className="text-base font-bold text-gray-950 sm:text-lg">{formatPrice(order.total)}</p>
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-50 text-gray-400 transition group-hover:bg-gray-100 group-hover:text-gray-700">
                    <IconChevronRight size={18} />
                  </span>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-gray-100 pt-3 text-xs font-medium text-gray-500 sm:text-sm">
                <IconReceipt size={16} />
                <span>Voir le détail et le suivi</span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
