'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { IconArrowDown, IconArrowUp, IconPlus, IconSearch, IconTrash } from '@tabler/icons-react';
import Button from '../../../_components/ui/Button';
import InlineAlert from '../../../_components/ui/InlineAlert';
import { addOnWarnings, MAX_ADD_ONS, type AddOnAdminProduct } from '@/lib/catalog/addOns';
import { formatPrice } from '@/lib/utils/format';

type Item = AddOnAdminProduct & { image_url: string | null };

function sameOrder(a: Item[], b: Item[]) {
  return a.length === b.length && a.every((item, index) => item.id === b[index]?.id);
}

export default function AddOnsClient() {
  const [saved, setSaved] = useState<Item[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Item[]>([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  useEffect(() => {
    fetch('/api/admin/catalogue/add-ons', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: { available: boolean; products: Item[] }) => {
        if (!data.available) { setState('unavailable'); return; }
        setSaved(data.products);
        setItems(data.products);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    const seq = ++searchSeq.current;
    setSearching(true);
    const timer = window.setTimeout(() => {
      fetch(`/api/admin/catalogue?${new URLSearchParams({ q, limit: '10' })}`, { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : { products: [] }))
        .then((data: { products?: Item[] }) => { if (seq === searchSeq.current) setResults(data.products ?? []); })
        .catch(() => { if (seq === searchSeq.current) setResults([]); })
        .finally(() => { if (seq === searchSeq.current) setSearching(false); });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const dirty = !sameOrder(items, saved);
  const inList = useMemo(() => new Set(items.map((item) => item.id)), [items]);

  function move(index: number, delta: -1 | 1) {
    setItems((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    setMessage(null);
  }

  function add(product: Item) {
    if (inList.has(product.id) || items.length >= MAX_ADD_ONS) return;
    setItems((current) => [...current, product]);
    setMessage(null);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/catalogue/add-ons', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productIds: items.map((item) => item.id) }),
      });
      const data = await res.json().catch(() => ({})) as { products?: Item[]; error?: string };
      if (!res.ok || !data.products) throw new Error(data.error ?? 'Impossible d’enregistrer la liste.');
      setSaved(data.products);
      setItems(data.products);
      setMessage({ tone: 'success', text: `Liste enregistrée : ${data.products.length} petit${data.products.length > 1 ? 's' : ''} plus.` });
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'Impossible d’enregistrer la liste.' });
    } finally {
      setSaving(false);
    }
  }

  if (state === 'loading') return <p role="status" className="text-sm text-a-text-2">Chargement…</p>;
  if (state === 'unavailable') return <InlineAlert tone="warning" title="Pas encore disponible">La migration 165 n’est pas appliquée : la liste ne peut pas encore être enregistrée.</InlineAlert>;
  if (state === 'error') return <InlineAlert tone="danger" title="Erreur">Impossible de charger les petits plus. Rechargez la page.</InlineAlert>;

  return (
    <div className="space-y-5">
      <section aria-labelledby="add-ons-list" className="rounded-[10px] border border-a-border bg-a-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-a-border px-4 py-3">
          <h2 id="add-ons-list" className="text-sm font-semibold text-a-text">Ordre de proposition <span className="font-normal text-a-text-3">· {items.length}/{MAX_ADD_ONS}</span></h2>
          <div className="flex items-center gap-2">
            {dirty && <Button variant="ghost" size="sm" onClick={() => { setItems(saved); setMessage(null); }}>Annuler</Button>}
            <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>Enregistrer</Button>
          </div>
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-a-text-2">Aucun petit plus. Ajoutez des produits avec la recherche ci-dessous.</p>
        ) : (
          <ol className="divide-y divide-a-border">
            {items.map((item, index) => {
              const warnings = addOnWarnings(item);
              return (
                <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-6 shrink-0 text-right text-sm font-semibold tabular-nums text-a-text-3">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-a-text">{item.name}</p>
                    <p className="text-xs text-a-text-3">
                      {formatPrice(Number(item.price))} · stock {item.stock ?? 0}{item.weight_grams ? ` · ${item.weight_grams} g` : ''}
                    </p>
                    {warnings.length > 0 && <p className="text-xs font-medium text-tone-warning-fg">{warnings.join(' · ')}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="sm" aria-label={`Monter ${item.name}`} disabled={index === 0} onClick={() => move(index, -1)}><IconArrowUp size={16} aria-hidden="true" /></Button>
                    <Button variant="ghost" size="sm" aria-label={`Descendre ${item.name}`} disabled={index === items.length - 1} onClick={() => move(index, 1)}><IconArrowDown size={16} aria-hidden="true" /></Button>
                    <Button variant="ghost" size="sm" aria-label={`Retirer ${item.name}`} onClick={() => { setItems((current) => current.filter((x) => x.id !== item.id)); setMessage(null); }}><IconTrash size={16} aria-hidden="true" /></Button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {message && <div className="border-t border-a-border px-4 py-3"><InlineAlert tone={message.tone}>{message.text}</InlineAlert></div>}
      </section>

      <section aria-labelledby="add-ons-search" className="rounded-[10px] border border-a-border bg-a-surface p-4">
        <h2 id="add-ons-search" className="mb-2 text-sm font-semibold text-a-text">Ajouter un produit</h2>
        <label className="relative block">
          <span className="sr-only">Rechercher un produit</span>
          <IconSearch size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-a-text-3" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Chips, Mambo, cube, épice…"
            className="h-11 w-full rounded-[10px] border border-a-field bg-a-surface pl-9 pr-3 text-sm text-a-text focus-visible:outline-2 focus-visible:outline-a-focus" />
        </label>
        {searching && <p role="status" className="mt-2 text-xs text-a-text-3">Recherche…</p>}
        {results.length > 0 && (
          <ul className="mt-2 divide-y divide-a-border rounded-[10px] border border-a-border">
            {results.map((product) => {
              const already = inList.has(product.id);
              const warnings = addOnWarnings(product);
              return (
                <li key={product.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-a-text">{product.name}</p>
                    <p className="text-xs text-a-text-3">{formatPrice(Number(product.price))} · stock {product.stock ?? 0}{warnings.length ? ` · ${warnings[0]}` : ''}</p>
                  </div>
                  <Button variant="secondary" size="sm" disabled={already || items.length >= MAX_ADD_ONS} onClick={() => add(product)}>
                    {already ? 'Dans la liste' : <><IconPlus size={15} aria-hidden="true" /> Ajouter</>}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-a-text-3">Conseil : des produits secs, légers et à petit prix, qui se gardent longtemps. Le premier de la liste est proposé en premier.</p>
      </section>
    </div>
  );
}
