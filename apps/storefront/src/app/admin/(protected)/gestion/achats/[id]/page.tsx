import Link from 'next/link';
import { notFound } from 'next/navigation';
import { IconCash, IconPackageImport } from '@tabler/icons-react';
import AdminPageHeader from '../../../../_components/ui/AdminPageHeader';
import { requireBusinessManagementPage } from '@/lib/gestion/featureGate';
import { getPurchaseDetail, listAuditEvents, listDocuments } from '@/lib/gestion/queries';
import { formatDate, formatDateTime, formatMoney, formatQuantity, formatQuantityWithUnit, formatStockUnits } from '@/lib/gestion/format';
import {
  PAYMENT_METHOD_LABELS, PAYMENT_STATE_LABELS, PAYMENT_STATE_TONES, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONES,
  PURCHASE_STATUS_LABELS, PURCHASE_STATUS_TONES, PURCHASE_UNIT_LABELS, DUE_STATE_TONES, dueInfo, dueLabel, gestionToday,
  purchasePaymentState, receiptProgress,
} from '@/lib/gestion/domain';
import Badge from '@/app/admin/_components/ui/Badge';
import { Panel } from '@/app/admin/_components/ui/Panel';
import { EmptyState } from '@/app/admin/_components/ui/States';
import { Breadcrumb } from '@/app/admin/_components/ui/AdminPageHeader';
import { buttonClasses } from '@/app/admin/_components/ui/Button';
import AdminStatCard from '@/app/admin/_components/ui/AdminStatCard';
import { ReasonAction, SimpleAction } from '../../_components/actions';
import { DocumentsPanel } from '../../_components/DocumentsPanel';
import { AuditTimeline } from '../../_components/AuditTimeline';
import { ReceiptForm } from './ReceiptForm';
import { DueDateForm } from './DueDateForm';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function PurchaseDetailPage({ params }: { params: { id: string } }) {
  const { tenant, can } = await requireBusinessManagementPage('purchases.view');
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const purchase = await getPurchaseDetail(tenant.id, params.id);
  if (!purchase) notFound();

  const money = (value: number) => formatMoney(value, purchase.currency);
  const state = purchasePaymentState(purchase);
  const progress = receiptProgress(purchase.items);
  const received = progress.percent;
  const due = dueInfo(purchase, gestionToday());
  const activeAllocations = purchase.allocations.filter((allocation) => !allocation.reversed_at);
  const editable = ['draft', 'ordered'].includes(purchase.status) && purchase.receipts.length === 0;
  const receivable = ['ordered', 'partially_received'].includes(purchase.status);
  const cancellable = editable && activeAllocations.length === 0;
  const payable = purchase.status !== 'cancelled' && purchase.allocatable > 0;

  const [documents, events] = await Promise.all([
    listDocuments(tenant.id, [{ type: 'purchase', ids: [purchase.id] }, { type: 'receipt', ids: purchase.receipts.map((receipt) => receipt.id) }]),
    listAuditEvents(tenant.id, [
      { type: 'purchase', ids: [purchase.id] },
      { type: 'receipt', ids: purchase.receipts.map((receipt) => receipt.id) },
      { type: 'allocation', ids: purchase.allocations.map((allocation) => allocation.id) },
    ], 40),
  ]);
  const receiptRefs = new Map(purchase.receipts.map((receipt) => [receipt.id, receipt.reference]));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 pb-10">
      <div>
        <Breadcrumb items={[{ label: 'Gestion', href: '/admin/gestion' }, { label: 'Achats', href: '/admin/gestion/achats' }, { label: purchase.reference }]} />
        <AdminPageHeader
          title={`Achat ${purchase.reference}`}
          meta={<Link href={`/admin/gestion/fournisseurs/${purchase.supplier_id}`} className="font-medium text-a-brand-fg hover:underline">{purchase.supplier_name}</Link>}
          description={`Commandé le ${formatDate(purchase.order_date)}${purchase.supplier_reference ? ` • Réf. fournisseur ${purchase.supplier_reference}` : ''}${purchase.expected_date ? ` • livraison prévue le ${formatDate(purchase.expected_date)}` : ''}`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={PURCHASE_STATUS_TONES[purchase.status]}>{PURCHASE_STATUS_LABELS[purchase.status]}</Badge>
              <Badge tone={PAYMENT_STATE_TONES[state]}>{PAYMENT_STATE_LABELS[state]}</Badge>
            </div>
          }
        />
      </div>

      {purchase.status === 'cancelled' && (
        <p className="rounded-xl bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg">
          Achat annulé{purchase.cancel_reason ? ` : ${purchase.cancel_reason}` : ''}. Il n&apos;entre plus dans la dette fournisseur.
        </p>
      )}

      <section aria-label="Synthèse" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <AdminStatCard title="Commandé" value={money(purchase.total)} description={purchase.additional_costs ? `dont frais ${money(purchase.additional_costs)}` : undefined} />
        <AdminStatCard title="Reçu" value={purchase.status === 'draft' ? '-' : `${received} %`} description={`${progress.completeLines} / ${progress.lines} ligne(s) complète(s)`} tone={received === 100 ? 'success' : received > 0 ? 'warning' : 'neutral'} />
        <AdminStatCard title="Payé vérifié" value={money(purchase.paid_verified)} tone="success" />
        <AdminStatCard title="Enregistré à vérifier" value={money(purchase.paid_unverified)} description="Ne réduit pas encore la dette" tone={purchase.paid_unverified > 0 ? 'warning' : 'neutral'} />
        <AdminStatCard title="Reste à payer" value={money(purchase.outstanding)} tone={purchase.outstanding > 0 ? 'warning' : 'success'} />
      </section>

      <section aria-label="Échéance de paiement" className="flex flex-col gap-2 rounded-2xl border border-a-border bg-a-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-a-text-3">Échéance de paiement</span>
          <span className="text-sm font-semibold text-a-text">{purchase.payment_due_date ? formatDate(purchase.payment_due_date) : 'Aucune'}</span>
          <Badge tone={DUE_STATE_TONES[due.state]}>{dueLabel(due)}</Badge>
        </div>
        {can('purchases.manage') && purchase.status !== 'cancelled' && <DueDateForm purchaseId={purchase.id} current={purchase.payment_due_date} />}
      </section>

      <div className="flex flex-wrap gap-2">
        {receivable && can('inventory.manage') && <a href="#reception" className={buttonClasses({ variant: 'primary' })}><IconPackageImport size={18} aria-hidden="true" />Enregistrer une réception</a>}
        {payable && can('treasury.manage') && (
          <Link href={`/admin/gestion/tresorerie/nouveau?supplier=${purchase.supplier_id}&purchase=${purchase.id}`} className={receivable ? buttonClasses({ variant: 'secondary' }) : buttonClasses({ variant: 'primary' })}>
            <IconCash size={18} aria-hidden="true" />Enregistrer un paiement
          </Link>
        )}
        {can('purchases.manage') && purchase.status === 'draft' && (
          <SimpleAction url={`/api/admin/gestion/purchases/${purchase.id}/status`} body={{ status: 'ordered' }} label="Passer la commande" variant="outline" />
        )}
        {can('purchases.manage') && editable && <Link href={`/admin/gestion/achats/${purchase.id}/modifier`} className={buttonClasses({ variant: 'secondary' })}>Modifier</Link>}
        {can('purchases.manage') && cancellable && (
          <ReasonAction url={`/api/admin/gestion/purchases/${purchase.id}/status`} body={{ status: 'cancelled' }}
            label="Annuler l'achat" confirmLabel="Confirmer l'annulation"
            description="L'achat sera conservé avec le statut Annulé et sortira de la dette fournisseur." />
        )}
      </div>

      <Panel id="articles" title="Articles" description={`${purchase.items.length} ligne(s) • coûts saisis, total recalculé par le serveur`}>
        {purchase.items.length === 0 ? <EmptyState title="Aucun article" description="Ajoutez des articles avant de passer la commande." /> : (
          <>
            <ul className="divide-y divide-a-border">
              {purchase.items.map((item) => (
                <li key={item.id} className="grid gap-1 py-3 first:pt-0 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-a-text">{item.description}</p>
                    <p className="text-xs text-a-text-3">{item.product_id ? `Catalogue : ${item.product_name ?? 'produit'}` : 'Hors catalogue (stock non suivi)'}</p>
                  </div>
                  <p className="text-sm text-a-text-2">
                    {formatQuantityWithUnit(item.ordered_quantity, item.purchase_unit)} × {formatMoney(item.unit_cost, purchase.currency)} / {PURCHASE_UNIT_LABELS[item.purchase_unit]}
                    <span className="block text-xs text-a-text-3">Reçu {formatQuantityWithUnit(item.received_quantity, item.purchase_unit)} / {formatQuantity(item.ordered_quantity)}</span>
                    {item.product_id && item.stock_units_per_purchase_unit !== null && (
                      <span className="block text-xs text-a-text-3">1 {PURCHASE_UNIT_LABELS[item.purchase_unit]} = {formatStockUnits(item.stock_units_per_purchase_unit)} en stock</span>
                    )}
                  </p>
                  <p className="text-sm font-semibold tabular-nums text-a-text sm:text-right">{money(item.line_total)}</p>
                </li>
              ))}
            </ul>
            <dl className="mt-3 space-y-1 border-t border-a-border pt-3 text-sm">
              <div className="flex justify-between"><dt className="text-a-text-3">Sous-total</dt><dd className="tabular-nums">{money(purchase.subtotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-a-text-3">Frais supplémentaires</dt><dd className="tabular-nums">{money(purchase.additional_costs)}</dd></div>
              <div className="flex justify-between font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(purchase.total)}</dd></div>
            </dl>
          </>
        )}
        {purchase.notes && <p className="mt-3 whitespace-pre-line rounded-xl bg-a-surface-2 p-3 text-sm text-a-text-2">{purchase.notes}</p>}
      </Panel>

      <Panel id="receptions" title="Réceptions" description="Chaque réception augmente le stock des produits liés, une seule fois.">
        <div className="space-y-4">
          {receivable && can('inventory.manage') && (
            <ReceiptForm purchaseId={purchase.id} lines={purchase.items.map((item) => ({
              id: item.id, description: item.description, linked: Boolean(item.product_id),
              ordered: item.ordered_quantity, received: item.received_quantity,
              unit: item.purchase_unit, conversion: item.stock_units_per_purchase_unit,
            }))} />
          )}
          {purchase.status === 'draft' && <p className="text-sm text-a-text-2">Passez la commande pour pouvoir enregistrer une réception.</p>}
          {purchase.receipts.length === 0 ? (
            <p className="text-sm text-a-text-3">Aucune réception enregistrée.</p>
          ) : (
            <ul className="space-y-3">
              {purchase.receipts.map((receipt) => (
                <li key={receipt.id} className={`rounded-xl border p-3 ${receipt.status === 'reversed' ? 'border-a-border opacity-70' : 'border-a-border'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-a-text">
                      <span className="font-mono">{receipt.reference}</span> • {formatDateTime(receipt.received_at)}
                    </p>
                    {receipt.status === 'reversed' ? <Badge tone="danger">Annulée</Badge> : <Badge tone="success">Reçue</Badge>}
                  </div>
                  <ul className="mt-1 text-sm text-a-text-2">
                    {receipt.lines.map((line) => (
                      <li key={line.purchase_item_id}>
                        {formatQuantityWithUnit(line.quantity, line.purchase_unit)} • {line.description}
                        {line.stock_units !== null && <span className="text-a-text-3"> (+{formatStockUnits(line.stock_units)} en stock)</span>}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-a-text-3">
                    {receipt.created_by ? `Par ${receipt.created_by}` : ''}{receipt.notes ? ` • ${receipt.notes}` : ''}
                    {receipt.reversal_reason ? ` • Annulée : ${receipt.reversal_reason}` : ''}
                  </p>
                  {receipt.status === 'recorded' && can('inventory.manage') && (
                    <div className="mt-2">
                      <ReasonAction url={`/api/admin/gestion/receipts/${receipt.id}/reverse`} label="Annuler la réception" confirmLabel="Confirmer l'annulation"
                        description="Le stock des produits liés sera diminué d'autant. Impossible si la marchandise a déjà été vendue." />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      {can('treasury.view') && (
        <Panel id="paiements" title="Paiements" description="Seuls les paiements vérifiés réduisent le reste à payer.">
          {purchase.allocations.length === 0 ? (
            <EmptyState title="Aucun paiement affecté" description={payable ? 'Enregistrez un paiement puis affectez-le à cet achat.' : undefined} />
          ) : (
            <ul className="divide-y divide-a-border">
              {purchase.allocations.map((allocation) => {
                const payment = allocation.payment;
                const reversed = Boolean(allocation.reversed_at);
                return (
                  <li key={allocation.id} className={`flex flex-col gap-2 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between ${reversed ? 'opacity-60' : ''}`}>
                    <Link href={`/admin/gestion/tresorerie/${payment.id}`} className="min-w-0 hover:underline">
                      <p className="text-sm font-medium text-a-text">
                        {formatDate(payment.payment_date)} • <span className="tabular-nums">{money(allocation.amount)}</span> • {PAYMENT_METHOD_LABELS[payment.method]}
                      </p>
                      <p className="text-xs text-a-text-3">
                        {payment.beneficiary_type === 'third_party' ? `Tiers : ${payment.beneficiary_name}` : payment.beneficiary_name}
                        {' • '}<span className="font-mono">{payment.reference}</span>
                        {allocation.amount !== payment.amount ? ` • sur un paiement de ${formatMoney(payment.amount, payment.currency)}` : ''}
                        {reversed ? ` • affectation retirée${allocation.reversal_reason ? ` : ${allocation.reversal_reason}` : ''}` : ''}
                      </p>
                    </Link>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={reversed ? 'neutral' : PAYMENT_STATUS_TONES[payment.status]}>{reversed ? 'Retirée' : PAYMENT_STATUS_LABELS[payment.status]}</Badge>
                      {!reversed && payment.status === 'recorded' && can('supplier_payments.verify') && (
                        <SimpleAction url={`/api/admin/gestion/payments/${payment.id}/verify`} label="Vérifier" variant="outline"
                          confirmText={`Confirmez que ${formatMoney(payment.amount, payment.currency)} ont bien été payés. Le reste à payer sera réduit.`} />
                      )}
                      {!reversed && payment.status !== 'voided' && can('treasury.manage') && (
                        <ReasonAction url={`/api/admin/gestion/allocations/${allocation.id}/reverse`} label="Retirer" confirmLabel="Retirer l'affectation" tone="neutral"
                          description="Le paiement reste enregistré mais ne compte plus pour cet achat." />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

      <Panel id="documents" title="Documents" description="Facture, bon de livraison, justificatifs. Stockage privé.">
        <DocumentsPanel
          entityType="purchase" entityId={purchase.id} canManage={can('purchases.manage')} defaultType="invoice"
          documents={documents.map((document) => ({ ...document, context: document.entity_type === 'receipt' ? `Réception ${receiptRefs.get(document.entity_id) ?? ''}` : undefined }))}
        />
      </Panel>

      <Panel id="historique" title="Historique">
        <AuditTimeline events={events} />
      </Panel>
    </div>
  );
}
