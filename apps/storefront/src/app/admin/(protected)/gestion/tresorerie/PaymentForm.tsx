'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '../../../_components/ui/Button';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, isMoneyAmount, type PaymentMethod } from '@/lib/gestion/domain';
import { formatDate, formatMoney, todayIso } from '@/lib/gestion/format';
import { ErrorText, useGestionMutation } from '../_components/useGestionMutation';
import { HINT_CLS, INPUT_CLS, LABEL_CLS } from '../_components/ui';

export interface OpenPurchase {
  id: string;
  reference: string;
  supplier_id: string;
  order_date: string;
  currency: string;
  total: number;
  allocatable: number;
}

const toNumber = (value: string) => Number(value.replace(',', '.'));
const cents = (value: number) => Math.round(value * 100);

/**
 * Enregistrement d'un paiement fournisseur (statut « enregistré, à vérifier »)
 * et répartition sur un ou plusieurs achats. Le reste à payer n'est réduit
 * qu'après vérification.
 */
export function PaymentForm({ suppliers, purchases, initialSupplierId, initialPurchaseId }: {
  suppliers: { id: string; code: string; name: string; currency: string }[];
  purchases: OpenPurchase[];
  initialSupplierId?: string;
  initialPurchaseId?: string;
}) {
  const router = useRouter();
  const { run, pending, error, setError } = useGestionMutation();
  const initialPurchase = purchases.find((purchase) => purchase.id === initialPurchaseId);
  const [supplierId, setSupplierId] = useState(initialPurchase?.supplier_id ?? initialSupplierId ?? '');
  const [amount, setAmount] = useState(initialPurchase ? String(initialPurchase.allocatable) : '');
  const [date, setDate] = useState(todayIso());
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [thirdParty, setThirdParty] = useState(false);
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [beneficiaryReference, setBeneficiaryReference] = useState('');
  const [instruction, setInstruction] = useState('');
  const [payerAccount, setPayerAccount] = useState('');
  const [externalReference, setExternalReference] = useState('');
  const [notes, setNotes] = useState('');
  const [allocations, setAllocations] = useState<Record<string, string>>(
    initialPurchase ? { [initialPurchase.id]: String(initialPurchase.allocatable) } : {},
  );

  const supplier = suppliers.find((candidate) => candidate.id === supplierId);
  const supplierPurchases = useMemo(
    () => purchases.filter((purchase) => purchase.supplier_id === supplierId && purchase.currency === supplier?.currency),
    [purchases, supplierId, supplier?.currency],
  );
  const currency = supplier?.currency ?? 'EUR';
  const amountValue = toNumber(amount || '0');
  const allocatedCents = supplierPurchases.reduce((sum, purchase) => sum + cents(toNumber(allocations[purchase.id] || '0') || 0), 0);
  const remainderCents = cents(amountValue) - allocatedCents;

  function autoAllocate() {
    let left = cents(amountValue);
    const next: Record<string, string> = {};
    for (const purchase of [...supplierPurchases].sort((a, b) => a.order_date.localeCompare(b.order_date))) {
      if (left <= 0) break;
      const take = Math.min(left, cents(purchase.allocatable));
      if (take > 0) { next[purchase.id] = (take / 100).toFixed(2); left -= take; }
    }
    setAllocations(next);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!supplierId) { setError('Choisissez un fournisseur.'); return; }
    if (!isMoneyAmount(amountValue)) { setError('Montant invalide (positif, 2 décimales au plus).'); return; }
    if (thirdParty && !beneficiaryName.trim()) { setError('Indiquez le bénéficiaire réel du paiement.'); return; }
    const plan = supplierPurchases
      .map((purchase) => ({ purchase_id: purchase.id, amount: toNumber(allocations[purchase.id] || '0'), max: purchase.allocatable, reference: purchase.reference }))
      .filter((allocation) => allocation.amount > 0);
    const invalid = plan.find((allocation) => !isMoneyAmount(allocation.amount) || cents(allocation.amount) > cents(allocation.max));
    if (invalid) { setError(`Affectation invalide sur ${invalid.reference} (au plus ${formatMoney(invalid.max, currency)}).`); return; }
    if (remainderCents < 0) { setError('La somme affectée dépasse le montant du paiement.'); return; }

    const result = await run<{ id: string }>('/api/admin/gestion/payments', {
      withKey: true, refresh: false,
      body: {
        supplier_id: supplierId, amount: amountValue, payment_date: date, method,
        beneficiary_type: thirdParty ? 'third_party' : 'supplier',
        beneficiary_name: thirdParty ? beneficiaryName : null,
        beneficiary_reference: thirdParty ? beneficiaryReference : null,
        supplier_instruction_note: thirdParty ? instruction : null,
        payer_account: payerAccount, external_reference: externalReference, notes,
        allocations: plan.map(({ purchase_id, amount: value }) => ({ purchase_id, amount: value })),
      },
    });
    if (result) router.push(`/admin/gestion/tresorerie/${result.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className={LABEL_CLS}>Fournisseur (créancier) *</span>
          <select className={INPUT_CLS} value={supplierId} required onChange={(event) => { setSupplierId(event.target.value); setAllocations({}); }}>
            <option value="">Choisir un fournisseur</option>
            {suppliers.map((option) => <option key={option.id} value={option.id}>{option.name} ({option.code})</option>)}
          </select>
        </label>
        <label className="block">
          <span className={LABEL_CLS}>Montant ({currency}) *</span>
          <input inputMode="decimal" className={INPUT_CLS} value={amount} onChange={(event) => setAmount(event.target.value)} required placeholder="0,00" />
        </label>
        <label className="block">
          <span className={LABEL_CLS}>Date du paiement *</span>
          <input type="date" className={INPUT_CLS} value={date} max={todayIso()} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <label className="block">
          <span className={LABEL_CLS}>Mode de paiement *</span>
          <select className={INPUT_CLS} value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
            {PAYMENT_METHODS.map((value) => <option key={value} value={value}>{PAYMENT_METHOD_LABELS[value]}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={LABEL_CLS}>Compte ou caisse utilisé</span>
          <input className={INPUT_CLS} value={payerAccount} maxLength={120} onChange={(event) => setPayerAccount(event.target.value)} placeholder="Ex. compte pro, caisse magasin" />
        </label>
      </div>

      <fieldset className="space-y-3 rounded-xl border border-gray-200 p-3 sm:p-4 dark:border-gray-700">
        <legend className="px-1 text-sm font-semibold text-gray-900 dark:text-gray-100">Bénéficiaire</legend>
        <label className="flex min-h-11 items-center gap-3 text-sm text-gray-800 dark:text-gray-200">
          <input type="radio" name="beneficiary" className="h-5 w-5" checked={!thirdParty} onChange={() => setThirdParty(false)} />
          Payé au fournisseur{supplier ? ` (${supplier.name})` : ''}
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm text-gray-800 dark:text-gray-200">
          <input type="radio" name="beneficiary" className="h-5 w-5" checked={thirdParty} onChange={() => setThirdParty(true)} />
          Payé à un tiers sur instruction du fournisseur
        </label>
        {thirdParty && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={LABEL_CLS}>Nom du bénéficiaire *</span>
              <input className={INPUT_CLS} value={beneficiaryName} maxLength={200} onChange={(event) => setBeneficiaryName(event.target.value)} required />
            </label>
            <label className="block">
              <span className={LABEL_CLS}>Référence du bénéficiaire</span>
              <input className={INPUT_CLS} value={beneficiaryReference} maxLength={200} onChange={(event) => setBeneficiaryReference(event.target.value)} placeholder="IBAN, n° de compte…" />
            </label>
            <label className="block sm:col-span-2">
              <span className={LABEL_CLS}>Instruction du fournisseur</span>
              <textarea className={`${INPUT_CLS} min-h-20`} value={instruction} maxLength={2000} onChange={(event) => setInstruction(event.target.value)} placeholder="Qui a demandé ce paiement, quand et comment" />
              <span className={HINT_CLS}>La dette reste due au fournisseur ; ajoutez ensuite la preuve de l&apos;instruction dans les documents du paiement.</span>
            </label>
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <legend className="text-sm font-semibold text-gray-900 dark:text-gray-100">Affectation aux achats</legend>
          {supplierPurchases.length > 0 && (
            <button type="button" onClick={autoAllocate} className="min-h-11 rounded-lg px-3 text-sm font-medium text-[var(--admin-primary-fg)] hover:bg-[var(--admin-primary-soft)]">
              Répartir du plus ancien au plus récent
            </button>
          )}
        </div>
        {!supplierId ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Choisissez un fournisseur pour voir ses achats à payer.</p>
        ) : supplierPurchases.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Aucun achat avec un reste à payer. Le paiement restera non affecté (avance).</p>
        ) : (
          <ul className="space-y-2">
            {supplierPurchases.map((purchase) => (
              <li key={purchase.id} className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-medium text-gray-900 dark:text-gray-100">{purchase.reference}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{formatDate(purchase.order_date)} • affectable {formatMoney(purchase.allocatable, purchase.currency)} sur {formatMoney(purchase.total, purchase.currency)}</p>
                </div>
                <label>
                  <span className="sr-only">Montant affecté à {purchase.reference}</span>
                  <input inputMode="decimal" className={`${INPUT_CLS} text-right`} value={allocations[purchase.id] ?? ''} placeholder="0,00"
                    onChange={(event) => setAllocations((prev) => ({ ...prev, [purchase.id]: event.target.value }))} />
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className={`text-sm ${remainderCents < 0 ? 'font-medium text-red-700 dark:text-red-300' : 'text-gray-600 dark:text-gray-300'}`}>
          Affecté {formatMoney(allocatedCents / 100, currency)} sur {formatMoney(Number.isFinite(amountValue) ? amountValue : 0, currency)}
          {remainderCents > 0 ? ` • ${formatMoney(remainderCents / 100, currency)} resteront non affectés` : ''}
        </p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL_CLS}>Référence externe</span>
          <input className={INPUT_CLS} value={externalReference} maxLength={200} onChange={(event) => setExternalReference(event.target.value)} placeholder="Réf. du virement, n° de reçu…" />
        </label>
        <label className="block">
          <span className={LABEL_CLS}>Notes internes</span>
          <input className={INPUT_CLS} value={notes} maxLength={4000} onChange={(event) => setNotes(event.target.value)} />
        </label>
      </div>

      <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
        Le paiement sera enregistré avec le statut « à vérifier ». Il ne réduira la dette qu&apos;une fois vérifié.
      </div>
      <ErrorText message={error} />
      <Button type="submit" loading={pending} className="min-h-11">Enregistrer le paiement</Button>
    </form>
  );
}
