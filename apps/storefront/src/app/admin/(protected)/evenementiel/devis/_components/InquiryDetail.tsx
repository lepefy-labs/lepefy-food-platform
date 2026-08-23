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
    <aside className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="border-b border-gray-100 p-4 dark:border-gray-800">
        {onBack && (
          <button type="button" onClick={onBack} className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] lg:hidden">
            <IconArrowLeft size={15} /> Retour aux demandes
          </button>
        )}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-gray-950 dark:text-white">{inquiry.customer_name}</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{inquiry.service_offerings?.title ?? 'Service'} · reçue {elapsedLabel(inquiry.created_at)}</p>
          </div>
          <InquiryStatusBadge status={inquiry.status} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={`mailto:${inquiry.customer_email}?subject=${mailSubject}`} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"><IconMail size={15} /> Envoyer un email</a>
          {phoneHref && <a href={`tel:${phoneHref}`} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"><IconPhone size={15} /> Appeler</a>}
        </div>
      </div>

      <div className="space-y-5 p-4">
        <section>
          <h3 className="text-sm font-semibold text-gray-950 dark:text-white">Informations</h3>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-gray-400">Date souhaitée</dt><dd className="mt-1 flex items-center gap-1.5 text-gray-800 dark:text-gray-200"><IconCalendar size={14} />{inquiry.date_souhaitee ? new Date(inquiry.date_souhaitee).toLocaleDateString('fr-FR') : 'Non renseigné'}</dd></div>
            <div><dt className="text-xs text-gray-400">Invités</dt><dd className="mt-1 flex items-center gap-1.5 text-gray-800 dark:text-gray-200"><IconUsers size={14} />{inquiry.nombre_invites ?? 'Non renseigné'}</dd></div>
            <div className="col-span-2"><dt className="text-xs text-gray-400">Email</dt><dd className="mt-1 break-all text-gray-800 dark:text-gray-200"><a className="hover:underline" href={`mailto:${inquiry.customer_email}`}>{inquiry.customer_email}</a></dd></div>
            <div className="col-span-2"><dt className="text-xs text-gray-400">Téléphone</dt><dd className="mt-1 text-gray-800 dark:text-gray-200">{inquiry.customer_phone ? <a className="hover:underline" href={`tel:${phoneHref}`}>{inquiry.customer_phone}</a> : 'Non renseigné'}</dd></div>
          </dl>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-gray-950 dark:text-white">Message du client</h3>
          <div className="mt-2 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm leading-6 text-gray-700 dark:bg-gray-950/60 dark:text-gray-200">{inquiry.message?.trim() || 'Aucun message.'}</div>
        </section>

        <section>
          <label htmlFor={`inquiry-status-${inquiry.id}`} className="text-sm font-semibold text-gray-950 dark:text-white">Statut</label>
          <select id={`inquiry-status-${inquiry.id}`} value={inquiry.status} onChange={(e) => onStatusChange(e.target.value as ServiceInquiryStatus)} disabled={statusSaving} className="mt-2 min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-60 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200">
            {INQUIRY_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
          </select>
          {statusError && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{statusError}</p>}
        </section>

        <section>
          <label htmlFor={`inquiry-note-${inquiry.id}`} className="text-sm font-semibold text-gray-950 dark:text-white">Note interne</label>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Visible uniquement par l’équipe admin.</p>
          <textarea id={`inquiry-note-${inquiry.id}`} value={noteDraft} onChange={(e) => { setNoteDraft(e.target.value); setNoteSaved(false); }} rows={5} placeholder="Ajouter une note pour l'équipe…" className="mt-2 w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] sm:text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
          {noteError && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{noteError}</p>}
          {noteSaved && !noteError && <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">Note enregistrée</p>}
          <Button type="button" onClick={saveNote} loading={noteSaving} disabled={!noteDirty || noteSaving} className="mt-3">{noteSaving ? 'Enregistrement…' : 'Enregistrer la note'}</Button>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-gray-950 dark:text-white">Suivi</h3>
          <dl className="mt-2 space-y-2 text-xs">
            {milestones.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-3"><dt className="text-gray-500 dark:text-gray-400">{label}</dt><dd className="text-right font-medium text-gray-700 dark:text-gray-200">{value ? new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</dd></div>
            ))}
          </dl>
        </section>
      </div>
    </aside>
  );
}
