'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconCheck, IconFileTypePdf, IconPrinter, IconSnowflake } from '@tabler/icons-react';
import type { PreparationModeValue, StartResult } from '@/lib/orders/preparation/preparationPolicy';
import { formatDate } from '@/lib/admin/format';
import Button, { ButtonAnchor } from '../../_components/ui/Button';
import ConfirmDialog from '../../_components/ui/ConfirmDialog';
import Dialog from '../../_components/ui/Dialog';
import { FormField, Input } from '../../_components/ui/Form';
import InlineAlert from '../../_components/ui/InlineAlert';
import { useAdminToast } from '../../_components/ui/Toaster';

export interface PaperPreparationProps {
  orderId: string;
  status: string;
  delivery: boolean;
  pickingMode: PreparationModeValue;
  coldMode: PreparationModeValue;
  hasColdChain: boolean;
  printedAt: string | null;
  completedAt: string | null;
  completedBy: string | null;
  coldDeclaredAt: string | null;
  parcelCount: number | null;
  /** Carton plan suggestion, shown as a hint only: the count is always typed or confirmed. */
  suggestedParcels: number | null;
  pickingFormat: string;
  paid: boolean;
  canManage: boolean;
}

/**
 * Paper / « sans confirmation » preparation of one order (migration 160).
 * Replaces the digital checklist as the main path; never ticks a line, never
 * ships. « Préparation terminée » is an explicit, named declaration.
 */
export default function PaperPreparationPanel(props: PaperPreparationProps) {
  const router = useRouter();
  const toast = useAdminToast();
  const [open, setOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parcels, setParcels] = useState(props.parcelCount ? String(props.parcelCount) : '');
  const [allPrepared, setAllPrepared] = useState(false);
  const [coldDeclared, setColdDeclared] = useState(false);
  const pdfHref = `/api/admin/orders/${props.orderId}/documents/picking-list`;
  const needsCold = props.delivery && props.hasColdChain && props.coldMode === 'paper';
  const parcelValue = Number(parcels);
  const parcelsValid = !props.delivery || (Number.isInteger(parcelValue) && parcelValue >= 1 && parcelValue <= 99);
  const canConfirm = allPrepared && parcelsValid && (!needsCold || coldDeclared);
  const active = props.status === 'new' || props.status === 'preparing';

  async function printAndStart() {
    const tab = window.open('', '_blank');
    setPending(true);
    try {
      const response = await fetch('/api/admin/orders/preparation/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderIds: [props.orderId] }) });
      const body = await response.json().catch(() => null) as (StartResult & { error?: string }) | null;
      if (!response.ok || !body) throw new Error(body?.error ?? 'Impossible de démarrer la préparation.');
      if (body.ready.includes(props.orderId)) {
        if (tab) tab.location.href = pdfHref; else window.location.href = pdfHref;
        toast.success('Liste imprimée : préparation démarrée.');
      } else {
        tab?.close();
        toast.error('La préparation n’a pas pu démarrer pour cette commande.');
      }
      router.refresh();
    } catch (err) {
      tab?.close();
      toast.error(err instanceof Error ? err.message : 'Impossible de démarrer la préparation.');
    } finally {
      setPending(false);
    }
  }

  async function submit(method: 'POST' | 'DELETE') {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/orders/${props.orderId}/preparation`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ allPrepared, parcelCount: props.delivery ? parcelValue : null, coldDeclared }) : undefined,
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? 'Enregistrement impossible.');
      toast.success(method === 'POST' ? 'Préparation terminée enregistrée.' : 'Confirmation annulée.');
      setOpen(false);
      setWithdrawOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enregistrement impossible.');
    } finally {
      setPending(false);
    }
  }

  if (props.pickingMode === 'none') {
    return (
      <section aria-labelledby="paper-preparation-title" className="rounded-2xl border border-a-border bg-a-surface p-4 shadow-sm">
        <h2 id="paper-preparation-title" className="text-sm font-semibold text-a-text">Préparation sans confirmation</h2>
        <p className="mt-1 text-sm text-a-text-2">Votre boutique n’enregistre pas la préparation dans Lepefy : la commande avance quand vous {props.delivery ? 'l’expédiez' : 'la marquez prête au retrait'}. Aucun contrôle n’est attesté.</p>
        <div className="mt-3"><ButtonAnchor href={pdfHref} target="_blank" rel="noopener noreferrer"><IconFileTypePdf size={16} aria-hidden="true" /> Liste de préparation · {props.pickingFormat.toUpperCase()}</ButtonAnchor></div>
      </section>
    );
  }

  return (
    <section aria-labelledby="paper-preparation-title" className={`rounded-2xl border p-4 shadow-sm ${props.completedAt ? 'border-tone-success-border bg-tone-success-bg' : 'border-a-border bg-a-surface'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-a-text-3">Préparation sur papier</p>
          <h2 id="paper-preparation-title" className="mt-0.5 text-base font-semibold text-a-text">
            {props.completedAt ? 'Préparation terminée' : props.printedAt ? 'Liste imprimée, préparation en cours' : 'Liste à imprimer'}
          </h2>
          <p className="mt-1 text-xs text-a-text-3">
            {props.completedAt
              ? `Déclarée le ${formatDate(props.completedAt, 'datetime')}${props.completedBy ? ` par ${props.completedBy}` : ''}${props.parcelCount ? ` · ${props.parcelCount} colis` : ''}${props.coldDeclaredAt ? ' · emballage froid confirmé' : ''}.`
              : props.printedAt ? `Imprimée le ${formatDate(props.printedAt, 'datetime')}. Cochez sur la feuille, puis confirmez ici à la fin.` : 'Imprimez la liste et collez-la sur le chariot.'}
          </p>
        </div>
        {props.completedAt && <span className="inline-flex items-center gap-1 rounded-full bg-tone-success-bg px-2 py-1 text-xs font-semibold text-tone-success-fg"><IconCheck size={13} aria-hidden="true" /> Terminée</span>}
      </div>

      {!props.paid && active && <div className="mt-3"><InlineAlert tone="warning">Paiement à vérifier : la préparation ne peut pas être démarrée ni confirmée.</InlineAlert></div>}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {props.canManage && active && props.paid && !props.printedAt && (
          <Button onClick={() => void printAndStart()} loading={pending}><IconPrinter size={16} aria-hidden="true" /> Imprimer et démarrer la préparation</Button>
        )}
        <ButtonAnchor href={pdfHref} target="_blank" rel="noopener noreferrer" title="Ouvre la liste sans rien enregistrer">
          <IconFileTypePdf size={16} aria-hidden="true" /> {props.printedAt ? 'Réimprimer la liste' : 'Ouvrir la liste'}<span className="sr-only"> (PDF, nouvel onglet)</span>
        </ButtonAnchor>
        {props.canManage && props.status === 'preparing' && props.paid && !props.completedAt && (
          <Button variant={props.printedAt ? 'primary' : 'secondary'} onClick={() => { setError(null); setOpen(true); }}><IconCheck size={16} aria-hidden="true" /> Préparation terminée</Button>
        )}
        {props.canManage && props.status === 'preparing' && props.completedAt && (
          <Button variant="ghost" onClick={() => setWithdrawOpen(true)}>Annuler la confirmation</Button>
        )}
      </div>

      <Dialog
        open={open}
        onClose={() => { if (!pending) setOpen(false); }}
        dismissible={!pending}
        title="Préparation terminée"
        description="Enregistré comme déclaration papier à votre nom. Lepefy ne coche aucun article à votre place."
        footer={<>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>Annuler</Button>
          <Button onClick={() => void submit('POST')} disabled={!canConfirm} loading={pending}>Confirmer</Button>
        </>}
      >
        <div className="space-y-4">
          {props.delivery && (
            <FormField label="Nombre de colis" required hint={props.suggestedParcels ? `Suggestion du plan de cartons : ${props.suggestedParcels} colis. Saisissez le nombre réellement préparé.` : 'Saisissez le nombre réellement préparé.'}>
              <Input type="number" min={1} max={99} step={1} inputMode="numeric" value={parcels} onChange={(event) => setParcels(event.target.value)} />
            </FormField>
          )}
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-a-text">
            <input type="checkbox" checked={allPrepared} onChange={(event) => setAllPrepared(event.target.checked)} className="mt-0.5 h-5 w-5 rounded border-a-field accent-a-brand" />
            <span>Tous les articles de la liste ont été préparés.</span>
          </label>
          {needsCold && (
            <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-a-text">
              <input type="checkbox" checked={coldDeclared} onChange={(event) => setColdDeclared(event.target.checked)} className="mt-0.5 h-5 w-5 rounded border-a-field accent-a-brand" />
              <span className="flex items-start gap-1.5"><IconSnowflake size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-tone-info-fg" />Produits frais et surgelés emballés selon la liste (en dernier, emballage isotherme).</span>
            </label>
          )}
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        </div>
      </Dialog>

      <ConfirmDialog
        open={withdrawOpen}
        title="Annuler la confirmation ?"
        description="La commande repasse en « Liste imprimée » : il faudra confirmer à nouveau la préparation avant l’expédition ou le retrait. Le nombre de colis est conservé."
        confirmLabel="Annuler la confirmation"
        cancelLabel="Garder"
        loading={pending}
        error={error}
        onConfirm={() => void submit('DELETE')}
        onCancel={() => { if (!pending) setWithdrawOpen(false); }}
      />
    </section>
  );
}
