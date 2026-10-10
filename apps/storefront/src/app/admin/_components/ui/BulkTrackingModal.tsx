'use client';

import { useState } from 'react';
import Button from './Button';
import Dialog from './Dialog';
import { Input, Select } from './Form';

export interface PendingTrackingOrder {
  id:    string;
  label: string; // es. "#A1B2C3D4 — Jean Dupont"
}

export default function BulkTrackingModal({
  orders,
  carrierOptions,
  onConfirm,
  onCancel,
}: {
  orders: PendingTrackingOrder[];
  carrierOptions: string[];
  onConfirm: (tracking: Record<string, { carrier: string; code: string }>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, { carrier: string; code: string }>>(
    Object.fromEntries(orders.map(o => [o.id, { carrier: carrierOptions[0] ?? '', code: '' }]))
  );

  const allFilled = orders.every(o => values[o.id]?.code?.trim());

  return (
    <Dialog
      open
      onClose={onCancel}
      title={`Code de suivi requis (${orders.length})`}
      description="Ces commandes n’ont pas encore de code de suivi. Renseignez-le pour les marquer comme expédiées."
      footer={<>
        <Button variant="secondary" onClick={onCancel}>Annuler</Button>
        <Button onClick={() => onConfirm(values)} disabled={!allFilled}>Confirmer et expédier</Button>
      </>}
    >
      <div className="space-y-3">
        {orders.map(order => (
          <div key={order.id} className="grid gap-2 sm:grid-cols-[8rem_9rem_minmax(0,1fr)] sm:items-center">
            <span className="truncate font-mono text-sm text-a-text-2">{order.label}</span>
            <Select
              value={values[order.id]?.carrier ?? ''}
              onChange={e => setValues(v => ({ ...v, [order.id]: { carrier: e.target.value, code: v[order.id]?.code ?? '' } }))}
              aria-label={`Transporteur pour ${order.label}`}
            >
              {carrierOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Input
              value={values[order.id]?.code ?? ''}
              onChange={e => setValues(v => ({ ...v, [order.id]: { carrier: v[order.id]?.carrier ?? (carrierOptions[0] ?? ''), code: e.target.value } }))}
              placeholder="Code de suivi"
              aria-label={`Code de suivi pour ${order.label}`}
            />
          </div>
        ))}
      </div>
    </Dialog>
  );
}
