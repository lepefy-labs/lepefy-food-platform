'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Button from '../../../_components/ui/Button';
import { ADJUSTMENT_REASONS } from '@/lib/gestion/domain';
import { formatStockUnits } from '@/lib/gestion/format';
import { ErrorText, useGestionMutation } from '../_components/useGestionMutation';
import { HINT_CLS, INPUT_CLS, LABEL_CLS } from '../_components/ui';

interface ProductChoice { id: string; name: string; stock: number }

/**
 * Rectification de stock motivée (RPC adjust_inventory) : jamais d'écriture
 * directe de products.stock, jamais de stock négatif, aucun coût créé.
 */
export function StockAdjustForm({ initialProduct, closeHref }: { initialProduct: ProductChoice | null; closeHref: string }) {
  const { run, pending, error, setError } = useGestionMutation();
  const [product, setProduct] = useState<ProductChoice | null>(initialProduct);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ProductChoice[]>([]);
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<string>(ADJUSTMENT_REASONS[0]);
  const [customReason, setCustomReason] = useState('');
  const [note, setNote] = useState('');
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (product || q.trim().length < 2) { setResults([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/admin/gestion/inventory/products?q=${encodeURIComponent(q.trim())}`, { signal: controller.signal }).catch(() => null);
      const json = response?.ok ? await response.json() as { products: ProductChoice[] } : { products: [] };
      setResults(json.products);
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [q, product]);

  const units = Number(amount);
  const delta = Number.isInteger(units) && units > 0 ? (direction === 'add' ? units : -units) : null;
  const finalReason = reason === 'Autre' ? customReason.trim() : reason;

  return (
    <form
      id="ajuster"
      className="scroll-mt-24 space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setDone(null);
        if (!product) { setError('Choisissez un produit.'); return; }
        if (delta === null) { setError('Indiquez un nombre entier d\'unités (positif).'); return; }
        if (product.stock + delta < 0) { setError(`Le stock ne peut pas devenir négatif (stock actuel : ${product.stock}).`); return; }
        if (finalReason.length < 3) { setError('Le motif est obligatoire.'); return; }
        const result = await run<{ stockAfter: number; created: boolean }>('/api/admin/gestion/inventory/adjustments', {
          body: { product_id: product.id, delta, reason: finalReason, note }, withKey: true,
        });
        if (result) {
          setDone(`Stock de « ${product.name} » : ${formatStockUnits(result.stockAfter)}.`);
          setProduct({ ...product, stock: result.stockAfter });
          setAmount('');
          setNote('');
        }
      }}
    >
      <div>
        <span className={LABEL_CLS}>Produit *</span>
        {product ? (
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--admin-primary-soft)] px-3 py-2 text-sm">
            <span className="font-medium text-[var(--admin-primary-fg)]">{product.name} • stock actuel {formatStockUnits(product.stock)}</span>
            <button type="button" onClick={() => { setProduct(null); setDone(null); }} className="min-h-11 text-sm text-gray-700 underline dark:text-gray-200">Changer</button>
          </div>
        ) : (
          <>
            <input className={INPUT_CLS} value={q} onChange={(event) => setQ(event.target.value)} placeholder="Rechercher un produit" aria-label="Rechercher un produit" />
            {results.length > 0 && (
              <ul className="mt-1 max-h-60 overflow-y-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
                {results.map((choice) => (
                  <li key={choice.id}>
                    <button type="button" onClick={() => { setProduct(choice); setQ(''); }} className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-white/5">
                      <span className="truncate">{choice.name}</span>
                      <span className="shrink-0 text-xs text-gray-500">stock {choice.stock}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,10rem)_minmax(0,1fr)]">
        <fieldset>
          <legend className={LABEL_CLS}>Variation *</legend>
          <div className="flex gap-2">
            {(['add', 'remove'] as const).map((value) => (
              <label key={value} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${direction === value ? 'border-[var(--admin-primary)] bg-[var(--admin-primary-soft)] font-semibold' : 'border-gray-200 dark:border-gray-700'}`}>
                <input type="radio" name="direction" className="sr-only" checked={direction === value} onChange={() => setDirection(value)} />
                {value === 'add' ? '+ Ajouter' : '- Retirer'}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className={LABEL_CLS}>Unités *</span>
          <input inputMode="numeric" className={INPUT_CLS} value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" />
        </label>
        <label className="block">
          <span className={LABEL_CLS}>Motif *</span>
          <select className={INPUT_CLS} value={reason} onChange={(event) => setReason(event.target.value)}>
            {[...ADJUSTMENT_REASONS, 'Autre'].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>
      {reason === 'Autre' && (
        <label className="block">
          <span className={LABEL_CLS}>Motif précis *</span>
          <input className={INPUT_CLS} value={customReason} maxLength={300} onChange={(event) => setCustomReason(event.target.value)} />
        </label>
      )}
      <label className="block">
        <span className={LABEL_CLS}>Note (facultative)</span>
        <input className={INPUT_CLS} value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} />
      </label>
      {product && delta !== null && (
        <p className={HINT_CLS}>
          {product.name} : {formatStockUnits(product.stock)} {delta > 0 ? '+' : '-'} {Math.abs(delta)} = {formatStockUnits(product.stock + delta)}.
          Une rectification ne modifie pas le coût d&apos;achat.
        </p>
      )}
      <ErrorText message={error} />
      {done && <p role="status" className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{done}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={pending} className="min-h-11">Enregistrer la rectification</Button>
        <Link href={closeHref} className="inline-flex min-h-11 items-center px-3 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300">Fermer</Link>
      </div>
    </form>
  );
}
