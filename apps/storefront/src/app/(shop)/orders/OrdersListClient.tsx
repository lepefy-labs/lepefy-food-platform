import Link from 'next/link';
import { IconChevronRight } from '@tabler/icons-react';
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

function StatusDots({ activeIdx }: { activeIdx: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {ORDER_STATUS_STEPS.map((step, i) => (
        <span
          key={step}
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: i <= activeIdx ? 'var(--color-primary)' : '#E5E7EB' }}
        />
      ))}
    </span>
  );
}

export function OrdersListClient({ orders }: OrdersListClientProps) {
  return (
    <div className="max-w-xl mx-auto px-4 pt-6 pb-4">
      <h1 className="text-xl font-bold text-gray-900 mb-4">Mes commandes</h1>
      <div className="flex flex-col gap-3">
        {orders.map((order) => {
          const timelineStatus = toTimelineStatus(order.status);
          const activeIdx = orderStatusStepIndex(timelineStatus);
          return (
            <Link
              key={order.id}
              href={`/orders/${order.id}?token=${order.trackingToken}`}
              className="flex items-center justify-between gap-3 bg-white rounded-2xl border border-gray-100 shadow-card px-4 py-3.5 hover:border-gray-200 transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-semibold text-gray-900 font-mono">
                    Commande #{order.id.slice(0, 8).toUpperCase()}
                  </span>
                  <StatusDots activeIdx={activeIdx} />
                  <span className="text-xs font-medium" style={{ color: 'var(--color-primary-dark)' }}>
                    {ORDER_STATUS_LABELS[timelineStatus]}
                  </span>
                </div>
                <p className="text-xs text-gray-400">
                  {formatDate(order.created_at)} · {order.itemCount} article{order.itemCount > 1 ? 's' : ''}
                </p>
                <p className="text-sm font-bold mt-1" style={{ color: 'var(--color-primary)' }}>
                  {formatPrice(order.total)}
                </p>
              </div>
              <IconChevronRight size={18} className="text-gray-300 flex-shrink-0" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
