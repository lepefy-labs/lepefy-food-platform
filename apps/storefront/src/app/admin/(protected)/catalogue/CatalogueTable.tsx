'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { formatPrice } from '@/lib/utils/format';
import {
  IconAdjustments,
  IconAlertTriangle,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconDotsVertical,
  IconPhoto,
  IconPlus,
  IconSearch,
  IconX,
} from '@tabler/icons-react';

type Category = { id: string; name: string; slug: string };

type Product = {
  id: string;
  name: string;
  slug: string;
  price: number;
  stock: number;
  active: boolean;
  image_url: string | null;
  storage_type: string | null;
  warehouse_location: string | null;
  description_source: 'ai' | 'human' | null;
  barcode_value: string | null;
  categories: { name: string; slug: string } | null;
};

type ApiResponse = {
  products: Product[];
  total: number;
  page: number;
  limit: number;
};

type StatusFilter = 'all' | 'active' | 'inactive' | 'out' | 'ai';

interface Props {
  tenantCurrency: string;
  categories: Category[];
  initialCategory?: string;
  initialSort?: string;
}

const PAGE_SIZE = 25;

function closeMenu(target: EventTarget & HTMLElement) {
  target.closest('details')?.removeAttribute('open');
}

export default function CatalogueTable({
  tenantCurrency,
  categories,
  initialCategory,
  initialSort,
}: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState(initialCategory ?? '');
  const [sort, setSort] = useState(initialSort ?? 'position_asc');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [stockValues, setStockValues] = useState<Record<string, number>>({});
  const [activeStates, setActiveStates] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, category, sort, status]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
      sort,
    });
    if (debouncedSearch) params.set('q', debouncedSearch);
    if (category) params.set('category', category);
    if (status !== 'all') params.set('status', status);

    setLoading(true);
    setError(null);

    fetch(`/api/admin/catalogue?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('Impossible de charger le catalogue');
        return res.json() as Promise<ApiResponse>;
      })
      .then((data) => {
        setProducts(data.products);
        setTotal(data.total);
        setStockValues(Object.fromEntries(data.products.map((p) => [p.id, p.stock])));
        setActiveStates(Object.fromEntries(data.products.map((p) => [p.id, p.active])));
        setSelected(new Set());
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Erreur de chargement');
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [page, debouncedSearch, category, sort, status]);

  useEffect(() => {
    if (!feedback) return;
    const t = window.setTimeout(() => setFeedback(null), 2200);
    return () => window.clearTimeout(t);
  }, [feedback]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allSelected = products.length > 0 && products.every((p) => selected.has(p.id));

  const statusCounts = useMemo(() => ({
    active: products.filter((p) => activeStates[p.id]).length,
    inactive: products.filter((p) => !activeStates[p.id]).length,
    out: products.filter((p) => (stockValues[p.id] ?? p.stock) === 0).length,
    ai: products.filter((p) => p.description_source === 'ai').length,
  }), [products, activeStates, stockValues]);

  async function patchProduct(productId: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/admin/catalogue/${productId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Mise à jour échouée');
  }

  async function toggleActive(productId: string) {
    const current = activeStates[productId] ?? false;
    const next = !current;
    setActiveStates((prev) => ({ ...prev, [productId]: next }));
    try {
      await patchProduct(productId, { active: next });
      setFeedback('Statut enregistré');
    } catch {
      setActiveStates((prev) => ({ ...prev, [productId]: current }));
      setFeedback('Erreur de mise à jour');
    }
  }

  async function copySlug(slug: string) {
    try {
      await navigator.clipboard.writeText(slug);
      setFeedback('Slug copié');
    } catch {
      setFeedback('Erreur lors de la copie');
    }
  }

  async function saveStock(productId: string, nextValue: number) {
    const current = products.find((p) => p.id === productId)?.stock ?? 0;
    setStockValues((prev) => ({ ...prev, [productId]: nextValue }));
    try {
      await patchProduct(productId, { stock: nextValue });
      setProducts((prev) => prev.map((p) => p.id === productId ? { ...p, stock: nextValue } : p));
      setFeedback('Stock enregistré');
    } catch {
      setStockValues((prev) => ({ ...prev, [productId]: current }));
      setFeedback('Erreur de mise à jour');
    }
  }

  function toggleSelection(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(products.map((p) => p.id)));
  }

  async function bulkSetActive(value: boolean) {
    const ids = [...selected];
    if (ids.length === 0) return;
    const previous = { ...activeStates };
    setActiveStates((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, value])) }));
    try {
      await Promise.all(ids.map((id) => patchProduct(id, { active: value })));
      setFeedback(`${ids.length} produit${ids.length > 1 ? 's' : ''} mis à jour`);
      setSelected(new Set());
    } catch {
      setActiveStates(previous);
      setFeedback('Une action groupée a échoué');
    }
  }

  const filtersActive = Boolean(category || status !== 'all' || sort !== 'position_asc');

  function ActionMenu({ product }: { product: Product }) {
    const active = activeStates[product.id] ?? product.active;
    return (
      <details className="relative">
        <summary
          aria-label={`Plus d'actions pour ${product.name}`}
          className="flex cursor-pointer list-none items-center justify-center rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        >
          <IconDotsVertical size={16} />
        </summary>
        <div className="absolute right-0 top-full z-40 mt-1 w-44 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 text-left shadow-xl">
          <button
            type="button"
            onClick={(e) => {
              closeMenu(e.currentTarget);
              void toggleActive(product.id);
            }}
            className="flex min-h-10 w-full items-center rounded-lg px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {active ? 'Désactiver' : 'Activer'}
          </button>
          <button
            type="button"
            onClick={(e) => {
              closeMenu(e.currentTarget);
              void copySlug(product.slug);
            }}
            className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <IconCopy size={15} /> Copier le slug
          </button>
        </div>
      </details>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 pb-24 md:pb-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-baseline gap-2">
            <h1 className="text-2xl font-bold text-gray-950">Catalogue</h1>
            <span className="text-sm text-gray-400">{total} produits</span>
          </div>
          <p className="mt-1 text-sm text-gray-500">Gérez rapidement disponibilité, stock et contenu.</p>
        </div>
        <Link href="/admin/catalogue/nouveau" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90">
          <IconPlus size={18} /> Nouveau produit
        </Link>
      </div>

      <div className="sticky top-0 z-20 rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-sm backdrop-blur md:static md:shadow-none">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <IconSearch size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher nom, slug, catégorie ou code-barres…" className="min-h-11 w-full rounded-xl border border-gray-200 bg-white pl-10 pr-10 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[var(--color-primary)]" />
            {search && <button onClick={() => setSearch('')} aria-label="Effacer" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-gray-400 hover:bg-gray-100"><IconX size={16} /></button>}
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 lg:pb-0">
            {([
              ['all', 'Tous'],
              ['active', `Actifs${status === 'active' ? ` (${statusCounts.active})` : ''}`],
              ['inactive', `Inactifs${status === 'inactive' ? ` (${statusCounts.inactive})` : ''}`],
              ['out', `Rupture${status === 'out' ? ` (${statusCounts.out})` : ''}`],
              ['ai', `IA à revoir${status === 'ai' ? ` (${statusCounts.ai})` : ''}`],
            ] as const).map(([value, label]) => (
              <button key={value} onClick={() => setStatus(value)} className={`min-h-10 shrink-0 rounded-xl border px-3 text-xs font-semibold transition ${status === value ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>{label}</button>
            ))}
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="min-h-10 rounded-xl border border-gray-200 px-3 text-sm">
            <option value="">Toutes les catégories</option>
            {categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="min-h-10 rounded-xl border border-gray-200 px-3 text-sm">
            <option value="position_asc">Ordre catalogue</option>
            <option value="name_asc">Nom A → Z</option>
            <option value="name_desc">Nom Z → A</option>
            <option value="price_asc">Prix croissant</option>
            <option value="price_desc">Prix décroissant</option>
            <option value="stock_asc">Stock croissant</option>
            <option value="stock_desc">Stock décroissant</option>
          </select>
          <button onClick={() => { setCategory(''); setSort('position_asc'); setStatus('all'); }} disabled={!filtersActive} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-gray-200 px-3 text-sm text-gray-600 disabled:opacity-40">
            <IconAdjustments size={16} /> Réinitialiser
          </button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-primary)]/20 bg-[var(--color-primary-light)] p-3">
          <span className="mr-auto text-sm font-semibold text-gray-800">{selected.size} sélectionné{selected.size > 1 ? 's' : ''}</span>
          <button onClick={() => bulkSetActive(true)} className="min-h-10 rounded-lg border border-white bg-white px-3 text-xs font-semibold text-gray-700">Activer</button>
          <button onClick={() => bulkSetActive(false)} className="min-h-10 rounded-lg border border-white bg-white px-3 text-xs font-semibold text-gray-700">Désactiver</button>
          <button onClick={() => setSelected(new Set())} className="min-h-10 rounded-lg px-3 text-xs font-semibold text-gray-500">Annuler</button>
        </div>
      )}

      {error && <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><IconAlertTriangle size={18} /> {error}</div>}

      <div className="hidden overflow-visible rounded-2xl border border-gray-200 bg-white md:block">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
            <tr>
              <th className="w-10 px-4 py-3"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Tout sélectionner" /></th>
              <th className="px-4 py-3">Produit</th>
              <th className="px-4 py-3">Catégorie</th>
              <th className="px-4 py-3">Prix</th>
              <th className="px-4 py-3">Stock</th>
              <th className="px-4 py-3">Statut</th>
              <th className="w-32 px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">Chargement…</td></tr>
            ) : products.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">Aucun produit trouvé.</td></tr>
            ) : products.map((product) => {
              const stock = stockValues[product.id] ?? product.stock;
              return (
                <tr key={product.id} className="hover:bg-gray-50/70">
                  <td className="px-4 py-3"><input type="checkbox" checked={selected.has(product.id)} onChange={() => toggleSelection(product.id)} aria-label={`Sélectionner ${product.name}`} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-100">
                        {product.image_url ? <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" /> : <IconPhoto size={18} className="text-gray-300" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2"><p className="truncate font-semibold text-gray-900">{product.name}</p>{product.description_source === 'ai' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">IA</span>}</div>
                        <p className="truncate font-mono text-xs text-gray-400">{product.slug}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{product.categories?.name ?? '—'}</td>
                  <td className="px-4 py-3 font-semibold text-gray-900">{formatPrice(product.price, tenantCurrency)}</td>
                  <td className="px-4 py-3">
                    <input type="number" min={0} value={stock} onChange={(e) => setStockValues((prev) => ({ ...prev, [product.id]: Math.max(0, Number(e.target.value) || 0) }))} onBlur={(e) => saveStock(product.id, Math.max(0, Number(e.target.value) || 0))} className={`w-20 rounded-lg border px-2 py-1.5 text-center text-sm font-semibold ${stock === 0 ? 'border-red-200 bg-red-50 text-red-600' : stock < 10 ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-gray-200 text-gray-700'}`} />
                  </td>
                  <td className="px-4 py-3"><button onClick={() => toggleActive(product.id)} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${activeStates[product.id] ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{activeStates[product.id] ? 'Actif' : 'Inactif'}</button></td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Link href={`/admin/catalogue/${product.id}`} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">Modifier</Link>
                      <ActionMenu product={product} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 md:hidden">
        {loading ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">Chargement…</div>
        ) : products.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">Aucun produit trouvé.</div>
        ) : products.map((product) => {
          const stock = stockValues[product.id] ?? product.stock;
          return (
            <div key={product.id} className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
              <div className="flex gap-3">
                <button onClick={() => toggleSelection(product.id)} className="self-start pt-1"><input type="checkbox" checked={selected.has(product.id)} readOnly aria-label={`Sélectionner ${product.name}`} /></button>
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-100">{product.image_url ? <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" /> : <IconPhoto size={22} className="text-gray-300" />}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate font-semibold text-gray-950">{product.name}</p><p className="truncate text-xs text-gray-400">{product.categories?.name ?? 'Sans catégorie'}</p></div>
                    <button onClick={() => toggleActive(product.id)} className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${activeStates[product.id] ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{activeStates[product.id] ? 'Actif' : 'Inactif'}</button>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-sm"><span className="font-semibold text-gray-900">{formatPrice(product.price, tenantCurrency)}</span><span className={stock === 0 ? 'font-semibold text-red-600' : stock < 10 ? 'font-semibold text-amber-700' : 'text-gray-500'}>Stock {stock}</span>{product.description_source === 'ai' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">IA</span>}</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-2 border-t border-gray-100 pt-3">
                <input type="number" min={0} value={stock} onChange={(e) => setStockValues((prev) => ({ ...prev, [product.id]: Math.max(0, Number(e.target.value) || 0) }))} onBlur={(e) => saveStock(product.id, Math.max(0, Number(e.target.value) || 0))} className="min-h-10 rounded-xl border border-gray-200 px-3 text-sm" aria-label={`Stock ${product.name}`} />
                <Link href={`/admin/catalogue/${product.id}`} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700">Modifier</Link>
                <ActionMenu product={product} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2">
        <span className="text-xs text-gray-500">Page {page} sur {pageCount}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading} className="rounded-lg border border-gray-200 p-2 disabled:opacity-40" aria-label="Page précédente"><IconChevronLeft size={17} /></button>
          <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount || loading} className="rounded-lg border border-gray-200 p-2 disabled:opacity-40" aria-label="Page suivante"><IconChevronRight size={17} /></button>
        </div>
      </div>

      {feedback && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl bg-gray-950 px-4 py-3 text-sm font-medium text-white shadow-xl">
          {feedback.startsWith('Erreur') || feedback.includes('échoué') ? <IconAlertTriangle size={16} /> : <IconCheck size={16} />}
          {feedback}
        </div>
      )}
    </div>
  );
}
