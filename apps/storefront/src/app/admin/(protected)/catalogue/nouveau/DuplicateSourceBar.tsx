'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { IconCopyPlus, IconPhoto, IconSearch } from '@tabler/icons-react';
import type { CatalogueListProduct } from '@/lib/catalog/catalogueList';
import { formatMoney, pluralize } from '@/lib/admin/format';
import { LepefyImage } from '@/components/images/LepefyImage';
import Button, { ButtonLink } from '../../../_components/ui/Button';
import Dialog from '../../../_components/ui/Dialog';
import InlineAlert from '../../../_components/ui/InlineAlert';
import { EmptyState, ErrorState, Skeleton } from '../../../_components/ui/States';
import { controlClasses } from '../../../_components/ui/Form';

const PICKER_PAGE_SIZE = 10;

type PickerProduct = Pick<CatalogueListProduct, 'id' | 'name' | 'price' | 'active' | 'image_url' | 'net_quantity_display' | 'categories'>;

interface Props {
  /** Produit d'origine relu côté serveur dans ce tenant ; null = création vide. */
  source: { id: string; name: string } | null;
  /** `duplicateFrom` présent mais invalide, introuvable ou d'un autre tenant. */
  sourceMissing: boolean;
  tenantCurrency: string;
}

/**
 * Création par duplication sur `/admin/catalogue/nouveau` : bandeau « Création à partir de »
 * et sélecteur de produit (recherche serveur paginée via GET /api/admin/catalogue).
 * Choisir un produit ne crée rien : il recharge la page avec `?duplicateFrom=<id>`.
 */
export default function DuplicateSourceBar({ source, sourceMissing, tenantCurrency }: Props) {
  const [open, setOpen] = useState(false);
  const picker = (
    <DuplicateSourcePicker open={open} onClose={() => setOpen(false)} currentId={source?.id ?? null} tenantCurrency={tenantCurrency} />
  );

  if (source) {
    return (
      <>
        <InlineAlert
          tone="info"
          className="mb-4"
          title={<>Création à partir de : <Link href={`/admin/catalogue/${source.id}`} className="underline">{source.name}</Link></>}
          action={(
            <span className="flex flex-col gap-2 sm:flex-row">
              <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Autre produit</Button>
              <ButtonLink href="/admin/catalogue/nouveau" variant="secondary" size="sm">Repartir de zéro</ButtonLink>
            </span>
          )}
        >
          À vérifier : nom, format, prix, stock et quantité minimale. Le nouveau produit démarre inactif, stock 0, sans promotion ni campagne ;
          l’original n’est pas modifié.
        </InlineAlert>
        {picker}
      </>
    );
  }

  return (
    <>
      {sourceMissing && (
        <InlineAlert tone="warning" className="mb-4" title="Produit d’origine introuvable">
          Il a peut-être été supprimé. Vous pouvez créer un produit vide ou en choisir un autre.
        </InlineAlert>
      )}
      <div className="mb-4 flex justify-end">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <IconCopyPlus size={16} aria-hidden="true" />
          Créer à partir d’un produit existant
        </Button>
      </div>
      {picker}
    </>
  );
}

function DuplicateSourcePicker({ open, onClose, currentId, tenantCurrency }: {
  open: boolean;
  onClose: () => void;
  currentId: string | null;
  tenantCurrency: string;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [products, setProducts] = useState<PickerProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [retry, setRetry] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus('loading');
      try {
        const params = new URLSearchParams({ limit: String(PICKER_PAGE_SIZE), page: String(page), sort: 'name_asc' });
        if (query.trim()) params.set('q', query.trim());
        const res = await fetch(`/api/admin/catalogue?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error('load');
        const data = await res.json() as { products: PickerProduct[]; total: number };
        setProducts((previous) => (page === 1 ? data.products : [...previous, ...data.products.filter((p) => !previous.some((q) => q.id === p.id))]));
        setTotal(data.total);
        setStatus('ready');
      } catch {
        if (!controller.signal.aborted) setStatus('error');
      }
    }, page === 1 ? 250 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [open, query, page, retry]);

  const firstLoad = status === 'loading' && page === 1;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Choisir le produit à dupliquer"
      description="Ses informations pré-remplissent la création. Rien n’est enregistré avant « Créer le produit »."
    >
      <label htmlFor="duplicate-source-search" className="sr-only">Rechercher un produit</label>
      <div className="relative">
        <IconSearch size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-a-text-3" />
        <input
          ref={inputRef}
          id="duplicate-source-search"
          type="search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setPage(1); }}
          placeholder="Nom, slug ou code-barres"
          autoComplete="off"
          className={`${controlClasses} pl-9`}
        />
      </div>

      <div className="mt-3" aria-live="polite" aria-busy={status === 'loading'}>
        {firstLoad && (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((row) => <Skeleton key={row} className="h-14 w-full" />)}
          </div>
        )}
        {status === 'error' && page === 1 && (
          <ErrorState
            title="Impossible de charger les produits."
            action={<Button variant="secondary" onClick={() => setRetry((value) => value + 1)}>Réessayer</Button>}
          />
        )}
        {status === 'ready' && products.length === 0 && (
          <EmptyState variant="filtered" title="Aucun produit trouvé." description="Essayez un autre nom ou le code-barres." />
        )}
        {!firstLoad && products.length > 0 && (
          <>
            <p className="mb-2 text-xs text-a-text-3">{pluralize(total, 'produit')}</p>
            <ul className="divide-y divide-a-border rounded-lg border border-a-border">
              {products.map((product) => {
                const current = product.id === currentId;
                return (
                  <li key={product.id}>
                    <Link
                      href={`/admin/catalogue/nouveau?duplicateFrom=${product.id}`}
                      onClick={onClose}
                      aria-current={current ? 'true' : undefined}
                      className={`flex min-h-14 items-center gap-3 px-3 py-2 hover:bg-a-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus ${current ? 'bg-a-selected' : ''}`}
                    >
                      <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-a-surface-2">
                        {product.image_url
                          ? <LepefyImage src={product.image_url} variant="thumbnail" alt="" fill sizes="44px" className="object-cover" />
                          : <IconPhoto size={18} aria-hidden="true" className="text-a-text-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-a-text">{product.name}</span>
                        <span className="block truncate text-xs text-a-text-3">
                          {[product.categories?.name ?? 'Sans catégorie', product.net_quantity_display, product.active ? null : 'Inactif'].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(product.price, tenantCurrency)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {status === 'error' && page > 1 && (
              <InlineAlert tone="danger" className="mt-3" action={<Button variant="ghost" size="sm" onClick={() => setRetry((value) => value + 1)}>Réessayer</Button>}>
                La suite n’a pas pu être chargée.
              </InlineAlert>
            )}
            {products.length < total && status !== 'error' && (
              <div className="mt-3 flex justify-center">
                <Button variant="secondary" size="sm" loading={status === 'loading'} onClick={() => setPage((value) => value + 1)}>
                  Afficher plus
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
