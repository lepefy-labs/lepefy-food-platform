'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IconLoader2,
  IconPackage,
  IconPlus,
  IconSearch,
  IconTrash,
} from '@tabler/icons-react';
import type { ProductRelationshipType } from '@/lib/catalog/productRelationships';

interface RelatedProduct {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  stock: number;
  active: boolean;
  category: { name: string } | { name: string }[] | null;
}

interface ManagedRelationship {
  id: string;
  target_product_id: string;
  relationship_type: ProductRelationshipType;
  priority: number;
  active: boolean;
  source: 'manual' | 'system';
  product: RelatedProduct;
}

interface SearchProduct {
  id: string;
  name: string;
  stock: number;
  active: boolean;
  categories: { name: string; slug: string } | { name: string; slug: string }[] | null;
}

const GROUPS: Array<{
  type: ProductRelationshipType;
  title: string;
  description: string;
}> = [
  {
    type: 'similar',
    title: 'Produits similaires',
    description: 'Répondent à un besoin comparable.',
  },
  {
    type: 'substitute',
    title: 'Produits de remplacement',
    description: 'Alternatives sûres si ce produit est indisponible.',
  },
  {
    type: 'complementary',
    title: 'Produits complémentaires',
    description: 'Produits utiles avec celui-ci.',
  },
];

function categoryName(category: RelatedProduct['category'] | SearchProduct['categories']): string {
  if (Array.isArray(category)) return category[0]?.name ?? 'Sans catégorie';
  return category?.name ?? 'Sans catégorie';
}

function productStatus(product: Pick<RelatedProduct, 'active' | 'stock'>): {
  label: string;
  className: string;
} {
  if (!product.active) return { label: 'Inactif', className: 'bg-gray-100 text-gray-600' };
  if (product.stock <= 0) return { label: 'Épuisé', className: 'bg-red-50 text-red-700' };
  return { label: 'Disponible', className: 'bg-emerald-50 text-emerald-700' };
}

export default function ProductRelationshipsEditor({ productId }: { productId: string }) {
  const [relationships, setRelationships] = useState<ManagedRelationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingType, setAddingType] = useState<ProductRelationshipType | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const loadRelationships = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/catalogue/${productId}/relationships`, {
        cache: 'no-store',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? 'Chargement impossible.');
      setRelationships(Array.isArray(data?.relationships) ? data.relationships : []);
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : 'Chargement impossible.',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void loadRelationships();
  }, [loadRelationships]);

  useEffect(() => {
    if (!addingType || query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({
          q: query.trim(),
          limit: '25',
          status: 'all',
        });
        const response = await fetch(`/api/admin/catalogue?${params}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error ?? 'Recherche impossible.');
        setResults(
          (Array.isArray(data?.products) ? data.products : [])
            .filter((product: SearchProduct) => product.id !== productId),
        );
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          setMessage({ text: 'Recherche impossible.', type: 'error' });
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [addingType, productId, query]);

  const relationshipKeys = useMemo(
    () => new Set(relationships.map((item) => `${item.relationship_type}:${item.target_product_id}`)),
    [relationships],
  );

  async function addRelationship(type: ProductRelationshipType, targetProductId: string) {
    setBusyId(targetProductId);
    setMessage(null);
    const highest = relationships
      .filter((item) => item.relationship_type === type)
      .reduce((max, item) => Math.max(max, item.priority), 0);

    try {
      const response = await fetch(`/api/admin/catalogue/${productId}/relationships`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relationshipType: type,
          targetProductId,
          priority: highest + 10,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? 'Ajout impossible.');
      setQuery('');
      setAddingType(null);
      setMessage({ text: 'Produit associé.', type: 'success' });
      await loadRelationships();
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : 'Ajout impossible.',
        type: 'error',
      });
    } finally {
      setBusyId(null);
    }
  }

  async function updateRelationship(
    relationship: ManagedRelationship,
    patch: { priority?: number; active?: boolean },
  ) {
    const next = relationships.map((item) => (
      item.id === relationship.id ? { ...item, ...patch } : item
    ));
    setRelationships(next);
    setBusyId(relationship.id);

    try {
      const response = await fetch(
        `/api/admin/catalogue/${productId}/relationships/${relationship.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        },
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? 'Modification impossible.');
      setMessage({ text: 'Relation mise à jour.', type: 'success' });
    } catch (error) {
      setRelationships(relationships);
      setMessage({
        text: error instanceof Error ? error.message : 'Modification impossible.',
        type: 'error',
      });
    } finally {
      setBusyId(null);
    }
  }

  async function removeRelationship(relationship: ManagedRelationship) {
    setBusyId(relationship.id);
    try {
      const response = await fetch(
        `/api/admin/catalogue/${productId}/relationships/${relationship.id}`,
        { method: 'DELETE' },
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? 'Suppression impossible.');
      setRelationships((current) => current.filter((item) => item.id !== relationship.id));
      setMessage({ text: 'Relation supprimée.', type: 'success' });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : 'Suppression impossible.',
        type: 'error',
      });
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-xl border border-gray-200 bg-white">
        <IconLoader2 className="animate-spin text-[var(--color-primary)] motion-reduce:animate-none" aria-hidden="true" />
        <span className="ml-2 text-sm text-gray-500">Chargement des produits associés…</span>
      </div>
    );
  }

  return (
    <section aria-labelledby="relationships-heading" className="space-y-4">
      <div>
        <h2 id="relationships-heading" className="text-lg font-semibold text-gray-900">
          Produits associés
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Les relations sont directionnelles. Une priorité plus élevée est proposée en premier.
        </p>
      </div>

      {message && (
        <p
          role={message.type === 'error' ? 'alert' : 'status'}
          className={`rounded-lg px-3 py-2 text-sm ${
            message.type === 'error'
              ? 'bg-red-50 text-red-700'
              : 'bg-emerald-50 text-emerald-700'
          }`}
        >
          {message.text}
        </p>
      )}

      {GROUPS.map((group) => {
        const items = relationships
          .filter((item) => item.relationship_type === group.type)
          .sort((left, right) => right.priority - left.priority);

        return (
          <div key={group.type} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">{group.title}</h3>
                <p className="mt-0.5 text-xs text-gray-500">{group.description}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAddingType((current) => current === group.type ? null : group.type);
                  setQuery('');
                  setResults([]);
                }}
                aria-expanded={addingType === group.type}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--color-primary)] px-3 text-sm font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary-light)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              >
                <IconPlus size={17} aria-hidden="true" />
                Ajouter
              </button>
            </div>

            {addingType === group.type && (
              <div className="border-b border-gray-100 bg-gray-50 p-4">
                <label htmlFor={`relationship-search-${group.type}`} className="text-xs font-medium text-gray-700">
                  Rechercher un produit
                </label>
                <div className="relative mt-1">
                  <IconSearch
                    size={17}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    id={`relationship-search-${group.type}`}
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Nom, slug ou code-barres"
                    autoComplete="off"
                    className="min-h-11 w-full rounded-lg border border-gray-200 bg-white py-2 pl-10 pr-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] sm:text-sm"
                  />
                  {searching && (
                    <IconLoader2
                      size={17}
                      aria-hidden="true"
                      className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400 motion-reduce:animate-none"
                    />
                  )}
                </div>

                {query.trim().length >= 2 && !searching && (
                  <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                    {results.length === 0 ? (
                      <p className="p-3 text-sm text-gray-500">Aucun produit trouvé.</p>
                    ) : results.map((product) => {
                      const status = productStatus(product);
                      const duplicate = relationshipKeys.has(`${group.type}:${product.id}`);
                      return (
                        <button
                          key={product.id}
                          type="button"
                          disabled={duplicate || busyId === product.id}
                          onClick={() => void addRelationship(group.type, product.id)}
                          className="flex min-h-14 w-full items-center gap-3 border-b border-gray-100 px-3 py-2 text-left last:border-b-0 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--color-primary)] disabled:cursor-default disabled:opacity-55"
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                            <IconPackage size={19} aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-gray-900">{product.name}</span>
                            <span className="block truncate text-xs text-gray-500">{categoryName(product.categories)}</span>
                          </span>
                          <span className={`rounded-full px-2 py-1 text-xs font-medium ${status.className}`}>
                            {duplicate ? 'Déjà ajouté' : status.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {items.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">Aucun produit configuré.</p>
            ) : (
              <ul>
                {items.map((relationship) => {
                  const status = productStatus(relationship.product);
                  return (
                    <li
                      key={relationship.id}
                      className="grid gap-3 border-b border-gray-100 p-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_110px_110px_44px] sm:items-center"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                          <IconPackage size={20} aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-gray-900">{relationship.product.name}</p>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            <span className="text-xs text-gray-500">{categoryName(relationship.product.category)}</span>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>
                              {status.label}
                            </span>
                          </div>
                        </div>
                      </div>

                      <label className="text-xs font-medium text-gray-600">
                        Priorité
                        <input
                          type="number"
                          min={0}
                          max={9999}
                          value={relationship.priority}
                          onChange={(event) => {
                            const priority = Math.max(0, Number.parseInt(event.target.value, 10) || 0);
                            setRelationships((current) => current.map((item) => (
                              item.id === relationship.id ? { ...item, priority } : item
                            )));
                          }}
                          onBlur={(event) => void updateRelationship(relationship, {
                            priority: Math.max(0, Number.parseInt(event.target.value, 10) || 0),
                          })}
                          className="mt-1 min-h-11 w-full rounded-lg border border-gray-200 px-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] sm:text-sm"
                        />
                      </label>

                      <button
                        type="button"
                        aria-pressed={relationship.active}
                        disabled={busyId === relationship.id}
                        onClick={() => void updateRelationship(relationship, { active: !relationship.active })}
                        className={`min-h-11 rounded-lg px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] ${
                          relationship.active
                            ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {relationship.active ? 'Active' : 'Désactivée'}
                      </button>

                      <button
                        type="button"
                        aria-label={`Supprimer la relation avec ${relationship.product.name}`}
                        disabled={busyId === relationship.id}
                        onClick={() => void removeRelationship(relationship)}
                        className="flex h-11 w-11 items-center justify-center rounded-lg text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
                      >
                        {busyId === relationship.id
                          ? <IconLoader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                          : <IconTrash size={18} aria-hidden="true" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
