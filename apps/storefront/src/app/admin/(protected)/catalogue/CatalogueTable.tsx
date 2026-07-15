'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useState, useRef } from 'react';
import { formatPrice } from '@/lib/utils/format';
import {
  IconSelector,
  IconSortAscending,
  IconSortDescending,
  IconPhoto,
  IconPlus,
  IconSearch,
  IconX,
} from '@tabler/icons-react';

interface Product {
  id: string;
  name: string;
  slug: string;
  price: number;
  stock: number;
  active: boolean;
  image_url: string | null;
  storage_type: string | null;
  description_source: 'ai' | 'human' | null;
  categories: { name: string; slug: string } | null;
}

interface CatalogueTableProps {
  products:         Product[];
  currentSort?:     string;
  currentCategory?: string;
  tenantCurrency:   string;
  searchMode:       'client' | 'server';
}

export default function CatalogueTable({
  products,
  currentSort,
  currentCategory,
  tenantCurrency,
  searchMode,
}: CatalogueTableProps) {
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  // ── Search ──────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');

  // ── Filtre "descriptions IA à revoir" ─────────────────────────────────
  const [aiReviewOnly, setAiReviewOnly] = useState(false);

  const searchedProducts = searchMode === 'client' && searchQuery.trim()
    ? products.filter(p =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.categories?.name ?? '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : products;

  const filteredProducts = aiReviewOnly
    ? searchedProducts.filter(p => p.description_source === 'ai')
    : searchedProducts;

  // ── Active toggle ────────────────────────────────────────────────────
  const [activeStates, setActiveStates] = useState<Record<string, boolean>>(
    () => Object.fromEntries(products.map(p => [p.id, p.active]))
  );

  async function handleToggleActive(productId: string) {
    const current = activeStates[productId] ?? false;
    const next    = !current;
    setActiveStates(prev => ({ ...prev, [productId]: next }));
    try {
      const res = await fetch(`/api/admin/catalogue/${productId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ active: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setActiveStates(prev => ({ ...prev, [productId]: current }));
    }
  }

  // ── Inline stock editing ─────────────────────────────────────────────
  const [editingStock, setEditingStock] = useState<string | null>(null);
  const [stockValues, setStockValues]   = useState<Record<string, number>>(
    () => Object.fromEntries(products.map(p => [p.id, p.stock]))
  );
  const stockInputRef = useRef<HTMLInputElement>(null);

  async function handleStockSave(productId: string) {
    const newStock = stockValues[productId] ?? 0;
    setEditingStock(null);
    try {
      await fetch(`/api/admin/catalogue/${productId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ stock: newStock }),
      });
    } catch {
      // no rollback — user can reload if needed
    }
  }

  function handleStockKeyDown(e: React.KeyboardEvent, productId: string) {
    if (e.key === 'Enter')  handleStockSave(productId);
    if (e.key === 'Escape') setEditingStock(null);
  }

  // ── Sort URL ─────────────────────────────────────────────────────────
  const buildSortUrl = useCallback((col: string) => {
    const params  = new URLSearchParams(searchParams.toString());
    const current = params.get('sort') ?? '';
    const next    = current === `${col}_asc` ? `${col}_desc` : `${col}_asc`;
    params.set('sort', next);
    return `${pathname}?${params.toString()}`;
  }, [pathname, searchParams]);

  function SortIcon({ col }: { col: string }) {
    if (currentSort === `${col}_asc`)
      return <IconSortAscending size={12} stroke={2} className="text-[var(--color-primary)]" />;
    if (currentSort === `${col}_desc`)
      return <IconSortDescending size={12} stroke={2} className="text-[var(--color-primary)]" />;
    return <IconSelector size={12} stroke={1.5} className="text-gray-400" />;
  }

  function thClass(col: string) {
    const isActive = currentSort?.startsWith(col);
    return `text-left text-xs font-medium uppercase tracking-wide
            cursor-pointer select-none whitespace-nowrap px-4 py-3
            hover:text-gray-700 transition-colors ${
      isActive ? 'text-[var(--color-primary)]' : 'text-gray-400'
    }`;
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-4">
        <div className="flex items-baseline gap-2 flex-shrink-0">
          <h1 className="text-xl font-bold text-gray-900">Catalogue</h1>
          <span className="text-sm text-gray-400">
            ({filteredProducts.length} produit{filteredProducts.length !== 1 ? 's' : ''})
          </span>
        </div>

        {/* Search input */}
        {searchMode === 'client' ? (
          <div className="relative flex-1 max-w-xs">
            <IconSearch
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Rechercher un produit..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200
                         rounded-lg focus:outline-none
                         focus:ring-2 focus:ring-[var(--color-primary)]
                         focus:border-transparent bg-white"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2
                           text-gray-400 hover:text-gray-600"
                aria-label="Effacer la recherche"
              >
                <IconX size={14} />
              </button>
            )}
          </div>
        ) : (
          <div className="relative flex-1 max-w-xs">
            <IconSearch
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300"
            />
            <input
              type="text"
              disabled
              placeholder="Rechercher..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-100
                         rounded-lg bg-gray-50 text-gray-300 cursor-not-allowed"
            />
          </div>
        )}

        <button
          onClick={() => setAiReviewOnly(v => !v)}
          className={`flex-shrink-0 flex items-center gap-1.5 text-xs px-3 py-2
                      rounded-lg font-medium border transition-colors ${
            aiReviewOnly
              ? 'bg-amber-100 text-amber-700 border-amber-200'
              : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
          }`}
        >
          Descriptions IA à revoir
        </button>

        <Link
          href="/admin/catalogue/nouveau"
          className="flex-shrink-0 flex items-center gap-2 bg-[var(--color-primary)]
                     text-white px-4 py-2 rounded-lg text-sm font-medium
                     hover:opacity-90 transition-opacity"
        >
          <IconPlus size={16} />
          Nouveau produit
        </Link>
      </div>

      {/* No search results */}
      {filteredProducts.length === 0 && searchQuery && (
        <p className="text-center text-gray-400 py-8 text-sm">
          Aucun produit trouvé pour « {searchQuery} »
        </p>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {filteredProducts.length === 0 && !searchQuery ? (
          <p className="text-center text-gray-400 py-12 text-sm">
            Aucun produit trouvé.
          </p>
        ) : filteredProducts.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 w-14"></th>

                  <th className={thClass('name')}>
                    <Link href={buildSortUrl('name')} className="inline-flex items-center gap-1">
                      Nom <SortIcon col="name" />
                    </Link>
                  </th>

                  <th className="text-left text-xs font-medium uppercase tracking-wide text-gray-400 px-4 py-3 whitespace-nowrap">
                    Catégorie
                  </th>

                  <th className={thClass('price')}>
                    <Link href={buildSortUrl('price')} className="inline-flex items-center gap-1">
                      Prix <SortIcon col="price" />
                    </Link>
                  </th>

                  <th className={thClass('stock')}>
                    <Link href={buildSortUrl('stock')} className="inline-flex items-center gap-1">
                      Stock <SortIcon col="stock" />
                    </Link>
                  </th>

                  <th className="text-left text-xs font-medium uppercase tracking-wide text-gray-400 px-4 py-3">
                    Statut
                  </th>

                  <th className="px-4 py-3"></th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-50">
                {filteredProducts.map((product) => {
                  const stockVal = stockValues[product.id] ?? product.stock;
                  const stockColorClass =
                    stockVal === 0 ? 'text-red-500'
                    : stockVal < 10 ? 'text-amber-600'
                    : 'text-gray-700';

                  const modifierHref = `/admin/catalogue/${product.id}${
                    currentCategory ? `?from_category=${currentCategory}` : ''
                  }`;

                  return (
                    <tr key={product.id} className="hover:bg-gray-50 transition-colors">
                      {/* Image */}
                      <td className="px-4 py-3">
                        <div className="w-9 h-9 rounded-lg bg-gray-100 overflow-hidden
                                        flex items-center justify-center flex-shrink-0">
                          {product.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={product.image_url}
                              alt={product.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <IconPhoto size={16} className="text-gray-300" />
                          )}
                        </div>
                      </td>

                      {/* Nom */}
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 leading-snug flex items-center gap-1.5">
                          {product.name}
                          {product.description_source === 'ai' && (
                            <span
                              title="Description générée par IA — à revoir"
                              className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold"
                            >
                              IA
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-400 font-mono mt-0.5">{product.slug}</p>
                      </td>

                      {/* Catégorie */}
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                          {product.categories?.name ?? '—'}
                        </span>
                      </td>

                      {/* Prix */}
                      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                        {formatPrice(product.price, tenantCurrency)}
                      </td>

                      {/* Stock — inline editable */}
                      <td className="px-4 py-3">
                        {editingStock === product.id ? (
                          <input
                            ref={stockInputRef}
                            type="number"
                            min={0}
                            value={stockValues[product.id] ?? product.stock}
                            onChange={e => setStockValues(prev => ({
                              ...prev,
                              [product.id]: parseInt(e.target.value, 10) || 0,
                            }))}
                            onBlur={() => handleStockSave(product.id)}
                            onKeyDown={e => handleStockKeyDown(e, product.id)}
                            className="w-16 px-2 py-1 text-sm border
                                       border-[var(--color-primary)] rounded-lg
                                       focus:outline-none focus:ring-1
                                       focus:ring-[var(--color-primary)] text-center"
                            autoFocus
                          />
                        ) : (
                          <button
                            onClick={() => setEditingStock(product.id)}
                            title="Cliquer pour modifier"
                            className={`text-sm font-medium cursor-pointer
                                        hover:underline decoration-dashed
                                        underline-offset-2 bg-transparent border-0
                                        p-0 ${stockColorClass}`}
                          >
                            {stockVal}
                          </button>
                        )}
                      </td>

                      {/* Statut — toggle inline */}
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleToggleActive(product.id)}
                          title={
                            activeStates[product.id]
                              ? 'Cliquer pour désactiver'
                              : 'Cliquer pour activer'
                          }
                          className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1
                                      rounded-full font-medium transition-colors cursor-pointer
                                      border-0 ${
                            activeStates[product.id]
                              ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}
                        >
                          {activeStates[product.id] ? 'Actif' : 'Inactif'}
                        </button>
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={modifierHref}
                          className="text-xs font-medium px-3 py-1.5 rounded-lg border
                                     border-gray-200 hover:bg-gray-50 transition-colors
                                     whitespace-nowrap"
                        >
                          Modifier →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
