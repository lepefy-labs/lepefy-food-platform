'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { formatPrice } from '@/lib/utils/format';
import {
  IconSelector,
  IconSortAscending,
  IconSortDescending,
  IconPhoto,
  IconPlus,
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
  categories: { name: string; slug: string } | null;
}

interface CatalogueTableProps {
  products:         Product[];
  currentSort?:     string;
  currentCategory?: string;
  tenantCurrency:   string;
}

export default function CatalogueTable({
  products,
  currentSort,
  tenantCurrency,
}: CatalogueTableProps) {
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  const buildSortUrl = useCallback((col: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const current = params.get('sort') ?? '';
    const next = current === `${col}_asc` ? `${col}_desc` : `${col}_asc`;
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
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-bold text-gray-900">Catalogue</h1>
          <span className="text-sm text-gray-400">
            ({products.length} produit{products.length !== 1 ? 's' : ''})
          </span>
        </div>
        <Link
          href="/admin/catalogue/nouveau"
          className="flex items-center gap-2 bg-[var(--color-primary)]
                     text-white px-4 py-2 rounded-lg text-sm font-medium
                     hover:opacity-90 transition-opacity"
        >
          <IconPlus size={16} />
          Nouveau produit
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {products.length === 0 ? (
          <p className="text-center text-gray-400 py-12 text-sm">
            Aucun produit trouvé.
          </p>
        ) : (
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
                {products.map((product) => {
                  const stockColor =
                    product.stock === 0 ? 'text-red-500 font-medium'
                    : product.stock < 10 ? 'text-amber-600 font-medium'
                    : 'text-gray-600';

                  return (
                    <tr key={product.id} className="hover:bg-gray-50 transition-colors">
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

                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 leading-snug">{product.name}</p>
                        <p className="text-xs text-gray-400 font-mono mt-0.5">{product.slug}</p>
                      </td>

                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                          {product.categories?.name ?? '—'}
                        </span>
                      </td>

                      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                        {formatPrice(product.price, tenantCurrency)}
                      </td>

                      <td className={`px-4 py-3 ${stockColor}`}>
                        {product.stock}
                      </td>

                      <td className="px-4 py-3">
                        {product.active ? (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-1
                                           rounded-full bg-[var(--color-primary-light)]
                                           text-[var(--color-primary)] font-medium">
                            Actif
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-1
                                           rounded-full bg-gray-100 text-gray-500">
                            Inactif
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/catalogue/${product.id}`}
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
        )}
      </div>
    </div>
  );
}
