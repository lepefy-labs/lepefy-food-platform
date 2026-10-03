'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
import {
  CATALOGUE_STATUS_OPTIONS, catalogueQueryString, completenessIssues, parseCatalogueState, stockTone,
  type CatalogueListState, type CatalogueStatus,
} from '@/lib/catalog/catalogueFilters';

import type { CatalogCategoryOption as Category } from '@lepefy/types';

type Product = {
  id: string;
  name: string;
  slug: string;
  price: number;
  stock: number;
  active: boolean;
  weight_grams: number | null;
  category_id: string | null;
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
  counts: Partial<Record<CatalogueStatus, number | null>>;
};

interface Props {
  tenantCurrency: string;
  categories: Category[];
  /** catalog.manage: inline stock/status edits, bulk actions, new product. */
  canManage: boolean;
}

const PAGE_SIZE = 25;
const STOCK_TONES = {
  out: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  low: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
  ok: 'border-gray-200 text-gray-700',
};

function closeMenu(target: EventTarget & HTMLElement) {
  target.closest('details')?.removeAttribute('open');
}

export default function CatalogueTable({ tenantCurrency, categories, canManage }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Search, status, category, sort and page live in the URL: back from the
  // product editor returns to the same view.
  const state = parseCatalogueState(searchParams);
  const { q: urlQuery, status, category, sort, page } = state;

  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<ApiResponse['counts']>({});
  const [search, setSearch] = useState(urlQuery);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [stockValues, setStockValues] = useState<Record<string, string>>({});
  const [activeStates, setActiveStates] = useState<Record<string, boolean>>({});
  const [reloadKey, setReloadKey] = useState(0);

  const update = useCallback((patch: Partial<CatalogueListState>) => {
    const next = catalogueQueryString({ ...state, page: 1, ...patch });
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [pathname, router, state]);

  useEffect(() => { setSearch(urlQuery); }, [urlQuery]);
  useEffect(() => {
    if (search.trim() === urlQuery.trim()) return;
    const t = window.setTimeout(() => update({ q: search }), 300);
    return () => window.clearTimeout(t);
  }, [search, urlQuery, update]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), sort });
    if (urlQuery.trim()) params.set('q', urlQuery.trim());
    if (category) params.set('category', category);
    if (status !== 'all') params.set('status', status);

    setLoading(true);
    setError(null);
    fetch(`/api/admin/catalogue?${params.toString()}`, { signal: controller.signal, cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Impossible de charger le catalogue');
        return res.json() as Promise<ApiResponse>;
      })
      .then((data) => {
        setProducts(data.products);
        setTotal(data.total);
        setCounts(data.counts ?? {});
        setStockValues(Object.fromEntries(data.products.map((p) => [p.id, String(p.stock)])));
        setActiveStates(Object.fromEntries(data.products.map((p) => [p.id, p.active])));
        setSelected(new Set());
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Erreur de chargement');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [page, urlQuery, category, sort, status, reloadKey]);

  useEffect(() => {
    if (!feedback) return;
    const t = window.setTimeout(() => setFeedback(null), 2200);
    return () => window.clearTimeout(t);
  }, [feedback]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allSelected = products.length > 0 && products.every((p) => selected.has(p.id));

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

  // Saved only when the value really changed (Enter or leaving the field); Escape restores it.
  async function commitStock(product: Product) {
    const raw = stockValues[product.id] ?? String(product.stock);
    const nextValue = Math.max(0, Math.floor(Number(raw)));
    if (!Number.isFinite(nextValue) || raw.trim() === '') { setStockValues((prev) => ({ ...prev, [product.id]: String(product.stock) })); return; }
    if (nextValue === product.stock) { setStockValues((prev) => ({ ...prev, [product.id]: String(product.stock) })); return; }
    setStockValues((prev) => ({ ...prev, [product.id]: String(nextValue) }));
    try {
      await patchProduct(product.id, { stock: nextValue });
      setProducts((prev) => prev.map((p) => p.id === product.id ? { ...p, stock: nextValue } : p));
      setFeedback('Stock enregistré');
    } catch {
      setStockValues((prev) => ({ ...prev, [product.id]: String(product.stock) }));
      setFeedback('Erreur de mise à jour');
    }
  }

  function stockKeyDown(event: React.KeyboardEvent<HTMLInputElement>, product: Product) {
    if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
    if (event.key === 'Escape') {
      setStockValues((prev) => ({ ...prev, [product.id]: String(product.stock) }));
      event.currentTarget.dataset.cancelled = 'true';
      event.currentTarget.blur();
    }
  }

  function stockBlur(event: React.FocusEvent<HTMLInputElement>, product: Product) {
    if (event.currentTarget.dataset.cancelled === 'true') { delete event.currentTarget.dataset.cancelled; return; }
    void commitStock(product);
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
      setReloadKey((key) => key + 1);
    } catch {
      setActiveStates(previous);
      setFeedback('Une action groupée a échoué');
    }
  }

  const filtersActive = Boolean(category || status !== 'all' || sort !== 'position_asc' || urlQuery);
  const chipClass = (active: boolean) => `inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-[var(--admin-primary)] ${active ? 'border-[var(--admin-primary)] bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)]' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`;

  function countBadge(key: CatalogueStatus) {
    const value = counts[key];
    if (value === undefined || value === null) return null;
    const warn = (key === 'out' || key === 'low' || key === 'no_weight') && value > 0;
    return <span className={`rounded-full px-1.5 text-[10px] ${warn ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-500'}`}>{value}</span>;
  }

  function ActionMenu({ product }: { product: Product }) {
    const active = activeStates[product.id] ?? product.active;
    return (
      <details className="relative">
        <summary aria-label={`Plus d'actions pour ${product.name}`}
          className="flex min-h-10 min-w-10 cursor-pointer list-none items-center justify-center rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[var(--admin-primary)]">
          <IconDotsVertical size={16} aria-hidden="true" />
        </summary>
        <div className="absolute right-0 top-full z-40 mt-1 w-44 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 text-left shadow-xl">
          {canManage && (
            <button type="button" onClick={(e) => { closeMenu(e.currentTarget); void toggleActive(product.id); }}
              className="flex min-h-10 w-full items-center rounded-lg px-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
              {active ? 'Désactiver' : 'Activer'}
            </button>
          )}
          <button type="button" onClick={(e) => { closeMenu(e.currentTarget); void copySlug(product.slug); }}
            className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <IconCopy size={15} aria-hidden="true" /> Copier le slug
          </button>
        </div>
      </details>
    );
  }

  function statusControl(product: Product, compact = false) {
    const active = activeStates[product.id] ?? product.active;
    const className = `${compact ? 'shrink-0 px-2 py-1 text-[11px]' : 'px-2.5 py-1 text-xs'} rounded-full font-semibold ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`;
    if (!canManage) return <span className={className}>{active ? 'Actif' : 'Inactif'}</span>;
    return <button type="button" onClick={() => toggleActive(product.id)} aria-label={`${active ? 'Désactiver' : 'Activer'} ${product.name}`} className={className}>{active ? 'Actif' : 'Inactif'}</button>;
  }

  function stockControl(product: Product, compact = false) {
    const value = stockValues[product.id] ?? String(product.stock);
    const tone = STOCK_TONES[stockTone(Number(value) || 0)];
    if (!canManage) return <span className={`inline-block rounded-lg border px-2 py-1.5 text-center text-sm font-semibold ${compact ? '' : 'w-20'} ${tone}`}>{product.stock}</span>;
    return <input type="number" min={0} inputMode="numeric" value={value} aria-label={`Stock ${product.name}`}
      onChange={(e) => setStockValues((prev) => ({ ...prev, [product.id]: e.target.value }))}
      onKeyDown={(e) => stockKeyDown(e, product)} onBlur={(e) => stockBlur(e, product)}
      className={`${compact ? 'min-h-10 w-full rounded-xl px-3' : 'w-20 rounded-lg px-2 py-1.5 text-center'} border text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--admin-primary)] ${tone}`} />;
  }

  function issueBadges(product: Product) {
    return completenessIssues(product).map((issue) => (
      <span key={issue} className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">{issue}</span>
    ));
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 pb-24 md:pb-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-baseline gap-2">
            <h1 className="text-2xl font-bold text-gray-950">Catalogue</h1>
            <span className="text-sm text-gray-400">{counts.all ?? total} produits</span>
          </div>
          <p className="mt-1 text-sm text-gray-500">Gérez rapidement disponibilité, stock et contenu.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/catalogue/categories" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-semibold">Catégories</Link>
          <Link href="/admin/catalogue/quantity-groups" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-semibold">Règles de quantité</Link>
          {canManage && <Link href="/admin/catalogue/nouveau" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--admin-primary)] px-4 text-sm font-semibold text-white shadow-sm hover:opacity-90">
            <IconPlus size={18} aria-hidden="true" /> Nouveau produit
          </Link>}
        </div>
      </div>

      <div className="sticky top-0 z-20 space-y-3 rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-sm backdrop-blur md:static md:shadow-none">
        <div className="relative min-w-0">
          <IconSearch size={17} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} type="search" aria-label="Rechercher un produit" placeholder="Nom, slug ou code-barres" className="min-h-11 w-full rounded-xl border border-gray-200 bg-white pl-10 pr-10 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[var(--admin-primary)]" />
          {search && <button type="button" onClick={() => { setSearch(''); update({ q: '' }); }} aria-label="Effacer la recherche" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-gray-400 hover:bg-gray-100"><IconX size={16} aria-hidden="true" /></button>}
        </div>

        <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Filtrer par statut">
          {CATALOGUE_STATUS_OPTIONS.filter((option) => option.group === 'state').map((option) => (
            <button key={option.key} type="button" aria-pressed={status === option.key} onClick={() => update({ status: option.key })} className={chipClass(status === option.key)}>{option.label}{countBadge(option.key)}</button>
          ))}
        </nav>
        <nav className="flex flex-wrap items-center gap-2" aria-label="Produits à compléter">
          <span className="text-xs font-medium text-gray-500">À compléter :</span>
          {CATALOGUE_STATUS_OPTIONS.filter((option) => option.group === 'quality').map((option) => (
            <button key={option.key} type="button" aria-pressed={status === option.key} onClick={() => update({ status: status === option.key ? 'all' : option.key })} className={chipClass(status === option.key)}>{option.label}{countBadge(option.key)}</button>
          ))}
        </nav>

        <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
          <select value={category} onChange={(e) => update({ category: e.target.value })} aria-label="Catégorie" className="min-h-10 rounded-xl border border-gray-200 px-3 text-sm">
            <option value="">Toutes les catégories</option>
            {categories.map((c) => <option key={c.id} value={c.slug}>{c.name} — {c.catalog_scope === 'gadgets' ? 'Goodies' : 'Catalogue'}</option>)}
          </select>
          <select value={sort} onChange={(e) => update({ sort: e.target.value as CatalogueListState['sort'] })} aria-label="Tri" className="min-h-10 rounded-xl border border-gray-200 px-3 text-sm">
            <option value="position_asc">Ordre catalogue</option>
            <option value="name_asc">Nom A → Z</option>
            <option value="name_desc">Nom Z → A</option>
            <option value="price_asc">Prix croissant</option>
            <option value="price_desc">Prix décroissant</option>
            <option value="stock_asc">Stock croissant</option>
            <option value="stock_desc">Stock décroissant</option>
          </select>
          <button type="button" onClick={() => { setSearch(''); router.replace(pathname, { scroll: false }); }} disabled={!filtersActive} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-gray-200 px-3 text-sm text-gray-600 disabled:opacity-40">
            <IconAdjustments size={16} aria-hidden="true" /> Réinitialiser
          </button>
        </div>
      </div>

      {canManage && selected.size > 0 && (
        <div role="toolbar" aria-label="Actions groupées" className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--admin-primary)]/20 bg-[var(--admin-primary-soft)] p-3">
          <span className="mr-auto text-sm font-semibold text-gray-800">{selected.size} sélectionné{selected.size > 1 ? 's' : ''}</span>
          <button type="button" onClick={() => bulkSetActive(true)} className="min-h-10 rounded-lg border border-white bg-white px-3 text-xs font-semibold text-gray-700">Activer</button>
          <button type="button" onClick={() => bulkSetActive(false)} className="min-h-10 rounded-lg border border-white bg-white px-3 text-xs font-semibold text-gray-700">Désactiver</button>
          <button type="button" onClick={() => setSelected(new Set())} className="min-h-10 rounded-lg px-3 text-xs font-semibold text-gray-500">Annuler</button>
        </div>
      )}

      {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><IconAlertTriangle size={18} aria-hidden="true" /> {error} <button type="button" onClick={() => setReloadKey((key) => key + 1)} className="font-semibold underline">Réessayer</button></div>}

      <div className="hidden overflow-visible rounded-2xl border border-gray-200 bg-white md:block">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
            <tr>
              {canManage && <th scope="col" className="w-10 px-4 py-3"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Tout sélectionner" /></th>}
              <th scope="col" className="px-4 py-3">Produit</th>
              <th scope="col" className="px-4 py-3">Catégorie</th>
              <th scope="col" className="px-4 py-3">Prix</th>
              <th scope="col" className="px-4 py-3">Stock</th>
              <th scope="col" className="px-4 py-3">Statut</th>
              <th scope="col" className="w-32 px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className={`divide-y divide-gray-100 ${loading && products.length > 0 ? 'opacity-60' : ''}`} aria-busy={loading}>
            {loading && products.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">Chargement…</td></tr>
            ) : products.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">Aucun produit trouvé.</td></tr>
            ) : products.map((product) => (
              <tr key={product.id} className="hover:bg-gray-50/70">
                {canManage && <td className="px-4 py-3"><input type="checkbox" checked={selected.has(product.id)} onChange={() => toggleSelection(product.id)} aria-label={`Sélectionner ${product.name}`} /></td>}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {product.image_url ? <img src={product.image_url} alt="" className="h-full w-full object-cover" /> : <IconPhoto size={18} aria-hidden="true" className="text-gray-300" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5"><p className="truncate font-semibold text-gray-900">{product.name}</p>{product.description_source === 'ai' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">IA</span>}{issueBadges(product)}</div>
                      <p className="truncate font-mono text-xs text-gray-400">{product.slug}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">{product.categories?.name ?? '—'}</td>
                <td className="px-4 py-3 font-semibold text-gray-900">{formatPrice(product.price, tenantCurrency)}</td>
                <td className="px-4 py-3">{stockControl(product)}</td>
                <td className="px-4 py-3">{statusControl(product)}</td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-1">
                    <Link href={`/admin/catalogue/${product.id}`} className="inline-flex min-h-10 items-center rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50">{canManage ? 'Modifier' : 'Voir'}</Link>
                    <ActionMenu product={product} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 md:hidden" aria-label="Produits">
        {loading && products.length === 0 ? (
          <li className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">Chargement…</li>
        ) : products.length === 0 ? (
          <li className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">Aucun produit trouvé.</li>
        ) : products.map((product) => {
          const stock = Number(stockValues[product.id] ?? product.stock) || 0;
          const tone = stockTone(stock);
          return (
            <li key={product.id} className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
              <div className="flex gap-3">
                {canManage && (
                  <label className="flex min-h-11 min-w-8 items-start justify-center pt-1">
                    <span className="sr-only">Sélectionner {product.name}</span>
                    <input type="checkbox" checked={selected.has(product.id)} onChange={() => toggleSelection(product.id)} className="h-5 w-5" />
                  </label>
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-100">{product.image_url ? <img src={product.image_url} alt="" className="h-full w-full object-cover" /> : <IconPhoto size={22} aria-hidden="true" className="text-gray-300" />}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate font-semibold text-gray-950">{product.name}</p><p className="truncate text-xs text-gray-400">{product.categories?.name ?? 'Sans catégorie'}</p></div>
                    {statusControl(product, true)}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"><span className="font-semibold text-gray-900">{formatPrice(product.price, tenantCurrency)}</span><span className={tone === 'out' ? 'font-semibold text-red-600' : tone === 'low' ? 'font-semibold text-amber-700' : 'text-gray-500'}>Stock {stock}</span>{product.description_source === 'ai' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">IA</span>}{issueBadges(product)}</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-2 border-t border-gray-100 pt-3">
                {stockControl(product, true)}
                <Link href={`/admin/catalogue/${product.id}`} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700">{canManage ? 'Modifier' : 'Voir'}</Link>
                <ActionMenu product={product} />
              </div>
            </li>
          );
        })}
      </ul>

      <nav aria-label="Pagination du catalogue" className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2">
        <span className="text-xs text-gray-500">Page {page} sur {pageCount} · {total} produit{total > 1 ? 's' : ''}</span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => update({ page: Math.max(1, page - 1) })} disabled={page <= 1 || loading} className="min-h-10 min-w-10 rounded-lg border border-gray-200 p-2 disabled:opacity-40" aria-label="Page précédente"><IconChevronLeft size={17} aria-hidden="true" /></button>
          <button type="button" onClick={() => update({ page: Math.min(pageCount, page + 1) })} disabled={page >= pageCount || loading} className="min-h-10 min-w-10 rounded-lg border border-gray-200 p-2 disabled:opacity-40" aria-label="Page suivante"><IconChevronRight size={17} aria-hidden="true" /></button>
        </div>
      </nav>

      {feedback && (
        <div role="status" className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl bg-gray-950 px-4 py-3 text-sm font-medium text-white shadow-xl">
          {feedback.startsWith('Erreur') || feedback.includes('échoué') ? <IconAlertTriangle size={16} aria-hidden="true" /> : <IconCheck size={16} aria-hidden="true" />}
          {feedback}
        </div>
      )}
    </div>
  );
}
