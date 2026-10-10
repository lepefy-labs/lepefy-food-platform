'use client';

import { useState } from 'react';
import Button from '../../../../_components/ui/Button';
import { isMoneyAmount } from '@/lib/gestion/domain';
import { formatMoney } from '@/lib/gestion/format';
import { useAdminMutation } from '@/app/admin/_components/ui/useAdminMutation';
import { ErrorText } from '@/app/admin/_components/ui/InlineAlert';
import { controlClasses, labelClasses } from '@/app/admin/_components/ui/Form';

/** Affecter la part non affectée d'un paiement à un achat du même fournisseur. */
export function AllocateForm({ paymentId, unallocated, currency, purchases }: {
  paymentId: string; unallocated: number; currency: string;
  purchases: { id: string; reference: string; allocatable: number }[];
}) {
  const { run, pending, error, setError } = useAdminMutation();
  const [purchaseId, setPurchaseId] = useState(purchases[0]?.id ?? '');
  const selected = purchases.find((purchase) => purchase.id === purchaseId);
  const [amount, setAmount] = useState(() => (selected ? String(Math.min(unallocated, selected.allocatable)) : ''));

  if (!purchases.length) return <p className="text-sm text-a-text-3">Aucun achat de ce fournisseur avec un reste à payer.</p>;

  return (
    <form
      className="grid gap-3 rounded-xl border border-a-border p-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end"
      onSubmit={async (event) => {
        event.preventDefault();
        const value = Number(amount.replace(',', '.'));
        if (!isMoneyAmount(value)) { setError('Montant invalide.'); return; }
        if (selected && value > selected.allocatable) { setError(`Au plus ${formatMoney(selected.allocatable, currency)} sur cet achat.`); return; }
        if (value > unallocated) { setError(`Au plus ${formatMoney(unallocated, currency)} restent à affecter.`); return; }
        await run(`/api/admin/gestion/payments/${paymentId}/allocations`, { body: { purchase_id: purchaseId, amount: value }, withKey: true });
      }}
    >
      <label className="block">
        <span className={labelClasses}>Achat</span>
        <select className={controlClasses} value={purchaseId} onChange={(event) => {
          setPurchaseId(event.target.value);
          const next = purchases.find((purchase) => purchase.id === event.target.value);
          if (next) setAmount(String(Math.min(unallocated, next.allocatable)));
        }}>
          {purchases.map((purchase) => <option key={purchase.id} value={purchase.id}>{purchase.reference} (affectable {formatMoney(purchase.allocatable, currency)})</option>)}
        </select>
      </label>
      <label className="block">
        <span className={labelClasses}>Montant</span>
        <input inputMode="decimal" className={`${controlClasses} text-right`} value={amount} onChange={(event) => setAmount(event.target.value)} />
      </label>
      <Button type="submit" loading={pending} className="min-h-11">Affecter</Button>
      <div className="sm:col-span-3"><ErrorText message={error} /></div>
    </form>
  );
}
