'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Button from '../../../_components/ui/Button';
import { ADJUSTMENT_REASONS } from '@/lib/gestion/domain';
import { formatStockUnits } from '@/lib/gestion/format';
import { useAdminMutation } from '@/app/admin/_components/ui/useAdminMutation';
import { ErrorText } from '@/app/admin/_components/ui/InlineAlert';
import { controlClasses, labelClasses, hintClasses } from '@/app/admin/_components/ui/Form';

interface ProductChoice { id: string; name: string; stock: number }

/**
 * Rectification de stock motivée (RPC adjust_inventory) : jamais d'écriture
 * directe de products.stock, jamais de stock négatif, aucun coût créé.
 */
export function StockAdjustForm({ initialProduct, closeHref }: { initialProduct: ProductChoice | null; closeHref: string }) {
  const { run, pending, error, setError } = useAdminMutation();
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
        <span className={labelClasses}>Produit *</span>
        {product ? (
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-lg bg-a-brand-soft px-3 py-2 text-sm">
            <span className="font-medium text-a-brand-fg">{product.name} • stock actuel {formatStockUnits(product.stock)}</span>
            <button type="button" onClick={() => { setProduct(null); setDone(null); }} className="min-h-11 text-sm text-a-text-2 underline">Changer</button>
          </div>
        ) : (
          <>
            <input className={controlClasses} value={q} onChange={(event) => setQ(event.target.value)} placeholder="Rechercher un produit" aria-label="Rechercher un produit" />
            {results.length > 0 && (
              <ul className="mt-1 max-h-60 overflow-y-auto rounded-lg border border-a-border bg-a-surface">
                {results.map((choice) => (
                  <li key={choice.id}>
                    <button type="button" onClick={() => { setProduct(choice); setQ(''); }} className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-a-surface-2">
                      <span className="truncate">{choice.name}</span>
                      <span className="shrink-0 text-xs text-a-text-3">stock {choice.stock}</span>
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
          <legend className={labelClasses}>Variation *</legend>
          <div className="flex gap-2">
            {(['add', 'remove'] as const).map((value) => (
              <label key={value} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${direction === value ? 'border-a-brand bg-a-brand-soft font-semibold' : 'border-a-border'}`}>
                <input type="radio" name="direction" className="sr-only" checked={direction === value} onChange={() => setDirection(value)} />
                {value === 'add' ? '+ Ajouter' : '- Retirer'}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className={labelClasses}>Unités *</span>
          <input inputMode="numeric" className={controlClasses} value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" />
        </label>
        <label className="block">
          <span className={labelClasses}>Motif *</span>
          <select className={controlClasses} value={reason} onChange={(event) => setReason(event.target.value)}>
            {[...ADJUSTMENT_REASONS, 'Autre'].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>
      {reason === 'Autre' && (
        <label className="block">
          <span className={labelClasses}>Motif précis *</span>
          <input className={controlClasses} value={customReason} maxLength={300} onChange={(event) => setCustomReason(event.target.value)} />
        </label>
      )}
      <label className="block">
        <span className={labelClasses}>Note (facultative)</span>
        <input className={controlClasses} value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} />
      </label>
      {product && delta !== null && (
        <p className={hintClasses}>
          {product.name} : {formatStockUnits(product.stock)} {delta > 0 ? '+' : '-'} {Math.abs(delta)} = {formatStockUnits(product.stock + delta)}.
          Une rectification ne modifie pas le coût d&apos;achat.
        </p>
      )}
      <ErrorText message={error} />
      {done && <p role="status" className="text-sm font-medium text-tone-success-fg">{done}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={pending} className="min-h-11">Enregistrer la rectification</Button>
        <Link href={closeHref} className="inline-flex min-h-11 items-center px-3 text-sm text-a-text-2 hover:text-a-text">Fermer</Link>
      </div>
    </form>
  );
}
