import Link from 'next/link';
import { IconAdjustmentsHorizontal, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import { requireBusinessManagementPage } from '@/lib/gestion/featureGate';
import {
  MOVEMENT_PAGE_SIZE, STOCK_FILTERS, STOCK_PAGE_SIZE, getStockProduct, listMovements, listStockProducts, type StockFilter,
} from '@/lib/gestion/queries';
import { MOVEMENT_TYPES, MOVEMENT_TYPE_LABELS, PURCHASE_UNIT_LABELS, type MovementType, type Tone } from '@/lib/gestion/domain';
import { formatDate, formatDateTime, formatMoney, formatQuantity, formatQuantityWithUnit, formatStockUnits } from '@/lib/gestion/format';
import { Badge, Breadcrumb, CARD_CLS, EmptyState, INPUT_CLS, LABEL_CLS, Panel, PRIMARY_LINK_CLS } from '../_components/ui';
import { StockAdjustForm } from './StockAdjustForm';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

type SearchParams = { vue?: string; q?: string; filtre?: string; type?: string; du?: string; au?: string; produit?: string; page?: string; ajuster?: string };

const STOCK_FILTER_LABELS: Record<StockFilter, string> = {
  all: 'Tous les produits',
  with_movement: 'Avec mouvement',
  no_cost: 'Sans coût connu',
  out_of_stock: 'En rupture',
};

const MOVEMENT_TONES: Record<MovementType, Tone> = { supplier_receipt: 'success', manual_adjustment: 'info', reversal: 'warn' };

const isoDate = (value?: string) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined);
const uuidOrUndefined = (value?: string) => (value && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined);

function href(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const text = query.toString();
  return `/admin/gestion/stocks${text ? `?${text}` : ''}`;
}

function Pagination({ page, total, size, params }: { page: number; total: number; size: number; params: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  const link = 'inline-flex min-h-11 items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900';
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-2">
      {page > 1 ? <Link className={link} href={href({ ...params, page: String(page - 1) })}><IconChevronLeft size={16} aria-hidden="true" />Précédent</Link> : <span />}
      <span className="text-sm text-gray-600 dark:text-gray-300">Page {page} / {pages} • {total} résultat(s)</span>
      {page < pages ? <Link className={link} href={href({ ...params, page: String(page + 1) })}>Suivant<IconChevronRight size={16} aria-hidden="true" /></Link> : <span />}
    </nav>
  );
}

export default async function StocksPage({ searchParams }: { searchParams: SearchParams }) {
  const { tenant, can } = await requireBusinessManagementPage('inventory.view');
  const view = searchParams.vue === 'mouvements' ? 'mouvements' : 'produits';
  const q = (searchParams.q ?? '').slice(0, 80);
  const filter = (STOCK_FILTERS as readonly string[]).includes(searchParams.filtre ?? '') ? searchParams.filtre as StockFilter : 'all';
  const movementType = (MOVEMENT_TYPES as readonly string[]).includes(searchParams.type ?? '') ? searchParams.type as MovementType : undefined;
  const from = isoDate(searchParams.du);
  const to = isoDate(searchParams.au);
  const productId = uuidOrUndefined(searchParams.produit);
  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1);
  const adjustProductId = uuidOrUndefined(searchParams.ajuster);
  const showAdjust = can('inventory.manage') && Boolean(searchParams.ajuster);

  const [products, movements, adjustProduct, filterProduct] = await Promise.all([
    view === 'produits' ? listStockProducts(tenant.id, { q, filter, movementType, from, to, page }) : Promise.resolve(null),
    view === 'mouvements' ? listMovements(tenant.id, { productId, movementType, from, to, page }) : Promise.resolve(null),
    adjustProductId ? getStockProduct(tenant.id, adjustProductId) : Promise.resolve(null),
    productId ? getStockProduct(tenant.id, productId) : Promise.resolve(null),
  ]);

  const baseParams = { vue: view === 'mouvements' ? 'mouvements' : undefined, q: view === 'produits' ? q || undefined : undefined,
    filtre: view === 'produits' && filter !== 'all' ? filter : undefined, type: movementType, du: from, au: to,
    produit: view === 'mouvements' ? productId : undefined };
  const tabClass = (active: boolean) => `inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-medium ${active ? 'bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)]' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5'}`;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 pb-10">
      <div>
        <Breadcrumb items={[{ label: 'Gestion', href: '/admin/gestion' }, { label: 'Stocks' }]} />
        <AdminPageHeader
          title="Stocks"
          description="Stock vendable des produits (unités entières), journal des mouvements et dernier coût d'achat. Le stock de la boutique reste celui affiché ici."
          actions={can('inventory.manage') && !showAdjust ? <Link href={href({ ...baseParams, ajuster: '1' })} className={PRIMARY_LINK_CLS}><IconAdjustmentsHorizontal size={18} aria-hidden="true" />Ajuster le stock</Link> : undefined}
        />
      </div>

      {showAdjust && (
        <Panel id="rectification" title="Ajuster le stock" description="Rectification motivée, enregistrée dans le journal et l'historique.">
          <StockAdjustForm initialProduct={adjustProduct} closeHref={href(baseParams)} />
        </Panel>
      )}

      <nav aria-label="Vue" className="flex gap-2">
        <Link href={href({ q: q || undefined })} className={tabClass(view === 'produits')} aria-current={view === 'produits' ? 'page' : undefined}>Produits</Link>
        <Link href={href({ vue: 'mouvements' })} className={tabClass(view === 'mouvements')} aria-current={view === 'mouvements' ? 'page' : undefined}>Mouvements</Link>
      </nav>

      <form className={`${CARD_CLS} grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5`} aria-label="Filtres">
        {view === 'mouvements' && <input type="hidden" name="vue" value="mouvements" />}
        {view === 'produits' ? (
          <>
            <label className="block lg:col-span-2"><span className={LABEL_CLS}>Produit</span><input name="q" defaultValue={q} placeholder="Rechercher un produit" className={INPUT_CLS} /></label>
            <label className="block"><span className={LABEL_CLS}>Afficher</span>
              <select name="filtre" defaultValue={filter} className={INPUT_CLS}>
                {STOCK_FILTERS.map((value) => <option key={value} value={value}>{STOCK_FILTER_LABELS[value]}</option>)}
              </select>
            </label>
          </>
        ) : (
          <div className="block lg:col-span-3">
            <span className={LABEL_CLS}>Produit</span>
            {filterProduct ? (
              <p className="flex min-h-11 flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{filterProduct.name}</span>
                <input type="hidden" name="produit" value={filterProduct.id} />
                <Link href={href({ ...baseParams, produit: undefined })} className="text-[var(--admin-primary-fg)] underline">Tous les produits</Link>
              </p>
            ) : <p className="flex min-h-11 items-center text-sm text-gray-500 dark:text-gray-400">Tous les produits (choisir depuis l&apos;onglet Produits)</p>}
          </div>
        )}
        <label className="block"><span className={LABEL_CLS}>Type de mouvement</span>
          <select name="type" defaultValue={movementType ?? ''} className={INPUT_CLS}>
            <option value="">Tous</option>
            {MOVEMENT_TYPES.map((value) => <option key={value} value={value}>{MOVEMENT_TYPE_LABELS[value]}</option>)}
          </select>
        </label>
        <label className="block"><span className={LABEL_CLS}>Du</span><input type="date" name="du" defaultValue={from} className={INPUT_CLS} /></label>
        <label className="block"><span className={LABEL_CLS}>Au</span><input type="date" name="au" defaultValue={to} className={INPUT_CLS} /></label>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-5">
          <button type="submit" className="min-h-11 rounded-lg bg-[var(--color-primary-dark)] px-4 text-sm font-medium text-white">Appliquer</button>
          <Link href={href({ vue: view === 'mouvements' ? 'mouvements' : undefined })} className="inline-flex min-h-11 items-center px-3 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300">Réinitialiser</Link>
        </div>
        {view === 'produits' && (movementType || from || to) && (
          <p className="text-xs text-gray-500 sm:col-span-2 lg:col-span-5 dark:text-gray-400">Produits ayant au moins un mouvement correspondant au type et à la période.</p>
        )}
      </form>

      {products && (
        products.rows.length === 0 ? <EmptyState title="Aucun produit pour ces filtres" /> : (
          <>
            <ul className={`${CARD_CLS} divide-y divide-gray-100 dark:divide-gray-800`}>
              {products.rows.map((row) => (
                <li key={row.product_id} className="grid gap-2 px-4 py-3.5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-gray-950 dark:text-gray-100">{row.name}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {row.stock <= 0 && <Badge tone="danger">Rupture</Badge>}
                      {row.current_purchase_cost === null && <Badge tone="neutral">Sans coût connu</Badge>}
                      {!row.active && <Badge tone="neutral">Inactif</Badge>}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Stock actuel</p>
                    <p className="text-lg font-semibold tabular-nums text-gray-950 dark:text-gray-100">{formatQuantity(row.stock)}</p>
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-300">
                    <p>Dernier mouvement : {row.last_movement_at ? `${formatDate(row.last_movement_at)} (${MOVEMENT_TYPE_LABELS[row.last_movement_type ?? 'manual_adjustment']})` : 'aucun'}</p>
                    <p>Dernière réception : {formatDate(row.last_receipt_at)}</p>
                    <p>Dernier coût d&apos;achat : {row.current_purchase_cost !== null ? `${formatMoney(row.current_purchase_cost, row.cost_currency ?? tenant.currency)} / unité` : 'inconnu'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    <Link href={href({ vue: 'mouvements', produit: row.product_id })} className="inline-flex min-h-11 items-center rounded-lg border border-gray-200 px-3 text-sm dark:border-gray-700">Mouvements</Link>
                    {can('inventory.manage') && (
                      <Link href={href({ ...baseParams, page: page > 1 ? String(page) : undefined, ajuster: row.product_id })} className="inline-flex min-h-11 items-center rounded-lg border border-gray-200 px-3 text-sm dark:border-gray-700">Ajuster</Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <Pagination page={products.page} total={products.total} size={STOCK_PAGE_SIZE} params={baseParams} />
          </>
        )
      )}

      {movements && (
        movements.rows.length === 0 ? <EmptyState title="Aucun mouvement pour ces filtres" description="Les réceptions, annulations et rectifications apparaissent ici." /> : (
          <>
            <ul className={`${CARD_CLS} divide-y divide-gray-100 dark:divide-gray-800`}>
              {movements.rows.map((row) => (
                <li key={row.id} className="grid gap-2 px-4 py-3.5 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.2fr)_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={MOVEMENT_TONES[row.movement_type]}>{MOVEMENT_TYPE_LABELS[row.movement_type]}</Badge>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{formatDateTime(row.created_at)}{row.author ? ` • ${row.author}` : ''}</span>
                    </div>
                    <p className="mt-1 truncate text-sm font-medium text-gray-950 dark:text-gray-100">{row.product_name}</p>
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-300">
                    {row.source_quantity !== null && row.source_unit && (
                      <p>
                        Quantité source : {formatQuantityWithUnit(row.source_quantity, row.source_unit)}
                        {row.conversion_factor !== null ? ` × ${formatQuantity(row.conversion_factor)} unité(s) / ${PURCHASE_UNIT_LABELS[row.source_unit]}` : ''}
                      </p>
                    )}
                    {row.source_reference && <p>Référence : <span className="font-mono">{row.source_reference}</span></p>}
                    {(row.reason || (row.note && row.movement_type === 'manual_adjustment')) && <p>Motif : {row.reason ?? row.note}{row.reason && row.note ? ` (${row.note})` : ''}</p>}
                  </div>
                  <div className="flex items-baseline gap-3 md:justify-end">
                    <span className={`text-lg font-semibold tabular-nums ${row.quantity_delta > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                      {row.quantity_delta > 0 ? '+' : ''}{formatQuantity(row.quantity_delta)}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{row.stock_after !== null ? `stock après : ${formatStockUnits(row.stock_after)}` : ''}</span>
                  </div>
                </li>
              ))}
            </ul>
            <Pagination page={movements.page} total={movements.total} size={MOVEMENT_PAGE_SIZE} params={baseParams} />
          </>
        )
      )}
    </div>
  );
}
