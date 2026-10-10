'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconCopy, IconDotsVertical, IconPhoto, IconSparkles } from '@tabler/icons-react';
import { completenessIssues, stockTone } from '@/lib/catalog/catalogueFilters';
import type { CatalogueListProduct as Product } from '@/lib/catalog/catalogueList';
import { formatMoney } from '@/lib/admin/format';
import { cn } from '@/lib/utils/cn';
import Badge from '../../_components/ui/Badge';
import Button, { buttonClasses } from '../../_components/ui/Button';
import Menu, { MenuButton } from '../../_components/ui/Menu';
import { useAdminToast } from '../../_components/ui/Toaster';
import { EmptyState } from '../../_components/ui/States';
import DataTable, { type DataColumn } from '../../_components/data/DataTable';
import { BulkBar, RowSelectionProvider } from '../../_components/data/RowSelection';

interface Props {
  products: Product[];
  tenantCurrency: string;
  /** catalog.manage: inline stock/status edits, bulk actions. */
  canManage: boolean;
  /** Current list query string: the editor's back link returns to this view. */
  listQuery: string;
  hasFilters: boolean;
  resetHref: string;
}

const STOCK_INPUT_TONE = {
  out: 'border-tone-danger-border bg-tone-danger-bg text-tone-danger-fg',
  low: 'border-tone-warning-border bg-tone-warning-bg text-tone-warning-fg',
  ok: 'border-a-border-strong bg-a-surface text-a-text',
} as const;

export default function CatalogueTable({ products, tenantCurrency, canManage, listQuery, hasFilters, resetHref }: Props) {
  const router = useRouter();
  const toast = useAdminToast();
  const [stockValues, setStockValues] = useState<Record<string, string>>({});
  const [stocks, setStocks] = useState<Record<string, number>>({});
  const [activeStates, setActiveStates] = useState<Record<string, boolean>>({});
  const rowIds = useMemo(() => products.map((product) => product.id), [products]);

  // Server data wins after every navigation / refresh.
  useEffect(() => {
    setStockValues(Object.fromEntries(products.map((p) => [p.id, String(p.stock)])));
    setStocks(Object.fromEntries(products.map((p) => [p.id, p.stock])));
    setActiveStates(Object.fromEntries(products.map((p) => [p.id, p.active])));
  }, [products]);

  const editorHref = (id: string) => (listQuery ? `/admin/catalogue/${id}?from=${encodeURIComponent(listQuery)}` : `/admin/catalogue/${id}`);

  async function patchProduct(productId: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/admin/catalogue/${productId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error('Mise à jour échouée');
  }

  async function toggleActive(product: Product) {
    const current = activeStates[product.id] ?? product.active;
    setActiveStates((prev) => ({ ...prev, [product.id]: !current }));
    try {
      await patchProduct(product.id, { active: !current });
      toast.success(!current ? `« ${product.name} » est en ligne` : `« ${product.name} » est masqué de la boutique`);
    } catch {
      setActiveStates((prev) => ({ ...prev, [product.id]: current }));
      toast.error('Le statut n’a pas pu être enregistré. Réessayez.');
    }
  }

  async function copySlug(slug: string) {
    try {
      await navigator.clipboard.writeText(slug);
      toast.success('Slug copié');
    } catch {
      toast.error('Copie impossible : sélectionnez le slug manuellement.');
    }
  }

  // Saved only when the value really changed (Enter or leaving the field); Escape restores it.
  async function commitStock(product: Product) {
    const saved = stocks[product.id] ?? product.stock;
    const raw = stockValues[product.id] ?? String(saved);
    const next = Math.max(0, Math.floor(Number(raw)));
    if (raw.trim() === '' || !Number.isFinite(next) || next === saved) { setStockValues((prev) => ({ ...prev, [product.id]: String(saved) })); return; }
    setStockValues((prev) => ({ ...prev, [product.id]: String(next) }));
    try {
      await patchProduct(product.id, { stock: next });
      setStocks((prev) => ({ ...prev, [product.id]: next }));
      toast.success(`Stock de « ${product.name} » : ${next}`);
    } catch {
      setStockValues((prev) => ({ ...prev, [product.id]: String(saved) }));
      toast.error('Le stock n’a pas pu être enregistré. Réessayez.');
    }
  }

  async function bulkSetActive(ids: string[], value: boolean, clear: () => void) {
    const previous = { ...activeStates };
    setActiveStates((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, value])) }));
    const results = await Promise.allSettled(ids.map((id) => patchProduct(id, { active: value })));
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed > 0) {
      setActiveStates(previous);
      toast.error(`${failed} produit${failed > 1 ? 's' : ''} sur ${ids.length} n’ont pas pu être mis à jour.`);
    } else {
      toast.success(`${ids.length} produit${ids.length > 1 ? 's' : ''} ${value ? 'activé' : 'désactivé'}${ids.length > 1 ? 's' : ''}`);
      clear();
    }
    router.refresh();
  }

  function statusControl(product: Product) {
    const active = activeStates[product.id] ?? product.active;
    const badge = <Badge tone={active ? 'success' : 'neutral'} dot>{active ? 'Actif' : 'Inactif'}</Badge>;
    if (!canManage) return badge;
    return (
      <button type="button" onClick={() => void toggleActive(product)} aria-label={`${active ? 'Désactiver' : 'Activer'} ${product.name}`}
        title={active ? 'Cliquer pour masquer de la boutique' : 'Cliquer pour mettre en ligne'} className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus">
        {badge}
      </button>
    );
  }

  function stockControl(product: Product, full = false) {
    const value = stockValues[product.id] ?? String(product.stock);
    const tone = STOCK_INPUT_TONE[stockTone(Number(value) || 0)];
    if (!canManage) return <span className={cn('inline-block min-w-14 rounded-lg border px-2 py-1.5 text-center text-sm font-semibold tabular-nums', tone)}>{product.stock}</span>;
    return (
      <input type="number" min={0} inputMode="numeric" value={value} aria-label={`Stock ${product.name}`}
        onChange={(event) => setStockValues((prev) => ({ ...prev, [product.id]: event.target.value }))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
          if (event.key === 'Escape') {
            setStockValues((prev) => ({ ...prev, [product.id]: String(stocks[product.id] ?? product.stock) }));
            event.currentTarget.dataset.cancelled = 'true';
            event.currentTarget.blur();
          }
        }}
        onBlur={(event) => {
          if (event.currentTarget.dataset.cancelled === 'true') { delete event.currentTarget.dataset.cancelled; return; }
          void commitStock(product);
        }}
        className={cn('min-h-9 rounded-lg border text-center text-sm font-semibold tabular-nums focus:outline focus:outline-2 focus:outline-a-focus', full ? 'w-full px-3' : 'w-20 px-2', tone)} />
    );
  }

  function actions(product: Product) {
    const active = activeStates[product.id] ?? product.active;
    return (
      <div className="inline-flex items-center gap-1">
        <Link href={editorHref(product.id)} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>{canManage ? 'Modifier' : 'Voir'}<span className="sr-only"> {product.name}</span></Link>
        <Menu label={`Plus d’actions pour ${product.name}`} triggerClassName={buttonClasses({ variant: 'ghost', size: 'sm' })} trigger={<IconDotsVertical size={16} aria-hidden="true" />}>
          {canManage && <MenuButton onSelect={() => void toggleActive(product)}>{active ? 'Désactiver' : 'Activer'}</MenuButton>}
          <MenuButton onSelect={() => void copySlug(product.slug)}><IconCopy size={16} aria-hidden="true" />Copier le slug</MenuButton>
        </Menu>
      </div>
    );
  }

  function thumbnail(product: Product, size: 'sm' | 'lg') {
    return (
      <span className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-a-surface-2', size === 'sm' ? 'h-11 w-11' : 'h-16 w-16')}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {product.image_url ? <img src={product.image_url} alt="" className="h-full w-full object-cover" /> : <IconPhoto size={20} aria-hidden="true" className="text-a-text-3" />}
      </span>
    );
  }

  function issues(product: Product) {
    const list = completenessIssues(product);
    if (product.description_source !== 'ai' && list.length === 0) return null;
    return (
      <span className="mt-1 flex flex-wrap gap-1">
        {product.description_source === 'ai' && <Badge tone="warning" icon={<IconSparkles size={12} aria-hidden="true" />}>IA à revoir</Badge>}
        {list.map((issue) => <Badge key={issue} tone="warning">{issue}</Badge>)}
      </span>
    );
  }

  const columns: DataColumn<Product>[] = [
    { key: 'product', header: 'Produit', className: 'min-w-[260px]', cell: (product) => (
      <div className="flex items-center gap-3">
        {thumbnail(product, 'sm')}
        <div className="min-w-0">
          <Link href={editorHref(product.id)} className="block truncate font-semibold hover:underline">{product.name}</Link>
          <p className="truncate font-mono text-xs text-a-text-3">{product.slug}</p>
          {issues(product)}
        </div>
      </div>
    ) },
    { key: 'category', header: 'Catégorie', cell: (product) => <span className="text-a-text-2">{product.categories?.name ?? '—'}</span> },
    { key: 'price', header: 'Prix', align: 'right', cell: (product) => <span className="font-semibold">{formatMoney(product.price, tenantCurrency)}</span> },
    { key: 'stock', header: 'Stock', align: 'right', cell: (product) => stockControl(product) },
    { key: 'status', header: 'Statut', cell: statusControl },
    { key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', cell: actions },
  ];

  return (
    <RowSelectionProvider rowIds={rowIds}>
      <DataTable<Product>
        caption="Produits du catalogue"
        columns={columns}
        rowKey={(product) => product.id}
        rows={products}
        selectable={canManage ? { label: (product) => `Sélectionner ${product.name}` } : undefined}
        rowClassName={(product) => ((activeStates[product.id] ?? product.active) ? undefined : 'text-a-text-2')}
        mobileCard={(product) => (
          <div className="p-3">
            <div className="flex gap-3">
              {thumbnail(product, 'lg')}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={editorHref(product.id)} className="block truncate font-semibold">{product.name}</Link>
                    <p className="truncate text-xs text-a-text-3">{product.categories?.name ?? 'Sans catégorie'}</p>
                  </div>
                  {statusControl(product)}
                </div>
                <p className="mt-1 text-sm font-semibold">{formatMoney(product.price, tenantCurrency)}</p>
                {issues(product)}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-2 border-t border-a-border pt-3">
              <label className="flex items-center gap-2 text-sm text-a-text-2"><span className="shrink-0">Stock</span>{stockControl(product, true)}</label>
              {actions(product)}
            </div>
          </div>
        )}
        empty={hasFilters
          ? <EmptyState variant="filtered" title="Aucun produit ne correspond à ces filtres." description="Modifiez la recherche, le statut ou la catégorie." action={<Link href={resetHref} className={buttonClasses({ variant: 'secondary' })}>Réinitialiser</Link>} />
          : <EmptyState title="Le catalogue est vide." description="Ajoutez un premier produit pour le voir apparaître ici et sur la boutique." action={canManage ? <Link href="/admin/catalogue/nouveau" className={buttonClasses()}>Nouveau produit</Link> : undefined} />}
      />
      {canManage && (
        <BulkBar rowIds={rowIds} noun="produit sélectionné" nounPlural="produits sélectionnés">
          {(ids, clear) => <>
            <Button variant="secondary" size="sm" onClick={() => void bulkSetActive(ids, true, clear)}>Activer</Button>
            <Button variant="secondary" size="sm" onClick={() => void bulkSetActive(ids, false, clear)}>Désactiver</Button>
          </>}
        </BulkBar>
      )}
    </RowSelectionProvider>
  );
}
