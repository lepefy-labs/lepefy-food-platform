'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import Button from '../../../_components/ui/Button';
import { formatMoney, todayIso } from '@/lib/gestion/format';
import { ErrorText, useGestionMutation } from '../_components/useGestionMutation';
import { HINT_CLS, INPUT_CLS, LABEL_CLS } from '../_components/ui';

export interface SupplierOption { id: string; code: string; name: string; currency: string }

export interface PurchaseItemDraft {
  key: string;
  product_id: string | null;
  product_name: string | null;
  description: string;
  ordered_quantity: string;
  unit_cost: string;
}

export interface PurchaseFormInitial {
  supplier_id: string;
  supplier_reference: string;
  order_date: string;
  expected_date: string;
  additional_costs: string;
  notes: string;
  items: Omit<PurchaseItemDraft, 'key'>[];
}

const newItem = (): PurchaseItemDraft => ({
  key: Math.random().toString(36).slice(2), product_id: null, product_name: null, description: '', ordered_quantity: '1', unit_cost: '',
});
const toNumber = (value: string) => Number(value.replace(',', '.'));

function ProductPicker({ onPick }: { onPick: (product: { id: string; name: string }) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ id: string; name: string; stock: number; active: boolean }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/admin/gestion/products?q=${encodeURIComponent(q.trim())}`, { signal: controller.signal }).catch(() => null);
      const json = response?.ok ? await response.json() as { products: typeof results } : { products: [] };
      setResults(json.products);
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [q]);
  return (
    <div>
      <input className={INPUT_CLS} value={q} onChange={(event) => setQ(event.target.value)} placeholder="Rechercher un produit du catalogue" aria-label="Rechercher un produit du catalogue" />
      {results.length > 0 && (
        <ul className="mt-1 max-h-60 overflow-y-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
          {results.map((product) => (
            <li key={product.id}>
              <button type="button" onClick={() => { onPick(product); setQ(''); setResults([]); }}
                className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-white/5">
                <span className="truncate">{product.name}{product.active ? '' : ' (inactif)'}</span>
                <span className="shrink-0 text-xs text-gray-500">stock {product.stock}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Création d'un achat ou modification avant toute réception. Le total final est calculé par le serveur. */
export function PurchaseForm({ suppliers, currency, initial, purchaseId, purchaseStatus }: {
  suppliers: SupplierOption[]; currency: string; initial?: Partial<PurchaseFormInitial>;
  purchaseId?: string; purchaseStatus?: 'draft' | 'ordered';
}) {
  const router = useRouter();
  const { run, pending, error, setError } = useGestionMutation();
  const [supplierId, setSupplierId] = useState(initial?.supplier_id ?? '');
  const [supplierReference, setSupplierReference] = useState(initial?.supplier_reference ?? '');
  const [orderDate, setOrderDate] = useState(initial?.order_date ?? todayIso());
  const [expectedDate, setExpectedDate] = useState(initial?.expected_date ?? '');
  const [additionalCosts, setAdditionalCosts] = useState(initial?.additional_costs ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [items, setItems] = useState<PurchaseItemDraft[]>(
    initial?.items?.length ? initial.items.map((item) => ({ ...item, key: Math.random().toString(36).slice(2) })) : [newItem()],
  );
  const editing = Boolean(purchaseId);
  const supplierCurrency = suppliers.find((supplier) => supplier.id === supplierId)?.currency ?? currency;

  const estimate = useMemo(() => {
    const lines = items.reduce((sum, item) => {
      const quantity = toNumber(item.ordered_quantity);
      const cost = toNumber(item.unit_cost);
      return Number.isFinite(quantity) && Number.isFinite(cost) ? sum + Math.round(quantity * cost * 100) / 100 : sum;
    }, 0);
    const extra = toNumber(additionalCosts || '0');
    return lines + (Number.isFinite(extra) ? extra : 0);
  }, [items, additionalCosts]);

  const updateItem = (key: string, patch: Partial<PurchaseItemDraft>) =>
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  function payload() {
    const parsedItems = items
      .filter((item) => item.product_id || item.description.trim() || item.unit_cost)
      .map((item) => ({
        product_id: item.product_id,
        description: item.description.trim() || null,
        ordered_quantity: Math.trunc(toNumber(item.ordered_quantity)),
        unit_cost: toNumber(item.unit_cost),
      }));
    if (parsedItems.some((item) => !Number.isInteger(item.ordered_quantity) || item.ordered_quantity <= 0)) return { error: 'Chaque quantité doit être un nombre entier positif.' };
    if (parsedItems.some((item) => !Number.isFinite(item.unit_cost) || item.unit_cost < 0)) return { error: 'Chaque coût unitaire doit être un nombre positif.' };
    if (parsedItems.some((item) => !item.product_id && !item.description)) return { error: 'Chaque article doit avoir une description ou un produit.' };
    const extra = additionalCosts.trim() ? toNumber(additionalCosts) : 0;
    if (!Number.isFinite(extra) || extra < 0) return { error: 'Frais supplémentaires invalides.' };
    return {
      data: {
        supplier_reference: supplierReference, order_date: orderDate, expected_date: expectedDate,
        additional_costs: extra, notes, items: parsedItems,
      },
    };
  }

  async function submit(status: 'draft' | 'ordered') {
    const built = payload();
    if ('error' in built) { setError(built.error ?? null); return; }
    if (editing) {
      const result = await run(`/api/admin/gestion/purchases/${purchaseId}`, { method: 'PATCH', body: built.data, refresh: false });
      if (result) { router.push(`/admin/gestion/achats/${purchaseId}`); router.refresh(); }
      return;
    }
    if (!supplierId) { setError('Choisissez un fournisseur.'); return; }
    const result = await run<{ id: string }>('/api/admin/gestion/purchases', {
      body: { ...built.data, supplier_id: supplierId, status }, withKey: true, refresh: false,
    });
    if (result) router.push(`/admin/gestion/achats/${result.id}`);
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); void submit('draft'); }} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className={LABEL_CLS}>Fournisseur *</span>
          <select className={INPUT_CLS} value={supplierId} disabled={editing} onChange={(event) => setSupplierId(event.target.value)} required>
            <option value="">Choisir un fournisseur</option>
            {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name} ({supplier.code})</option>)}
          </select>
          {editing && <span className={HINT_CLS}>Le fournisseur d&apos;un achat ne peut pas être changé.</span>}
        </label>
        <label className="block">
          <span className={LABEL_CLS}>Date de commande</span>
          <input type="date" className={INPUT_CLS} value={orderDate} onChange={(event) => setOrderDate(event.target.value)} required />
        </label>
        <label className="block">
          <span className={LABEL_CLS}>Livraison prévue</span>
          <input type="date" className={INPUT_CLS} value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} />
        </label>
        <label className="block">
          <span className={LABEL_CLS}>Référence du fournisseur</span>
          <input className={INPUT_CLS} value={supplierReference} maxLength={120} onChange={(event) => setSupplierReference(event.target.value)} placeholder="N° de facture ou de commande" />
        </label>
        <label className="block">
          <span className={LABEL_CLS}>Frais supplémentaires ({supplierCurrency})</span>
          <input inputMode="decimal" className={INPUT_CLS} value={additionalCosts} onChange={(event) => setAdditionalCosts(event.target.value)} placeholder="Transport, douane…" />
        </label>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">Articles</legend>
        <ul className="space-y-3">
          {items.map((item, index) => (
            <li key={item.key} className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Article {index + 1}</span>
                {items.length > 1 && (
                  <button type="button" onClick={() => setItems((prev) => prev.filter((candidate) => candidate.key !== item.key))}
                    className="inline-flex min-h-11 items-center gap-1 px-2 text-sm text-red-700 dark:text-red-300" aria-label={`Retirer l'article ${index + 1}`}>
                    <IconTrash size={16} aria-hidden="true" />Retirer
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <div className="space-y-2">
                  {item.product_id ? (
                    <div className="flex min-h-11 items-center justify-between gap-2 rounded-lg bg-[var(--admin-primary-soft)] px-3 text-sm">
                      <span className="truncate font-medium text-[var(--admin-primary-fg)]">Catalogue : {item.product_name}</span>
                      <button type="button" onClick={() => updateItem(item.key, { product_id: null, product_name: null })} aria-label="Délier le produit"
                        className="inline-flex min-h-11 items-center"><IconX size={16} aria-hidden="true" /></button>
                    </div>
                  ) : (
                    <ProductPicker onPick={(product) => updateItem(item.key, { product_id: product.id, product_name: product.name, description: item.description || product.name })} />
                  )}
                  <input className={INPUT_CLS} value={item.description} maxLength={300} onChange={(event) => updateItem(item.key, { description: event.target.value })}
                    placeholder={item.product_id ? 'Description (optionnelle)' : 'Description (article hors catalogue)'} aria-label="Description" />
                  {!item.product_id && <p className={HINT_CLS}>Sans produit lié, la réception n&apos;augmente pas le stock de la boutique.</p>}
                </div>
                <label className="block">
                  <span className={LABEL_CLS}>Quantité</span>
                  <input inputMode="numeric" className={INPUT_CLS} value={item.ordered_quantity} onChange={(event) => updateItem(item.key, { ordered_quantity: event.target.value })} />
                </label>
                <label className="block">
                  <span className={LABEL_CLS}>Coût unitaire</span>
                  <input inputMode="decimal" className={INPUT_CLS} value={item.unit_cost} onChange={(event) => updateItem(item.key, { unit_cost: event.target.value })} placeholder="0,00" />
                </label>
              </div>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setItems((prev) => [...prev, newItem()])}
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200">
          <IconPlus size={16} aria-hidden="true" />Ajouter un article
        </button>
      </fieldset>

      <label className="block">
        <span className={LABEL_CLS}>Notes internes</span>
        <textarea className={`${INPUT_CLS} min-h-20`} value={notes} maxLength={4000} onChange={(event) => setNotes(event.target.value)} />
      </label>

      <div className="flex flex-col gap-3 rounded-xl bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between dark:bg-gray-800/60">
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Total estimé (recalculé par le serveur)</p>
          <p className="text-xl font-semibold tabular-nums text-gray-950 dark:text-gray-100">{formatMoney(estimate, supplierCurrency)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <Button type="submit" loading={pending} className="min-h-11">Enregistrer les modifications</Button>
          ) : (
            <>
              <Button type="submit" variant="outline" loading={pending} className="min-h-11">Enregistrer le brouillon</Button>
              <Button type="button" loading={pending} onClick={() => void submit('ordered')} className="min-h-11">Enregistrer et commander</Button>
            </>
          )}
        </div>
      </div>
      {purchaseStatus === 'ordered' && <p className={HINT_CLS}>Achat déjà commandé : les modifications restent possibles tant qu&apos;aucune réception n&apos;est enregistrée.</p>}
      <ErrorText message={error} />
    </form>
  );
}
