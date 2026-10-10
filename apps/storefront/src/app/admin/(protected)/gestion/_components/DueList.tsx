import Link from 'next/link';
import type { DueItem } from '@/lib/gestion/queries';
import { DUE_STATE_TONES, dueInfo, dueLabel } from '@/lib/gestion/domain';
import { formatDate, formatMoney } from '@/lib/gestion/format';
import Badge from '@/app/admin/_components/ui/Badge';
import { EmptyState } from '@/app/admin/_components/ui/States';

/** Échéances fournisseurs ouvertes, de la plus urgente à la plus lointaine (sobre, opérationnel). */
export function DueList({ items, today, emptyText = 'Aucune échéance ouverte.' }: { items: DueItem[]; today: string; emptyText?: string }) {
  if (!items.length) return <EmptyState title={emptyText} description="Les achats commandés avec un reste à payer et une échéance apparaissent ici." />;
  return (
    <ul className="divide-y divide-a-border">
      {items.map((item) => {
        const info = dueInfo({ status: 'ordered', outstanding: item.outstanding, total: item.outstanding, payment_due_date: item.payment_due_date }, today);
        return (
          <li key={item.purchase_id}>
            <Link href={`/admin/gestion/achats/${item.purchase_id}`} className="flex flex-col gap-1 py-3 hover:bg-a-surface-2 sm:-mx-2 sm:flex-row sm:items-center sm:justify-between sm:px-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-a-text">{item.supplier_name}</p>
                <p className="text-xs text-a-text-3"><span className="font-mono">{item.reference}</span> • échéance {formatDate(item.payment_due_date)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <Badge tone={DUE_STATE_TONES[info.state]}>{dueLabel(info)}</Badge>
                <span className="text-sm font-semibold tabular-nums text-a-text">{formatMoney(item.outstanding, item.currency)}</span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
