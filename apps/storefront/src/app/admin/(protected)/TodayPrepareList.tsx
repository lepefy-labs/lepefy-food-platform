'use client';

import { useState } from 'react';
import Link from 'next/link';
import { IconAlertTriangle, IconBuildingStore, IconClipboardList, IconLeaf, IconSnowflake, IconTruck } from '@tabler/icons-react';
import type { PreparationStep } from '@/lib/orders/preparation/preparationPolicy';
import Badge from '../_components/ui/Badge';
import { buttonClasses } from '../_components/ui/Button';
import { EmptyState } from '../_components/ui/States';
import PreparationStepBadge from '../_components/ui/PreparationStepBadge';

export interface PrepareRow {
  id: string;
  ref: string;
  customer: string;
  createdAt: string;
  units: number;
  lines: number;
  pickup: boolean;
  country: string | null;
  international: boolean;
  fresh: boolean;
  frozen: boolean;
  step: PreparationStep | null;
  urgency: string | null;
  action: string;
}

/** Compact « to prepare » list of the dashboard; the selection opens a preparation session. */
export default function TodayPrepareList({ rows, total }: { rows: PrepareRow[]; total: number }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  if (rows.length === 0) {
    return <EmptyState title="Aucune commande à préparer." description="Les nouvelles commandes payées apparaîtront ici." />;
  }
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const ids = rows.filter((row) => selected.has(row.id)).map((row) => row.id);
  const sessionHref = `/admin/orders/preparation?ids=${(ids.length ? ids : rows.map((row) => row.id)).join(',')}`;

  return (
    <div>
      <ul className="divide-y divide-a-border">
        {rows.map((row) => (
          <li key={row.id} className="flex items-start gap-3 px-4 py-3">
            <input
              type="checkbox"
              checked={selected.has(row.id)}
              onChange={() => toggle(row.id)}
              aria-label={`Sélectionner ${row.ref}`}
              className="mt-1 h-5 w-5 shrink-0 rounded border-a-field accent-a-brand"
            />
            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-xs font-semibold text-a-text-2">{row.ref}</span>
                  <span className="truncate text-sm font-semibold text-a-text">{row.customer}</span>
                </p>
                <p className="text-xs text-a-text-3">{row.createdAt} · {row.units} article{row.units > 1 ? 's' : ''} · {row.lines} réf.</p>
                {row.urgency && <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-tone-urgent-fg"><IconAlertTriangle size={13} aria-hidden="true" />{row.urgency}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Badge tone="neutral" icon={row.pickup ? <IconBuildingStore size={12} aria-hidden="true" /> : <IconTruck size={12} aria-hidden="true" />}>
                  {row.pickup ? 'Retrait' : `Livraison${row.country ? ` · ${row.country}` : ''}`}
                </Badge>
                {row.international && <Badge tone="info">Étranger</Badge>}
                {row.fresh && <Badge tone="success" icon={<IconLeaf size={12} aria-hidden="true" />}>Frais</Badge>}
                {row.frozen && <Badge tone="info" icon={<IconSnowflake size={12} aria-hidden="true" />}>Surgelés</Badge>}
                {row.step && <PreparationStepBadge step={row.step} />}
              </div>
              <Link href={`/admin/orders/${row.id}`} className={buttonClasses({ variant: 'outline', size: 'sm', className: 'justify-self-start sm:justify-self-end' })}>
                {row.action}<span className="sr-only"> — commande {row.ref}</span>
              </Link>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 border-t border-a-border bg-a-surface-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-a-text-3" aria-live="polite">
          {ids.length ? `${ids.length} commande${ids.length > 1 ? 's' : ''} sélectionnée${ids.length > 1 ? 's' : ''}` : `${rows.length} affichée${rows.length > 1 ? 's' : ''} sur ${total}`}
        </p>
        <Link href={sessionHref} className={buttonClasses({ variant: 'primary', size: 'sm' })}>
          <IconClipboardList size={16} aria-hidden="true" />
          {ids.length ? `Préparer la sélection (${ids.length})` : 'Préparer ces commandes'}
        </Link>
      </div>
    </div>
  );
}
