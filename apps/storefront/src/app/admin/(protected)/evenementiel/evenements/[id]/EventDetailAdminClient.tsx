'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { IconArrowLeft, IconPlus, IconTrash, IconReceiptRefund, IconUpload, IconStarFilled, IconClock } from '@tabler/icons-react';
import { formatDate, formatPrice } from '@/lib/utils/format';
import { HIGHLIGHT_ICON_OPTIONS } from '@/lib/events/highlightIcons';
import ConfirmPaymentButton from '../../../../_components/ui/ConfirmPaymentButton';
import Button from '../../../../_components/ui/Button';
import type { EventRow, EventTicketType, EventReservation, EventReservationRequest, EventStatus, EventReservationStatus, EventHighlight } from '@lepefy/types';

const STATUS_OPTIONS: EventStatus[] = ['draft', 'published', 'closed', 'cancelled'];
const MAX_HIGHLIGHTS = 3;

const RESERVATION_STATUS_LABELS: Record<EventReservationStatus, string> = {
  confirmed: 'Confirmée',
  cancelled: 'Annulée',
  refunded: 'Remboursée',
};

interface Props {
  event: EventRow;
  initialTicketTypes: EventTicketType[];
  initialReservations: EventReservation[];
  initialPendingRequests: EventReservationRequest[];
  currency: string;
}

function elapsedLabel(createdAt: string): string {
  const minutes = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
  if (minutes < 1)  return 'à l\'instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)   return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

export default function EventDetailAdminClient({ event: initialEvent, initialTicketTypes, initialReservations, initialPendingRequests, currency }: Props) {
  const router = useRouter();
  const [event, setEvent] = useState(initialEvent);
  const [ticketTypes, setTicketTypes] = useState(initialTicketTypes);
  const [reservations, setReservations] = useState(initialReservations);
  const [pendingRequests, setPendingRequests] = useState(initialPendingRequests);
  const [savingStatus, setSavingStatus] = useState(false);

  const [newLabel, setNewLabel] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newBadge, setNewBadge] = useState('');
  const [addingTicket, setAddingTicket] = useState(false);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Badge par formule existante — pas de form d'édition dédié dans l'admin
  // (seulement create/delete jusqu'ici), un éditeur inline minimal suffit ici
  // (voir deviation report Fase 2).
  const [badgeDrafts, setBadgeDrafts] = useState<Record<string, string>>(
    Object.fromEntries(initialTicketTypes.map((t) => [t.id, t.badge ?? ''])),
  );
  const [savingBadge, setSavingBadge] = useState<string | null>(null);

  // Sous-titre + feature row hero (058) — section distincte, sauvegarde propre,
  // même pattern que la section Bannière ci-dessous.
  const [subtitle, setSubtitle] = useState(initialEvent.subtitle ?? '');
  const [highlights, setHighlights] = useState<EventHighlight[]>(initialEvent.highlights ?? []);
  const [savingHighlights, setSavingHighlights] = useState(false);
  const [highlightsError, setHighlightsError] = useState<string | null>(null);

  const inputClass = 'border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';

  async function updateStatus(status: EventStatus) {
    setStatusError(null);
    if (status === 'published' && ticketTypes.filter((t) => t.active).length === 0) {
      setStatusError('Impossible de publier un événement sans au moins une formule active — ajoutez-en une ci-dessous.');
      return;
    }
    setSavingStatus(true);
    try {
      const res = await fetch(`/api/admin/evenementiel/events/${event.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const result = await res.json();
      if (!res.ok) {
        setStatusError(result.error ?? 'Erreur lors du changement de statut.');
        return;
      }
      setEvent(result);
    } finally {
      setSavingStatus(false);
    }
  }

  async function handleBannerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploadingBanner(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('kind', 'event-banner');
      const uploadRes = await fetch('/api/admin/evenementiel/upload-image', { method: 'POST', body: formData });
      const uploadResult = await uploadRes.json();
      if (!uploadRes.ok) {
        setError(uploadResult.error ?? 'Erreur lors du téléversement de la bannière.');
        return;
      }
      const patchRes = await fetch(`/api/admin/evenementiel/events/${event.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ banner_image_url: uploadResult.imageUrl }),
      });
      const patchResult = await patchRes.json();
      if (!patchRes.ok) {
        setError(patchResult.error ?? 'Erreur lors de l\'enregistrement de la bannière.');
        return;
      }
      setEvent(patchResult);
    } finally {
      setUploadingBanner(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function addHighlightRow() {
    setHighlights((prev) => (prev.length >= MAX_HIGHLIGHTS ? prev : [...prev, { icon: HIGHLIGHT_ICON_OPTIONS[0]?.key ?? 'flame', title: '', text: '' }]));
  }

  function updateHighlightRow(index: number, field: keyof EventHighlight, value: string) {
    setHighlights((prev) => prev.map((h, i) => (i === index ? { ...h, [field]: value } : h)));
  }

  function removeHighlightRow(index: number) {
    setHighlights((prev) => prev.filter((_, i) => i !== index));
  }

  async function saveHighlights() {
    setHighlightsError(null);
    // Lignes vides (ni titre ni texte) omises à l'enregistrement.
    const cleaned = highlights
      .filter((h) => h.title.trim() || h.text.trim())
      .slice(0, MAX_HIGHLIGHTS)
      .map((h) => ({ icon: h.icon, title: h.title.trim(), text: h.text.trim() }));

    setSavingHighlights(true);
    try {
      const res = await fetch(`/api/admin/evenementiel/events/${event.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtitle: subtitle.trim() || null, highlights: cleaned.length > 0 ? cleaned : null }),
      });
      const result = await res.json();
      if (!res.ok) {
        setHighlightsError(result.error ?? 'Erreur lors de l\'enregistrement.');
        return;
      }
      setEvent(result);
      setHighlights(cleaned);
    } finally {
      setSavingHighlights(false);
    }
  }

  async function addTicketType(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const price = Number(newPrice);
    if (!newLabel.trim() || !Number.isFinite(price) || price < 0) {
      setError('Libellé et prix valides requis.');
      return;
    }
    setAddingTicket(true);
    try {
      const res = await fetch(`/api/admin/evenementiel/events/${event.id}/ticket-types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: newLabel.trim(),
          description: newDescription.trim() || null,
          price,
          badge: newBadge.trim() || null,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        setError(result.error ?? 'Erreur.');
        return;
      }
      setTicketTypes((prev) => [...prev, result]);
      setBadgeDrafts((prev) => ({ ...prev, [result.id]: result.badge ?? '' }));
      setNewLabel(''); setNewDescription(''); setNewPrice(''); setNewBadge('');
    } finally {
      setAddingTicket(false);
    }
  }

  async function saveBadge(ticketId: string) {
    setSavingBadge(ticketId);
    try {
      const res = await fetch(`/api/admin/evenementiel/ticket-types/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ badge: (badgeDrafts[ticketId] ?? '').trim() || null }),
      });
      if (res.ok) {
        const updated = await res.json();
        setTicketTypes((prev) => prev.map((t) => (t.id === ticketId ? { ...t, badge: updated.badge } : t)));
        setBadgeDrafts((prev) => ({ ...prev, [ticketId]: updated.badge ?? '' }));
      }
    } finally {
      setSavingBadge(null);
    }
  }

  async function removeTicketType(id: string) {
    const res = await fetch(`/api/admin/evenementiel/ticket-types/${id}`, { method: 'DELETE' });
    if (res.ok) {
      const result = await res.json();
      if (result.deactivated) {
        setTicketTypes((prev) => prev.map((t) => (t.id === id ? { ...t, active: false } : t)));
      } else {
        setTicketTypes((prev) => prev.filter((t) => t.id !== id));
      }
    }
  }

  async function refundReservation(id: string) {
    if (!confirm('Rembourser cette réservation et libérer les places ?')) return;
    setRefunding(id);
    try {
      const res = await fetch(`/api/admin/evenementiel/reservations/${id}/refund`, { method: 'POST' });
      if (res.ok) {
        setReservations((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'refunded' } : r)));
      }
    } finally {
      setRefunding(null);
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/admin/evenementiel/evenements" className="text-sm text-gray-500 flex items-center gap-1.5 hover:text-gray-700">
        <IconArrowLeft size={14} /> Retour aux événements
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{event.title}</h1>
          <p className="text-sm text-gray-500">
            {formatDate(event.date_start)} · {event.capacity_remaining}/{event.capacity_total} places restantes
          </p>
        </div>
        <div className="text-right">
          <select
            value={event.status}
            onChange={(e) => updateStatus(e.target.value as EventStatus)}
            disabled={savingStatus}
            className={inputClass}
          >
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {statusError && <p className="text-red-500 text-xs mt-1.5 max-w-xs">{statusError}</p>}
        </div>
      </div>

      {/* Bannière */}
      <section className="bg-white rounded-2xl border border-gray-100 p-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">Bannière</p>
        {event.banner_image_url && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={event.banner_image_url} alt="Bannière de l'événement" className="w-full max-h-56 object-cover rounded-lg mb-3" />
        )}
        <label className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-gray-200 cursor-pointer w-fit disabled:opacity-50">
          <IconUpload size={14} /> {uploadingBanner ? 'Téléversement…' : event.banner_image_url ? 'Changer l\'image' : 'Ajouter une bannière'}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleBannerChange} disabled={uploadingBanner} />
        </label>
      </section>

      {/* Hero : sous-titre + points forts */}
      <section className="bg-white rounded-2xl border border-gray-100 p-4">
        <p className="text-sm font-semibold text-gray-700 mb-1">Sous-titre &amp; points forts</p>
        <p className="text-xs text-gray-400 mb-3">Affichés dans le hero de la page événement. Optionnels.</p>

        <div className="mb-4">
          <label className="text-xs font-semibold text-gray-500 mb-1 block">Sous-titre</label>
          <input
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder="ex. La Première"
            className={`${inputClass} w-full`}
          />
        </div>

        <div className="space-y-3 mb-3">
          {highlights.map((h, i) => (
            <div key={i} className="border border-gray-100 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-2xs font-semibold text-gray-400 uppercase tracking-wide">Point fort {i + 1}</p>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeHighlightRow(i)}>
                  <IconTrash size={14} />
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                {HIGHLIGHT_ICON_OPTIONS.map(({ key, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => updateHighlightRow(i, 'icon', key)}
                    title={key}
                    aria-label={key}
                    className="w-9 h-9 rounded-lg border flex items-center justify-center shrink-0"
                    style={h.icon === key
                      ? { borderColor: 'var(--color-primary)', backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, white)', color: 'var(--color-primary)' }
                      : { borderColor: '#e5e7eb', color: '#9ca3af' }}
                  >
                    <Icon size={18} />
                  </button>
                ))}
              </div>
              <input
                value={h.title}
                onChange={(e) => updateHighlightRow(i, 'title', e.target.value)}
                placeholder="Titre (ex. Braises authentiques)"
                className={`${inputClass} w-full`}
              />
              <textarea
                value={h.text}
                onChange={(e) => updateHighlightRow(i, 'text', e.target.value)}
                placeholder="Texte"
                rows={2}
                className={`${inputClass} w-full resize-none`}
              />
            </div>
          ))}
          {highlights.length === 0 && <p className="text-xs text-gray-400">Aucun point fort — section masquée sur la page événement.</p>}
        </div>

        {highlights.length < MAX_HIGHLIGHTS && (
          <Button type="button" variant="ghost" size="sm" onClick={addHighlightRow} className="mb-3">
            <IconPlus size={14} /> Ajouter un point fort
          </Button>
        )}

        {highlightsError && <p className="text-red-500 text-xs mb-2">{highlightsError}</p>}
        <Button type="button" onClick={saveHighlights} loading={savingHighlights}>
          {savingHighlights ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </section>

      {/* Formules */}
      <section className="bg-white rounded-2xl border border-gray-100 p-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">Formules</p>
        <div className="space-y-2 mb-3">
          {ticketTypes.map((t) => (
            <div key={t.id} className="py-1.5 border-b border-gray-50 last:border-0">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${t.active ? 'text-gray-900' : 'text-gray-400 line-through'}`}>{t.label}</p>
                  <p className="text-xs text-gray-500">{formatPrice(t.price, currency)}</p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeTicketType(t.id)} className="shrink-0">
                  <IconTrash size={15} />
                </Button>
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                <IconStarFilled size={13} className="text-gray-300 shrink-0" />
                <input
                  value={badgeDrafts[t.id] ?? ''}
                  onChange={(e) => setBadgeDrafts((prev) => ({ ...prev, [t.id]: e.target.value }))}
                  placeholder="es. LA PLUS POPULAIRE"
                  className={`${inputClass} flex-1 text-xs py-1.5`}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => saveBadge(t.id)}
                  disabled={(badgeDrafts[t.id] ?? '') === (t.badge ?? '')}
                  loading={savingBadge === t.id}
                  className="shrink-0"
                >
                  OK
                </Button>
              </div>
            </div>
          ))}
          {ticketTypes.length === 0 && <p className="text-xs text-gray-400">Aucune formule — ajoutez-en une ci-dessous.</p>}
        </div>
        <form onSubmit={addTicketType} className="space-y-2">
          <div className="flex items-center gap-2">
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Libellé (ex. Formule Repas)" className={`${inputClass} flex-1`} />
            <input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Description (optionnel)" className={`${inputClass} flex-1`} />
            <input value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="Prix" inputMode="decimal" className={`${inputClass} w-24`} />
          </div>
          <div className="flex items-center gap-2">
            <input value={newBadge} onChange={(e) => setNewBadge(e.target.value)} placeholder="es. LA PLUS POPULAIRE" className={`${inputClass} flex-1`} />
            <Button type="submit" loading={addingTicket} className="shrink-0">
              <IconPlus size={16} />
            </Button>
          </div>
        </form>
        {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
      </section>

      {/* Paiements en attente (Phase 2 — lien externe) — même structure
          visuelle que le bandeau boutique (Phase 1, PendingPaymentsBanner.tsx),
          adaptée aux formules/tickets plutôt qu'aux produits panier. */}
      {pendingRequests.length > 0 && (
        <section className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-2xl p-4">
          <h2 className="text-sm font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5 mb-1">
            <IconClock size={16} /> Paiements en attente ({pendingRequests.length})
          </h2>
          <p className="text-xs text-amber-700 dark:text-amber-400 mb-3">
            Ces demandes ne sont pas encore des réservations — aucune place n&apos;est réservée.
          </p>
          <div className="space-y-2">
            {pendingRequests.map((request) => {
              const itemsSummary = request.items
                .map((i) => `${i.quantity}× ${ticketTypes.find((t) => t.id === i.ticket_type_id)?.label ?? '—'}`)
                .join(', ');
              return (
                <div
                  key={request.id}
                  className="bg-white dark:bg-gray-900 rounded-xl border border-amber-100 dark:border-amber-900/60 p-3 flex flex-col sm:flex-row sm:items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {request.payment_method_label}
                      </span>
                      <span className="text-xs text-gray-400">·</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {request.customer_name || request.customer_email}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{itemsSummary}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{elapsedLabel(request.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
                      {formatPrice(request.amount, currency)}
                    </span>
                    <ConfirmPaymentButton
                      endpoint={`/api/admin/evenementiel/reservation-requests/${request.id}/confirm-payment`}
                      label="Confirmer réception"
                      confirmingLabel="Confirmation…"
                      className="py-2 px-3 rounded-lg font-semibold text-white text-xs whitespace-nowrap transition-opacity disabled:opacity-50"
                      style={{ backgroundColor: '#D97706' }}
                      onSuccess={(warning) => {
                        if (!warning) {
                          setPendingRequests((prev) => prev.filter((r) => r.id !== request.id));
                        }
                        router.refresh();
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Réservations */}
      <section className="bg-white rounded-2xl border border-gray-100 p-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">Réservations ({reservations.length})</p>
        {reservations.length === 0 ? (
          <p className="text-xs text-gray-400">Aucune réservation pour le moment.</p>
        ) : (
          <div className="space-y-2">
            {reservations.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 py-2 border-b border-gray-50 last:border-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{r.customer_name}</p>
                  <p className="text-xs text-gray-500">
                    {r.customer_email} · {r.quantity_remaining}/{r.quantity_total} places · {formatPrice(r.amount_paid, currency)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-2xs font-semibold px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                    {RESERVATION_STATUS_LABELS[r.status]}
                  </span>
                  {r.status === 'confirmed' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => refundReservation(r.id)}
                      loading={refunding === r.id}
                      title="Rembourser"
                    >
                      <IconReceiptRefund size={16} />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
