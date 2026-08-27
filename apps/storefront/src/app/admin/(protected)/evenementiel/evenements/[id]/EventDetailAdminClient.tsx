'use client';

import { useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { EventHighlight, EventReservationRequest, EventReservationStatus, EventRow, EventStatus, EventTicketType } from '@lepefy/types';
import type { AdminEventReservation } from './page';
import { HIGHLIGHT_ICON_OPTIONS } from '@/lib/events/highlightIcons';
import ConfirmActionModal from '../../../../_components/ui/ConfirmActionModal';
import { EventAdminHeader, type EventAdminTab } from './_components/EventAdminHeader';
import EventSummaryTab from './_components/EventSummaryTab';
import EventReservationsTab from './_components/EventReservationsTab';
import EventTicketingTab from './_components/EventTicketingTab';
import EventPageTab from './_components/EventPageTab';

interface Props {
  event: EventRow;
  initialTicketTypes: EventTicketType[];
  initialReservations: AdminEventReservation[];
  initialPendingRequests: EventReservationRequest[];
  currency: string;
}

const VALID_TABS: EventAdminTab[] = ['summary', 'reservations', 'ticketing', 'page'];
const MAX_HIGHLIGHTS = 3;

export default function EventDetailAdminClient({ event: initialEvent, initialTicketTypes, initialReservations, initialPendingRequests, currency }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab') as EventAdminTab | null;
  const activeTab: EventAdminTab = requestedTab && VALID_TABS.includes(requestedTab) ? requestedTab : 'summary';

  const [event, setEvent] = useState(initialEvent);
  const [ticketTypes, setTicketTypes] = useState(initialTicketTypes);
  const [reservations, setReservations] = useState(initialReservations);
  const [pendingRequests, setPendingRequests] = useState(initialPendingRequests);
  const [savingStatus, setSavingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const [reservationSearch, setReservationSearch] = useState('');
  const [reservationStatusFilter, setReservationStatusFilter] = useState<'all' | EventReservationStatus>('all');
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [editingEmailId, setEditingEmailId] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState('');
  const [resendFeedbackId, setResendFeedbackId] = useState<string | null>(null);
  const [reservationError, setReservationError] = useState<string | null>(null);

  const [addingTicket, setAddingTicket] = useState(false);
  const [savingTicketId, setSavingTicketId] = useState<string | null>(null);
  const [pendingRemoveTicketId, setPendingRemoveTicketId] = useState<string | null>(null);
  const [ticketError, setTicketError] = useState<string | null>(null);

  const [uploadingBanner, setUploadingBanner] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [subtitle, setSubtitle] = useState(initialEvent.subtitle ?? '');
  const [highlights, setHighlights] = useState<EventHighlight[]>(initialEvent.highlights ?? []);
  const [savingPage, setSavingPage] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageSaved, setPageSaved] = useState(false);

  function setTab(tab: EventAdminTab) {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === 'summary') params.delete('tab');
    else params.set('tab', tab);
    const query = params.toString();
    router.push(query ? `?${query}` : '?');
  }

  async function updateStatus(status: EventStatus) {
    setStatusError(null);
    if (status === 'published' && ticketTypes.filter((ticket) => ticket.active).length === 0) {
      setStatusError('Impossible de publier un événement sans au moins une formule active.');
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
      setEvent(result as EventRow);
      router.refresh();
    } catch {
      setStatusError('Erreur réseau lors du changement de statut.');
    } finally {
      setSavingStatus(false);
    }
  }

  async function closeEvent() {
    await updateStatus('closed');
    setConfirmCloseOpen(false);
  }

  function onPendingConfirmed(id: string, warning?: string) {
    if (!warning) setPendingRequests((prev) => prev.filter((request) => request.id !== id));
    router.refresh();
  }

  async function refundReservation(id: string): Promise<boolean> {
    setReservationError(null);
    setRefundingId(id);
    try {
      const res = await fetch(`/api/admin/evenementiel/reservations/${id}/refund`, { method: 'POST' });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReservationError(result.error ?? 'Erreur lors du remboursement.');
        return false;
      }
      setReservations((prev) => prev.map((reservationItem) => reservationItem.id === id ? { ...reservationItem, status: 'refunded' } : reservationItem));
      router.refresh();
      return true;
    } catch {
      setReservationError('Erreur réseau lors du remboursement.');
      return false;
    } finally {
      setRefundingId(null);
    }
  }

  function startEditingEmail(id: string, currentEmail: string) {
    setEditingEmailId(id);
    setEmailDraft(currentEmail);
    setReservationError(null);
  }

  function cancelEditingEmail() {
    setEditingEmailId(null);
    setEmailDraft('');
  }

  function showResendFeedback(id: string) {
    setResendFeedbackId(id);
    window.setTimeout(() => setResendFeedbackId((current) => current === id ? null : current), 3000);
  }

  async function confirmEmailEdit(id: string) {
    setReservationError(null);
    setResendingId(id);
    try {
      const res = await fetch(`/api/admin/evenementiel/reservations/${id}/resend-email`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailDraft }),
      });
      const result = await res.json();
      if (!res.ok) {
        setReservationError(result.error ?? 'Erreur lors de la modification et du renvoi du billet.');
        return;
      }
      setReservations((prev) => prev.map((reservation) => reservation.id === id ? { ...reservation, customer_email: result.email } : reservation));
      cancelEditingEmail();
      showResendFeedback(id);
    } catch {
      setReservationError('Erreur réseau lors du renvoi du billet.');
    } finally {
      setResendingId(null);
    }
  }

  async function resendReservation(id: string) {
    setReservationError(null);
    setResendingId(id);
    try {
      const res = await fetch(`/api/admin/evenementiel/reservations/${id}/resend-email`, { method: 'PATCH' });
      const result = await res.json();
      if (!res.ok) {
        setReservationError(result.error ?? 'Erreur lors du renvoi du billet.');
        return;
      }
      showResendFeedback(id);
    } catch {
      setReservationError('Erreur réseau lors du renvoi du billet.');
    } finally {
      setResendingId(null);
    }
  }

  async function createTicket(payload: { label: string; description: string | null; price: number; badge: string | null }) {
    setTicketError(null);
    setAddingTicket(true);
    try {
      const res = await fetch(`/api/admin/evenementiel/events/${event.id}/ticket-types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (!res.ok) {
        setTicketError(result.error ?? 'Erreur lors de la création de la formule.');
        return false;
      }
      setTicketTypes((prev) => [...prev, result as EventTicketType]);
      return true;
    } catch {
      setTicketError('Erreur réseau lors de la création de la formule.');
      return false;
    } finally {
      setAddingTicket(false);
    }
  }

  async function updateTicket(id: string, payload: { label: string; description: string | null; price: number; badge: string | null }) {
    setTicketError(null);
    setSavingTicketId(id);
    try {
      const res = await fetch(`/api/admin/evenementiel/ticket-types/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (!res.ok) {
        setTicketError(result.error ?? 'Erreur lors de la modification de la formule.');
        return false;
      }
      setTicketTypes((prev) => prev.map((ticket) => ticket.id === id ? result as EventTicketType : ticket));
      return true;
    } catch {
      setTicketError('Erreur réseau lors de la modification de la formule.');
      return false;
    } finally {
      setSavingTicketId(null);
    }
  }

  async function removeTicket(id: string) {
    setTicketError(null);
    setSavingTicketId(id);
    try {
      const res = await fetch(`/api/admin/evenementiel/ticket-types/${id}`, { method: 'DELETE' });
      const result = await res.json();
      if (!res.ok) {
        setTicketError(result.error ?? 'Erreur lors du retrait de la formule.');
        return;
      }
      if (result.deactivated) {
        setTicketTypes((prev) => prev.map((ticket) => ticket.id === id ? { ...ticket, active: false } : ticket));
      } else {
        setTicketTypes((prev) => prev.filter((ticket) => ticket.id !== id));
      }
      setPendingRemoveTicketId(null);
    } catch {
      setTicketError('Erreur réseau lors du retrait de la formule.');
    } finally {
      setSavingTicketId(null);
    }
  }

  async function handleBannerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPageError(null);
    setUploadingBanner(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('kind', 'event-banner');
      const uploadRes = await fetch('/api/admin/evenementiel/upload-image', { method: 'POST', body: formData });
      const uploadResult = await uploadRes.json();
      if (!uploadRes.ok) {
        setPageError(uploadResult.error ?? 'Erreur lors du téléversement de la bannière.');
        return;
      }
      const patchRes = await fetch(`/api/admin/evenementiel/events/${event.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ banner_image_url: uploadResult.imageUrl }),
      });
      const result = await patchRes.json();
      if (!patchRes.ok) {
        setPageError(result.error ?? 'Erreur lors de l’enregistrement de la bannière.');
        return;
      }
      setEvent(result as EventRow);
    } catch {
      setPageError('Erreur réseau lors de la bannière.');
    } finally {
      setUploadingBanner(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function addHighlight() {
    setHighlights((prev) => prev.length >= MAX_HIGHLIGHTS ? prev : [...prev, { icon: HIGHLIGHT_ICON_OPTIONS[0]?.key ?? 'sparkles', title: '', text: '' }]);
  }

  function updateHighlight(index: number, field: keyof EventHighlight, value: string) {
    setHighlights((prev) => prev.map((highlight, currentIndex) => currentIndex === index ? { ...highlight, [field]: value } : highlight));
    setPageSaved(false);
  }

  function removeHighlight(index: number) {
    setHighlights((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
    setPageSaved(false);
  }

  async function savePageContent() {
    setPageError(null);
    setPageSaved(false);
    const cleaned = highlights
      .filter((highlight) => highlight.title.trim() || highlight.text.trim())
      .slice(0, MAX_HIGHLIGHTS)
      .map((highlight) => ({ icon: highlight.icon, title: highlight.title.trim(), text: highlight.text.trim() }));
    setSavingPage(true);
    try {
      const res = await fetch(`/api/admin/evenementiel/events/${event.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtitle: subtitle.trim() || null, highlights: cleaned.length > 0 ? cleaned : null }),
      });
      const result = await res.json();
      if (!res.ok) {
        setPageError(result.error ?? 'Erreur lors de l’enregistrement.');
        return;
      }
      setEvent(result as EventRow);
      setHighlights(cleaned);
      setPageSaved(true);
    } catch {
      setPageError('Erreur réseau lors de l’enregistrement.');
    } finally {
      setSavingPage(false);
    }
  }

  return (
    <div>
      <EventAdminHeader event={event} activeTab={activeTab} onTabChange={setTab} onStatusChange={updateStatus} savingStatus={savingStatus} statusError={statusError} />

      {activeTab === 'summary' && (
        <EventSummaryTab
          event={event}
          ticketTypes={ticketTypes}
          reservations={reservations}
          pendingRequests={pendingRequests}
          currency={currency}
          onPendingConfirmed={onPendingConfirmed}
          onOpenReservations={() => setTab('reservations')}
          onOpenPage={() => setTab('page')}
          onCloseEvent={() => setConfirmCloseOpen(true)}
        />
      )}

      {activeTab === 'reservations' && (
        <EventReservationsTab
          eventId={event.id}
          reservations={reservations}
          ticketTypes={ticketTypes}
          currency={currency}
          search={reservationSearch}
          onSearchChange={setReservationSearch}
          statusFilter={reservationStatusFilter}
          onStatusFilterChange={setReservationStatusFilter}
          editingEmailId={editingEmailId}
          emailDraft={emailDraft}
          onEmailDraftChange={setEmailDraft}
          onStartEditEmail={startEditingEmail}
          onCancelEditEmail={cancelEditingEmail}
          onConfirmEmailEdit={confirmEmailEdit}
          onResend={resendReservation}
          onRefund={refundReservation}
          resendingId={resendingId}
          refundingId={refundingId}
          resendFeedbackId={resendFeedbackId}
          error={reservationError}
        />
      )}

      {activeTab === 'ticketing' && (
        <EventTicketingTab ticketTypes={ticketTypes} currency={currency} onCreate={createTicket} onUpdate={updateTicket} onRemove={setPendingRemoveTicketId} adding={addingTicket} savingId={savingTicketId} error={ticketError} />
      )}

      {activeTab === 'page' && (
        <EventPageTab
          event={event}
          subtitle={subtitle}
          onSubtitleChange={(value) => { setSubtitle(value); setPageSaved(false); }}
          highlights={highlights}
          onAddHighlight={addHighlight}
          onUpdateHighlight={updateHighlight}
          onRemoveHighlight={removeHighlight}
          onBannerChange={handleBannerChange}
          fileInputRef={fileInputRef}
          uploadingBanner={uploadingBanner}
          onSave={savePageContent}
          saving={savingPage}
          error={pageError}
          saved={pageSaved}
          maxHighlights={MAX_HIGHLIGHTS}
        />
      )}

      <ConfirmActionModal
        open={confirmCloseOpen}
        title="Clôturer cet événement ?"
        description="Les nouvelles réservations seront fermées. Les réservations et billets existants restent conservés dans l’historique."
        confirmLabel="Clôturer l’événement"
        cancelLabel="Conserver ouvert"
        loading={savingStatus}
        onCancel={() => setConfirmCloseOpen(false)}
        onConfirm={() => void closeEvent()}
      />

      <ConfirmActionModal
        open={pendingRemoveTicketId !== null}
        title="Retirer cette formule ?"
        description="Si cette formule est déjà utilisée par une réservation, elle sera désactivée afin de préserver l’historique. Sinon elle sera supprimée."
        confirmLabel="Retirer la formule"
        cancelLabel="Conserver"
        destructive
        loading={pendingRemoveTicketId !== null && savingTicketId === pendingRemoveTicketId}
        onCancel={() => setPendingRemoveTicketId(null)}
        onConfirm={() => { if (pendingRemoveTicketId) void removeTicket(pendingRemoveTicketId); }}
      />
    </div>
  );
}
