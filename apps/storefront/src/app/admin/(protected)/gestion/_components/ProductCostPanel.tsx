import 'server-only';
import Link from 'next/link';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { isBusinessManagementEnabled } from '@/lib/gestion/featureGate';
import { getProductCost } from '@/lib/gestion/queries';
import { PURCHASE_UNIT_LABELS, indicativeMargin } from '@/lib/gestion/domain';
import { formatDate, formatMoney, formatQuantity, formatQuantityWithUnit } from '@/lib/gestion/format';
import { Badge, Panel } from './ui';

/**
 * Coût d'achat (lecture seule) dans la fiche produit du Catalogue admin.
 * Rendu côté serveur uniquement si Gestion est actif et que l'admin a une
 * capability Gestion : le coût n'est jamais transmis au storefront ni à un
 * composant client du Catalogue.
 */
export async function ProductCostPanel({ tenantId, productId, price, currency }: {
  tenantId: string; productId: string; price: number; currency: string;
}) {
  if (!(await isBusinessManagementEnabled(tenantId))) return null;
  const access = await getCurrentAdminAccessContext(tenantId);
  if (!access || !['inventory.view', 'purchases.view'].some((permission) => canAdmin(access, permission))) return null;

  const cost = await getProductCost(tenantId, productId);
  const canOpenPurchase = canAdmin(access, 'purchases.view');

  return (
    <div className="mt-6">
      <Panel id="cout-achat" title="Coût d'achat" description="Dernier coût d'achat reçu, par unité de stock. Frais supplémentaires (transport, douane) non inclus.">
        {!cost ? (
          <p className="text-sm text-gray-600 dark:text-gray-300">Aucun coût connu : ce produit n&apos;a pas encore été reçu via un achat fournisseur.</p>
        ) : (
          <div className="space-y-4">
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-gray-500 dark:text-gray-400">Dernier coût d&apos;achat</dt>
                <dd className="text-xl font-semibold tabular-nums text-gray-950 dark:text-gray-100">{formatMoney(cost.current_purchase_cost, cost.currency)} <span className="text-sm font-normal text-gray-500">/ unité</span></dd>
                <dd className="text-xs text-gray-500 dark:text-gray-400">
                  Reçu le {formatDate(cost.effective_at)}{cost.supplier_name ? ` • ${cost.supplier_name}` : ''}
                  {cost.purchase_reference && (canOpenPurchase
                    ? <> • <Link href={`/admin/gestion/achats/${cost.purchase_id}`} className="font-mono underline">{cost.purchase_reference}</Link></>
                    : <> • <span className="font-mono">{cost.purchase_reference}</span></>)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500 dark:text-gray-400">Prix de vente</dt>
                <dd className="text-xl font-semibold tabular-nums text-gray-950 dark:text-gray-100">{formatMoney(price, currency)}</dd>
              </div>
              {cost.currency === currency && (() => {
                const margin = indicativeMargin(price, cost.current_purchase_cost);
                return (
                  <div>
                    <dt className="text-xs text-gray-500 dark:text-gray-400">Marge indicative</dt>
                    <dd className={`text-xl font-semibold tabular-nums ${margin.amount >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                      {formatMoney(margin.amount, currency)}{margin.percent !== null ? ` (${formatQuantity(margin.percent)} %)` : ''}
                    </dd>
                    <dd className="text-xs text-gray-500 dark:text-gray-400">Prix - dernier coût d&apos;achat. Ni marge nette, ni marge comptable.</dd>
                  </div>
                );
              })()}
            </dl>
            {cost.history.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Historique récent</p>
                <ul className="divide-y divide-gray-100 text-sm dark:divide-gray-800">
                  {cost.history.map((entry) => (
                    <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="text-gray-700 dark:text-gray-300">
                        {formatDate(entry.received_at)} • {formatQuantityWithUnit(entry.purchase_quantity, entry.purchase_unit)} à {formatMoney(entry.purchase_unit_cost, cost.currency)} / {PURCHASE_UNIT_LABELS[entry.purchase_unit]}
                        {' '}(× {formatQuantity(entry.conversion_factor)})
                      </span>
                      <span className="flex items-center gap-2">
                        {entry.id === cost.source_history_id && <Badge tone="success">Coût courant</Badge>}
                        {entry.status === 'reversed' && <Badge tone="neutral">Réception annulée</Badge>}
                        <span className={`tabular-nums ${entry.status === 'reversed' ? 'text-gray-400 line-through' : 'font-medium'}`}>{formatMoney(entry.cost_per_stock_unit, cost.currency)} / unité</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
