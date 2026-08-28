'use client';

import { useEffect, useMemo, useState } from 'react';
import { IconClock, IconFileExport } from '@tabler/icons-react';
import type { EventRow } from '@lepefy/types';

interface Props { event: EventRow; }

function toDateTimeLocal(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDateTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function EventBookingDeadlineAdminCard({ event }: Props) {
  const initialFallback = Number.isFinite(event.booking_close_reports_fallback_hours) ? event.booking_close_reports_fallback_hours : 2;
  const [bookingClosesAt, setBookingClosesAt] = useState(toDateTimeLocal(event.booking_closes_at));
  const [savedValue, setSavedValue] = useState(event.booking_closes_at);
  const [showRemainingPlaces, setShowRemainingPlaces] = useState(event.show_remaining_places !== false);
  const [savedShowRemainingPlaces, setSavedShowRemainingPlaces] = useState(event.show_remaining_places !== false);
  const [fallbackHours, setFallbackHours] = useState(String(initialFallback));
  const [savedFallbackHours, setSavedFallbackHours] = useState(initialFallback);
  const [reportState, setReportState] = useState({
    status: event.booking_close_reports_status ?? 'pending',
    scheduledFor: event.booking_close_reports_scheduled_for ?? null,
    sentAt: event.booking_close_reports_sent_at ?? null,
    lastError: event.booking_close_reports_last_error ?? null,
  });
  const [now, setNow] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const deadlineTimestamp = savedValue ? new Date(savedValue).getTime() : null;
  const closed = now !== null && deadlineTimestamp !== null && !Number.isNaN(deadlineTimestamp) && deadlineTimestamp <= now;
  const hoursRemaining = now !== null && deadlineTimestamp !== null && !closed ? (deadlineTimestamp - now) / 3_600_000 : null;
  const status = !savedValue ? 'Sans échéance dédiée' : closed ? 'Clôturée' : hoursRemaining !== null && hoursRemaining <= 6 ? 'Dernières heures' : 'Ouverte';
  const statusClass = !savedValue
    ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
    : closed
      ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
      : hoursRemaining !== null && hoursRemaining <= 6
        ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
        : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300';

  const fallbackNumber = Number(fallbackHours);
  const computedReportTime = useMemo(() => {
    if (savedValue) return savedValue;
    if (!Number.isInteger(fallbackNumber) || fallbackNumber < 1) return null;
    return new Date(new Date(event.date_start).getTime() - fallbackNumber * 3_600_000).toISOString();
  }, [event.date_start, fallbackNumber, savedValue]);

  async function save() {
    setError(null); setSaved(false);
    let normalized: string | null = null;
    if (bookingClosesAt) {
      const date = new Date(bookingClosesAt);
      if (Number.isNaN(date.getTime())) { setError('Date de fin des réservations invalide.'); return; }
      if (date.getTime() >= new Date(event.date_start).getTime()) { setError('La fin des réservations doit être antérieure au début de l’événement.'); return; }
      normalized = date.toISOString();
    }
    const fallback = Number(fallbackHours);
    if (!Number.isInteger(fallback) || fallback < 1 || fallback > 168) {
      setError('Le délai de secours doit être un nombre entier entre 1 et 168 heures.'); return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/admin/evenementiel/events/${event.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_closes_at: normalized, show_remaining_places: showRemainingPlaces, booking_close_reports_fallback_hours: fallback }),
      });
      const result = await response.json();
      if (!response.ok) { setError(result.error ?? 'Erreur lors de l’enregistrement.'); return; }
      const updated = result as EventRow;
      setSavedValue(updated.booking_closes_at);
      setBookingClosesAt(toDateTimeLocal(updated.booking_closes_at));
      setSavedShowRemainingPlaces(updated.show_remaining_places !== false);
      setShowRemainingPlaces(updated.show_remaining_places !== false);
      setSavedFallbackHours(updated.booking_close_reports_fallback_hours ?? fallback);
      setFallbackHours(String(updated.booking_close_reports_fallback_hours ?? fallback));
      setReportState({
        status: updated.booking_close_reports_status ?? 'pending',
        scheduledFor: updated.booking_close_reports_scheduled_for ?? null,
        sentAt: updated.booking_close_reports_sent_at ?? null,
        lastError: updated.booking_close_reports_last_error ?? null,
      });
      setNow(Date.now()); setSaved(true);
    } catch { setError('Erreur réseau lors de l’enregistrement.'); }
    finally { setSaving(false); }
  }

  const dirty = bookingClosesAt !== toDateTimeLocal(savedValue)
    || showRemainingPlaces !== savedShowRemainingPlaces
    || fallbackHours !== String(savedFallbackHours);

  const reportStatusLabel = reportState.sentAt
    ? `Envoyés le ${formatDateTime(reportState.sentAt)}`
    : reportState.status === 'sending'
      ? 'Envoi en cours'
      : reportState.status === 'error'
        ? 'Nouvelle tentative automatique prévue'
        : `Envoi automatique prévu${reportState.scheduledFor ? ` : ${formatDateTime(reportState.scheduledFor)}` : ''}`;

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <div className="flex items-center gap-2"><IconClock size={16} className="text-[var(--color-primary-dark)]" /><h2 className="text-sm font-semibold text-gray-950 dark:text-white">Réservations en ligne</h2></div>
        <span className={`rounded-full px-2 py-1 text-2xs font-semibold ${statusClass}`}>{status}</span>
      </div>
      <div className="p-4">
        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">Fin des réservations
          <input type="datetime-local" value={bookingClosesAt} max={toDateTimeLocal(event.date_start)} onChange={(e) => { setBookingClosesAt(e.target.value); setSaved(false); }} className="mt-1 min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
        </label>
        <p className="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">À cette date, le checkout public est fermé automatiquement. Les réservations manuelles admin restent possibles.</p>

        <div className="mt-4 rounded-xl border border-violet-100 bg-violet-50/40 p-3 dark:border-violet-950/50 dark:bg-violet-950/20">
          <div className="flex items-start gap-2"><IconFileExport size={16} className="mt-0.5 shrink-0 text-violet-600" /><div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-gray-800 dark:text-gray-100">Rapports de clôture automatiques</p>
            <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">Rapport détaillé, liste imprimable et codes A5 sont envoyés ensemble aux destinataires configurés.</p>
            <label className="mt-2 block text-xs text-gray-600 dark:text-gray-300">Si aucune fin des réservations n’est définie, envoyer les rapports
              <span className="mt-1 flex items-center gap-2"><input type="number" min={1} max={168} step={1} value={fallbackHours} onChange={(e) => { setFallbackHours(e.target.value); setSaved(false); }} className="min-h-10 w-24 rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-950" /><span>heure(s) avant l’événement</span></span>
            </label>
            {computedReportTime && <p className="mt-2 text-xs font-medium text-violet-700 dark:text-violet-300">Heure effective : {formatDateTime(computedReportTime)}</p>}
            <p className={`mt-1 text-xs ${reportState.status === 'error' ? 'text-red-600' : reportState.sentAt ? 'font-semibold text-emerald-700' : 'text-gray-500'}`}>{reportStatusLabel}</p>
            {reportState.lastError && <p className="mt-1 text-[11px] text-red-500">Dernière erreur : {reportState.lastError}</p>}
          </div></div>
        </div>

        <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
          <label className="flex cursor-pointer items-start justify-between gap-4"><span className="min-w-0"><span className="block text-xs font-semibold text-gray-700 dark:text-gray-200">Afficher le nombre de places restantes</span><span className="mt-1 block text-xs leading-relaxed text-gray-500 dark:text-gray-400">Activé : nombre exact. Désactivé : disponibilité qualitative uniquement.</span></span><span className="relative mt-0.5 shrink-0"><input type="checkbox" checked={showRemainingPlaces} onChange={(e) => { setShowRemainingPlaces(e.target.checked); setSaved(false); }} className="peer sr-only" /><span className="block h-6 w-11 rounded-full bg-gray-200 transition-colors peer-checked:bg-[var(--color-primary)] dark:bg-gray-700" /><span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" /></span></label>
        </div>

        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
        {saved && !error && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Paramètres enregistrés. L’heure d’envoi des rapports a été recalculée automatiquement.</p>}
        <div className="mt-3 flex gap-2"><button type="button" onClick={() => void save()} disabled={saving || !dirty} className="min-h-11 flex-1 rounded-lg bg-[var(--color-primary)] px-3 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-60">{saving ? 'Enregistrement…' : 'Enregistrer'}</button>{bookingClosesAt && <button type="button" onClick={() => { setBookingClosesAt(''); setSaved(false); }} disabled={saving} className="min-h-11 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300">Effacer</button>}</div>
      </div>
    </section>
  );
}
