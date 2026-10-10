'use client';

import { useEffect, useState } from 'react';
import { IconArrowLeft, IconCalendar, IconMail, IconPhone, IconUsers } from '@tabler/icons-react';
import Button from '../../../../_components/ui/Button';
import InquiryStatusBadge from './InquiryStatusBadge';
import type { InquiryWithService } from '../inquiryTypes';
import { INQUIRY_STATUSES, STATUS_LABELS, elapsedLabel } from '../inquiryTypes';
import type { ServiceInquiryStatus } from '@lepefy/types';

export default function InquiryDetail({
  inquiry,
  onBack,
  onStatusChange,
  statusSaving,
  statusError,
  onSaveNote,
  noteSaving,
  noteError,
}: {
  inquiry: InquiryWithService;
  onBack?: () => void;
  onStatusChange: (status: ServiceInquiryStatus) => Promise<void>;
  statusSaving: boolean;
  statusError: string | null;
  onSaveNote: (note: string | null) => Promise<boolean>;
  noteSaving: boolean;
  noteError: string | null;
}) {
  const [noteDraft, setNoteDraft] = useState(inquiry.internal_notes ?? '');
  const [noteSaved, setNoteSaved] = useState(false);

  useEffect(() => {
    setNoteDraft(inquiry.internal_notes ?? '');
    setNoteSaved(false);
  }, [inquiry.id, inquiry.internal_notes]);

  const noteDirty = noteDraft.trim() !== (inquiry.internal_notes ?? '').trim();
  const mailSubject = encodeURIComponent(`Demande Chloe Food — ${inquiry.service_offerings?.title ?? 'Événementiel'}`);
  const phoneHref = inquiry.customer_phone?.replace(/[^+\d]/g, '') || null;

  async function saveNote() {
    const ok = await onSaveNote(noteDraft.trim() || null);
    if (ok) setNoteSaved(true);
  }

  const milestones = [
    ['Reçue', inquiry.created_at],
    ['Contactée', inquiry.contacted_at],
    ['Devis envoyé', inquiry.quote_sent_at],
    ['Acceptée', inquiry.accepted_at],
    ['Clôturée', inquiry.closed_at],
  ] as const;

  return (
    <aside className="rounded-xl border border-a-border bg-a-surface">
      <div className="border-b border-a-border p-4">
        {onBack && (
          <button type="button" onClick={onBack} className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-a-text-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus lg:hidden">
            <IconArrowLeft size={15} /> Retour aux demandes
          </button>
        )}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-a-text">{inquiry.customer_name}</h2>
            <p className="mt-1 text-xs text-a-text-3">{inquiry.service_offerings?.title ?? 'Service'} · reçue {elapsedLabel(inquiry.created_at)}</p>
          </div>
          <InquiryStatusBadge status={inquiry.status} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={`mailto:${inquiry.customer_email}?subject=${mailSubject}`} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-a-border px-3 text-sm font-semibold text-a-text-2 hover:bg-a-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus"><IconMail size={15} /> Envoyer un email</a>
          {phoneHref && <a href={`tel:${phoneHref}`} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-a-border px-3 text-sm font-semibold text-a-text-2 hover:bg-a-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus"><IconPhone size={15} /> Appeler</a>}
        </div>
      </div>

      <div className="space-y-5 p-4">
        <section>
          <h3 className="text-sm font-semibold text-a-text">Informations</h3>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-a-text-3">Date souhaitée</dt><dd className="mt-1 flex items-center gap-1.5 text-a-text"><IconCalendar size={14} />{inquiry.date_souhaitee ? new Date(inquiry.date_souhaitee).toLocaleDateString('fr-FR') : 'Non renseigné'}</dd></div>
            <div><dt className="text-xs text-a-text-3">Invités</dt><dd className="mt-1 flex items-center gap-1.5 text-a-text"><IconUsers size={14} />{inquiry.nombre_invites ?? 'Non renseigné'}</dd></div>
            <div className="col-span-2"><dt className="text-xs text-a-text-3">Email</dt><dd className="mt-1 break-all text-a-text"><a className="hover:underline" href={`mailto:${inquiry.customer_email}`}>{inquiry.customer_email}</a></dd></div>
            <div className="col-span-2"><dt className="text-xs text-a-text-3">Téléphone</dt><dd className="mt-1 text-a-text">{inquiry.customer_phone ? <a className="hover:underline" href={`tel:${phoneHref}`}>{inquiry.customer_phone}</a> : 'Non renseigné'}</dd></div>
          </dl>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-a-text">Message du client</h3>
          <div className="mt-2 whitespace-pre-wrap rounded-lg bg-a-surface-2 p-3 text-sm leading-6 text-a-text-2">{inquiry.message?.trim() || 'Aucun message.'}</div>
        </section>

        <section>
          <label htmlFor={`inquiry-status-${inquiry.id}`} className="text-sm font-semibold text-a-text">Statut</label>
          <select id={`inquiry-status-${inquiry.id}`} value={inquiry.status} onChange={(e) => onStatusChange(e.target.value as ServiceInquiryStatus)} disabled={statusSaving} className="mt-2 min-h-11 w-full rounded-lg border border-a-border bg-a-surface px-3 text-sm text-a-text focus:outline-none focus:ring-2 focus:ring-a-focus disabled:opacity-60">
            {INQUIRY_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
          </select>
          {statusError && <p className="mt-2 rounded-lg bg-tone-danger-bg px-3 py-2 text-xs text-tone-danger-fg">{statusError}</p>}
        </section>

        <section>
          <label htmlFor={`inquiry-note-${inquiry.id}`} className="text-sm font-semibold text-a-text">Note interne</label>
          <p className="mt-0.5 text-xs text-a-text-3">Visible uniquement par l’équipe admin.</p>
          <textarea id={`inquiry-note-${inquiry.id}`} value={noteDraft} onChange={(e) => { setNoteDraft(e.target.value); setNoteSaved(false); }} rows={5} placeholder="Ajouter une note pour l'équipe…" className="mt-2 w-full resize-y rounded-lg border border-a-border bg-a-surface px-3 py-2 text-base text-a-text focus:outline-none focus:ring-2 focus:ring-a-focus sm:text-sm" />
          {noteError && <p className="mt-2 rounded-lg bg-tone-danger-bg px-3 py-2 text-xs text-tone-danger-fg">{noteError}</p>}
          {noteSaved && !noteError && <p className="mt-2 text-xs font-medium text-tone-success-fg">Note enregistrée</p>}
          <Button type="button" onClick={saveNote} loading={noteSaving} disabled={!noteDirty || noteSaving} className="mt-3">{noteSaving ? 'Enregistrement…' : 'Enregistrer la note'}</Button>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-a-text">Suivi</h3>
          <dl className="mt-2 space-y-2 text-xs">
            {milestones.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-3"><dt className="text-a-text-3">{label}</dt><dd className="text-right font-medium text-a-text-2">{value ? new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</dd></div>
            ))}
          </dl>
        </section>
      </div>
    </aside>
  );
}
