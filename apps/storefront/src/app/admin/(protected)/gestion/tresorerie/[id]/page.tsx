import Link from 'next/link';
import { notFound } from 'next/navigation';
import AdminPageHeader from '../../../../_components/ui/AdminPageHeader';
import { requireBusinessManagementPage } from '@/lib/gestion/featureGate';
import { listAuditEvents, listDocuments, listPayments, listPurchases } from '@/lib/gestion/queries';
import { formatDate, formatDateTime, formatMoney } from '@/lib/gestion/format';
import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONES } from '@/lib/gestion/domain';
import Badge from '@/app/admin/_components/ui/Badge';
import { Panel, InfoField as Field } from '@/app/admin/_components/ui/Panel';
import { Breadcrumb } from '@/app/admin/_components/ui/AdminPageHeader';
import AdminStatCard from '@/app/admin/_components/ui/AdminStatCard';
import { ReasonAction, SimpleAction } from '../../_components/actions';
import { DocumentsPanel } from '../../_components/DocumentsPanel';
import { AuditTimeline } from '../../_components/AuditTimeline';
import { AllocateForm } from './AllocateForm';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function PaymentDetailPage({ params }: { params: { id: string } }) {
  const { tenant, can } = await requireBusinessManagementPage('treasury.view');
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const [payment] = await listPayments(tenant.id, { paymentId: params.id, limit: 1 });
  if (!payment) notFound();

  const unallocated = Math.max(0, Math.round((payment.amount - payment.allocated) * 100) / 100);
  const canAllocate = payment.status !== 'voided' && unallocated > 0 && can('treasury.manage');
  const canVoid = payment.status !== 'voided' && can('treasury.manage') && (payment.status !== 'verified' || can('supplier_payments.verify'));
  const [documents, events, purchases] = await Promise.all([
    listDocuments(tenant.id, [{ type: 'supplier_payment', ids: [payment.id] }]),
    listAuditEvents(tenant.id, [{ type: 'payment', ids: [payment.id] }, { type: 'allocation', ids: payment.allocations.map((allocation) => allocation.id) }], 40),
    canAllocate ? listPurchases(tenant.id, { supplierId: payment.supplier_id }) : Promise.resolve([]),
  ]);
  const allocatable = purchases
    .filter((purchase) => purchase.status !== 'cancelled' && purchase.allocatable > 0 && purchase.currency === payment.currency
      && !payment.allocations.some((allocation) => allocation.purchase_id === purchase.id && !allocation.reversed_at))
    .map((purchase) => ({ id: purchase.id, reference: purchase.reference, allocatable: purchase.allocatable }));
  const money = (value: number) => formatMoney(value, payment.currency);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 pb-10">
      <div>
        <Breadcrumb items={[{ label: 'Gestion', href: '/admin/gestion' }, { label: 'Trésorerie', href: '/admin/gestion/tresorerie' }, { label: payment.reference }]} />
        <AdminPageHeader
          title={`Paiement ${payment.reference}`}
          meta={<Link href={`/admin/gestion/fournisseurs/${payment.supplier_id}`} className="font-medium text-a-brand-fg hover:underline">{payment.supplier_name}</Link>}
          description={`${formatDate(payment.payment_date)} • ${PAYMENT_METHOD_LABELS[payment.method]}`}
          actions={<Badge tone={PAYMENT_STATUS_TONES[payment.status]}>{PAYMENT_STATUS_LABELS[payment.status]}</Badge>}
        />
      </div>

      {payment.status === 'recorded' && (
        <div className="flex flex-col gap-3 rounded-xl bg-tone-warning-bg p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-tone-warning-fg">Paiement enregistré, pas encore vérifié : il ne réduit pas encore la dette du fournisseur.</p>
          {can('supplier_payments.verify') && (
            <SimpleAction url={`/api/admin/gestion/payments/${payment.id}/verify`} label="Vérifier le paiement"
              confirmText={`Confirmez que ${money(payment.amount)} ont bien quitté votre compte ou votre caisse.`} />
          )}
        </div>
      )}
      {payment.status === 'voided' && (
        <p className="rounded-xl bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg">
          Paiement annulé le {formatDateTime(payment.voided_at)}{payment.void_reason ? ` : ${payment.void_reason}` : ''}. Ses affectations ont été retirées.
        </p>
      )}

      <section aria-label="Montants" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <AdminStatCard title="Montant" value={money(payment.amount)} />
        <AdminStatCard title="Affecté aux achats" value={money(payment.allocated)} />
        <AdminStatCard title="Non affecté" value={money(unallocated)} tone={unallocated > 0 && payment.status !== 'voided' ? 'warning' : 'neutral'} />
      </section>

      <Panel title="Détails">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Bénéficiaire">
            {payment.beneficiary_type === 'third_party'
              ? <><Badge tone="info">Payé à un tiers sur instruction du fournisseur</Badge><span className="mt-1 block">{payment.beneficiary_name}</span></>
              : payment.beneficiary_name}
          </Field>
          {payment.beneficiary_reference && <Field label="Référence du bénéficiaire">{payment.beneficiary_reference}</Field>}
          <Field label="Créancier">{payment.supplier_name}</Field>
          <Field label="Compte ou caisse">{payment.payer_account ?? '-'}</Field>
          <Field label="Référence externe">{payment.external_reference ?? '-'}</Field>
          <Field label="Enregistré">{formatDateTime(payment.created_at)}{payment.created_by ? ` par ${payment.created_by}` : ''}</Field>
          <Field label="Vérifié">{payment.verified_at ? `${formatDateTime(payment.verified_at)}${payment.verified_by ? ` par ${payment.verified_by}` : ''}` : 'Non'}</Field>
        </div>
        {payment.supplier_instruction_note && (
          <div className="mt-4 rounded-xl bg-tone-info-bg p-3 text-sm text-tone-info-fg">
            <p className="text-xs font-medium">Instruction du fournisseur</p>
            <p className="mt-0.5 whitespace-pre-line">{payment.supplier_instruction_note}</p>
          </div>
        )}
        {payment.notes && <p className="mt-3 whitespace-pre-line rounded-xl bg-a-surface-2 p-3 text-sm text-a-text-2">{payment.notes}</p>}
        {canVoid && (
          <div className="mt-4">
            <ReasonAction url={`/api/admin/gestion/payments/${payment.id}/void`} label="Annuler le paiement" confirmLabel="Confirmer l'annulation"
              description={payment.status === 'verified'
                ? 'Paiement déjà vérifié : son annulation augmentera de nouveau la dette. Le paiement reste visible dans l\'historique.'
                : 'Le paiement et ses affectations seront annulés, sans suppression.'} />
          </div>
        )}
      </Panel>

      <Panel title="Affectations" description="Répartition du paiement sur les achats du fournisseur.">
        <div className="space-y-4">
          {payment.allocations.length === 0 ? <p className="text-sm text-a-text-3">Paiement non affecté (avance au fournisseur).</p> : (
            <ul className="divide-y divide-a-border">
              {payment.allocations.map((allocation) => (
                <li key={allocation.id} className={`flex flex-col gap-2 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between ${allocation.reversed_at ? 'opacity-60' : ''}`}>
                  <Link href={`/admin/gestion/achats/${allocation.purchase_id}`} className="font-mono text-sm font-medium text-a-text hover:underline">
                    {allocation.purchase_reference}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm tabular-nums">{money(allocation.amount)}</span>
                    {allocation.reversed_at ? <Badge tone="neutral">Retirée</Badge> : payment.status !== 'voided' && can('treasury.manage') && (
                      <ReasonAction url={`/api/admin/gestion/allocations/${allocation.id}/reverse`} label="Retirer" confirmLabel="Retirer l'affectation" tone="neutral"
                        description="Le montant redevient non affecté sur ce paiement." />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {canAllocate && <AllocateForm paymentId={payment.id} unallocated={unallocated} currency={payment.currency} purchases={allocatable} />}
        </div>
      </Panel>

      <Panel title="Justificatifs" description="Preuve de paiement et, pour un tiers, instruction écrite du fournisseur. Stockage privé.">
        <DocumentsPanel entityType="supplier_payment" entityId={payment.id} documents={documents} canManage={can('treasury.manage')}
          defaultType={payment.beneficiary_type === 'third_party' ? 'supplier_instruction' : 'payment_proof'}
          allowedTypes={['payment_proof', 'supplier_instruction', 'receipt', 'invoice', 'other']} />
      </Panel>

      <Panel title="Historique">
        <AuditTimeline events={events} />
      </Panel>
    </div>
  );
}
