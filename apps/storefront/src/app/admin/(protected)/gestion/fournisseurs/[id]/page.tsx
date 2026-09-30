import Link from 'next/link';
import { notFound } from 'next/navigation';
import AdminPageHeader from '../../../../_components/ui/AdminPageHeader';
import { requireBusinessManagementPage } from '@/lib/gestion/featureGate';
import { getSupplier, listAuditEvents, listDocuments, listPayments, listPurchases } from '@/lib/gestion/queries';
import { formatDate, formatMoney } from '@/lib/gestion/format';
import {
  PAYMENT_METHOD_LABELS, PAYMENT_STATE_LABELS, PAYMENT_STATE_TONES, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONES,
  PURCHASE_STATUS_LABELS, PURCHASE_STATUS_TONES, purchasePaymentState,
} from '@/lib/gestion/domain';
import { Badge, Breadcrumb, EmptyState, Field, Panel, SECONDARY_LINK_CLS, Stat } from '../../_components/ui';
import { AuditTimeline } from '../../_components/AuditTimeline';
import { DocumentsPanel } from '../../_components/DocumentsPanel';
import { SupplierEditToggle } from '../SupplierForm';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function SupplierDetailPage({ params }: { params: { id: string } }) {
  const { tenant, can } = await requireBusinessManagementPage('suppliers.view');
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const supplier = await getSupplier(tenant.id, params.id);
  if (!supplier) notFound();

  const [purchases, payments, documents, events] = await Promise.all([
    can('purchases.view') ? listPurchases(tenant.id, { supplierId: supplier.id, limit: 100 }) : Promise.resolve([]),
    can('treasury.view') ? listPayments(tenant.id, { supplierId: supplier.id, limit: 100 }) : Promise.resolve([]),
    listDocuments(tenant.id, [{ type: 'supplier', ids: [supplier.id] }]),
    listAuditEvents(tenant.id, [{ type: 'supplier', ids: [supplier.id] }], 30),
  ]);
  const money = (value: number) => formatMoney(value, supplier.currency);
  const b = supplier.balance;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 pb-10">
      <div>
        <Breadcrumb items={[{ label: 'Gestion', href: '/admin/gestion' }, { label: 'Fournisseurs', href: '/admin/gestion/fournisseurs' }, { label: supplier.code }]} />
        <AdminPageHeader
          title={supplier.name}
          meta={<span className="font-mono">{supplier.code}</span>}
          description={supplier.active ? undefined : 'Fournisseur inactif : aucun nouvel achat possible.'}
          actions={
            <div className="flex flex-wrap gap-2">
              {can('purchases.manage') && supplier.active && <Link href={`/admin/gestion/achats/nouveau?supplier=${supplier.id}`} className={SECONDARY_LINK_CLS}>Nouvel achat</Link>}
              {can('treasury.manage') && <Link href={`/admin/gestion/tresorerie/nouveau?supplier=${supplier.id}`} className={SECONDARY_LINK_CLS}>Enregistrer un paiement</Link>}
            </div>
          }
        />
      </div>

      <section aria-label="Solde" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total acheté" value={money(b.total_purchased)} hint={`${b.purchase_count} achat(s), hors annulés`} />
        <Stat label="Payé vérifié" value={money(b.paid_verified)} tone="success" />
        <Stat label="Enregistré à vérifier" value={money(b.paid_unverified)} tone={b.paid_unverified > 0 ? 'warn' : 'neutral'} hint="Ne réduit pas encore la dette" />
        <Stat label="Reste à payer" value={money(b.outstanding)} tone={b.outstanding > 0 ? 'warn' : 'success'} />
      </section>
      {b.unallocated_payments > 0 && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          {money(b.unallocated_payments)} payés à ce fournisseur ne sont affectés à aucun achat.
        </p>
      )}

      <Panel id="identite" title="Identité" actions={can('suppliers.manage') ? (
        <SupplierEditToggle supplierId={supplier.id} defaultCurrency={supplier.currency} initial={{
          name: supplier.name, legal_name: supplier.legal_name ?? '', contact_name: supplier.contact_name ?? '',
          email: supplier.email ?? '', phone: supplier.phone ?? '', whatsapp_phone: supplier.whatsapp_phone ?? '',
          address: supplier.address ?? '', country: supplier.country ?? '', currency: supplier.currency,
          notes: supplier.notes ?? '', active: supplier.active,
        }} />
      ) : undefined}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Raison sociale">{supplier.legal_name ?? '-'}</Field>
          <Field label="Contact">{supplier.contact_name ?? '-'}</Field>
          <Field label="Email">{supplier.email ? <a className="underline-offset-2 hover:underline" href={`mailto:${supplier.email}`}>{supplier.email}</a> : '-'}</Field>
          <Field label="Téléphone">{supplier.phone ?? '-'}</Field>
          <Field label="WhatsApp">{supplier.whatsapp_phone ?? '-'}</Field>
          <Field label="Pays / devise">{[supplier.country, supplier.currency].filter(Boolean).join(' • ')}</Field>
          <Field label="Adresse">{supplier.address ?? '-'}</Field>
        </div>
        {supplier.notes && (
          <div className="mt-4 rounded-xl bg-gray-50 p-3 dark:bg-gray-800/60">
            <p className="text-xs text-gray-500 dark:text-gray-400">Notes</p>
            <p className="mt-0.5 whitespace-pre-line text-sm text-gray-800 dark:text-gray-200">{supplier.notes}</p>
          </div>
        )}
      </Panel>

      {can('purchases.view') && (
        <Panel id="achats" title="Achats" description="Statut de la marchandise et statut du paiement sont suivis séparément.">
          {purchases.length === 0 ? <EmptyState title="Aucun achat chez ce fournisseur" /> : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {purchases.map((purchase) => {
                const state = purchasePaymentState(purchase);
                return (
                  <li key={purchase.id}>
                    <Link href={`/admin/gestion/achats/${purchase.id}`} className="flex flex-col gap-1.5 py-3 hover:bg-gray-50 sm:-mx-2 sm:flex-row sm:items-center sm:justify-between sm:px-2 dark:hover:bg-white/5">
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-medium text-gray-900 dark:text-gray-100">{purchase.reference}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{formatDate(purchase.order_date)}{purchase.supplier_reference ? ` • Réf. fournisseur ${purchase.supplier_reference}` : ''}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                        <Badge tone={PURCHASE_STATUS_TONES[purchase.status]}>{PURCHASE_STATUS_LABELS[purchase.status]}</Badge>
                        <Badge tone={PAYMENT_STATE_TONES[state]}>{PAYMENT_STATE_LABELS[state]}</Badge>
                        <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">{formatMoney(purchase.total, purchase.currency)}</span>
                        {purchase.outstanding > 0 && <span className="text-xs text-amber-700 dark:text-amber-300">reste {formatMoney(purchase.outstanding, purchase.currency)}</span>}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

      {can('treasury.view') && (
        <Panel id="paiements" title="Paiements">
          {payments.length === 0 ? <EmptyState title="Aucun paiement à ce fournisseur" /> : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {payments.map((payment) => (
                <li key={payment.id}>
                  <Link href={`/admin/gestion/tresorerie/${payment.id}`} className="flex flex-col gap-1.5 py-3 hover:bg-gray-50 sm:-mx-2 sm:flex-row sm:items-center sm:justify-between sm:px-2 dark:hover:bg-white/5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{formatDate(payment.payment_date)} • {PAYMENT_METHOD_LABELS[payment.method]}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        <span className="font-mono">{payment.reference}</span>
                        {payment.beneficiary_type === 'third_party' ? ` • Payé à un tiers : ${payment.beneficiary_name}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={PAYMENT_STATUS_TONES[payment.status]}>{PAYMENT_STATUS_LABELS[payment.status]}</Badge>
                      <span className={`text-sm font-semibold tabular-nums ${payment.status === 'voided' ? 'text-gray-400 line-through' : 'text-gray-900 dark:text-gray-100'}`}>{formatMoney(payment.amount, payment.currency)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <Panel id="documents" title="Documents" description="Contrats, conditions, pièces du fournisseur. Stockage privé.">
        <DocumentsPanel entityType="supplier" entityId={supplier.id} documents={documents} canManage={can('suppliers.manage')} defaultType="other" />
      </Panel>

      <Panel id="historique" title="Historique">
        <AuditTimeline events={events} />
      </Panel>
    </div>
  );
}
