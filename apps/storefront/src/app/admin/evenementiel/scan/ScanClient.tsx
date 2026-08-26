'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconAlertCircle,
  IconArrowBackUp,
  IconCheck,
  IconChevronDown,
  IconHistory,
  IconMinus,
  IconPlus,
  IconRotate,
  IconSearch,
  IconTicket,
  IconWifiOff,
  IconX,
} from '@tabler/icons-react';
import { CameraScanButton } from '../../loyalty/scan/CameraScanButton';
import { extractQrToken } from '@/lib/events/ticketUrl';

type Step = 'scan' | 'preview' | 'success';

type ScanEvent = {
  id: string;
  title: string;
  date_start: string;
  status: 'draft' | 'published' | 'closed' | 'cancelled';
  checkin_opens_at?: string | null;
  checkin_closes_at?: string | null;
};

interface ScanPreviewItem {
  reservation_item_id: string;
  ticket_type_name: string;
  quantity_totale: number;
  quantity_redenta_netta: number;
  ultima_redemption: {
    id: string;
    quantity: number;
    redeemed_at: string;
    redeemed_by_name: string | null;
    can_undo: boolean;
    undo_requires_reason: boolean;
  } | null;
}

interface ReservationHistoryEntry {
  id: string;
  ticket_type_name: string;
  quantity: number;
  redeemed_at: string;
  redeemed_by_name: string | null;
  voided_at: string | null;
  voided_by_name: string | null;
  void_reason: string | null;
}

interface PreviewData {
  reservation_id: string;
  customer_name: string;
  event_title: string | null;
  status: 'confirmed' | 'cancelled' | 'refunded';
  quantity_total: number;
  quantity_remaining: number;
  redeemable: boolean;
  blocking_reason: string | null;
  checkin_opens_at: string | null;
  checkin_closes_at: string | null;
  items: ScanPreviewItem[];
  history: ReservationHistoryEntry[];
}

interface ScanResult {
  remaining: number | null;
  customerName: string | null;
  eventTitle: string | null;
  served: number;
}

interface RecentDelivery {
  id: string;
  redeemed_at: string;
  customer_name: string;
  ticket_type_name: string;
  quantity: number;
}

interface FormulaServiceMetric {
  ticket_type_id: string;
  label: string;
  total: number;
  served: number;
  remaining: number;
}

interface ScanMetrics {
  reservations: number;
  reservations_started: number;
  rights_total: number;
  rights_redeemed: number;
  rights_remaining: number;
  progress_percent: number;
  formula_breakdown: FormulaServiceMetric[];
  recent_deliveries: RecentDelivery[];
}

interface ReservationSearchResult {
  id: string;
  reference: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  qr_token: string;
  quantity_total: number;
  quantity_remaining: number;
  status: string;
}

function formatEventLabel(event: ScanEvent): string {
  const date = new Date(event.date_start).toLocaleString('fr-FR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  return `${event.title} — ${date}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export function ScanClient({ eventsEnabled, events, initialEventId }: { eventsEnabled: boolean; events: ScanEvent[]; initialEventId: string }) {
  const [step, setStep] = useState<Step>('scan');
  const [selectedEventId, setSelectedEventId] = useState(initialEventId);
  const [qrToken, setQrToken] = useState('');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [deltas, setDeltas] = useState<Record<string, number>>({});
  const [result, setResult] = useState<ScanResult | null>(null);
  const [metrics, setMetrics] = useState<ScanMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editQuantities, setEditQuantities] = useState(false);
  const [voidTarget, setVoidTarget] = useState<{ redemptionId: string; ticketTypeName: string; requiresReason: boolean } | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidLoading, setVoidLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [reservationQuery, setReservationQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<ReservationSearchResult[]>([]);
  const ticketCardRef = useRef<HTMLElement | null>(null);

  const selectedEvent = useMemo(() => events.find(event => event.id === selectedEventId) ?? null, [events, selectedEventId]);

  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    if (step !== 'success') return;
    const timer = window.setTimeout(() => reset(), 5000);
    return () => window.clearTimeout(timer);
  }, [step]);

  useEffect(() => {
    if (step !== 'preview') return;
    const timer = window.setTimeout(() => ticketCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    return () => window.clearTimeout(timer);
  }, [step, preview?.reservation_id]);

  useEffect(() => {
    if (!selectedEventId || !isOnline) return;
    let active = true;
    async function refreshMetrics() {
      try {
        const res = await fetch(`/api/admin/evenementiel/scan/metrics?event_id=${encodeURIComponent(selectedEventId)}`, { cache: 'no-store' });
        const data = await res.json();
        if (active && res.ok) setMetrics(data as ScanMetrics);
      } catch {
        // Metrics never block the cashier flow.
      }
    }
    void refreshMetrics();
    const timer = window.setInterval(() => { void refreshMetrics(); }, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [selectedEventId, isOnline]);

  async function refreshMetricsNow() {
    if (!selectedEventId || !isOnline) return;
    try {
      const res = await fetch(`/api/admin/evenementiel/scan/metrics?event_id=${encodeURIComponent(selectedEventId)}`, { cache: 'no-store' });
      if (res.ok) setMetrics(await res.json() as ScanMetrics);
    } catch {
      // Non-blocking.
    }
  }

  function residual(item: ScanPreviewItem): number {
    return Math.max(0, item.quantity_totale - item.quantity_redenta_netta);
  }

  function selectAllRemaining(next: PreviewData) {
    const selected: Record<string, number> = {};
    for (const item of next.items) {
      const remaining = residual(item);
      if (remaining > 0) selected[item.reservation_item_id] = remaining;
    }
    setDeltas(selected);
  }

  async function loadPreview(token: string) {
    if (!isOnline) {
      setError('Connexion perdue — le service est temporairement impossible.');
      return;
    }
    if (!selectedEventId) {
      setError('Aucun événement actif pour le service.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ event_id: selectedEventId });
      const res = await fetch(`/api/admin/evenementiel/scan/${encodeURIComponent(token)}?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Erreur lors de la lecture de la réservation.');
        return;
      }
      const next = data as PreviewData;
      setPreview(next);
      setEditQuantities(false);
      if (next.redeemable) selectAllRemaining(next); else setDeltas({});
      setStep('preview');
    } catch {
      setError('Erreur réseau — réessayez.');
    } finally {
      setLoading(false);
    }
  }

  async function handleReservationSearch(event: React.FormEvent) {
    event.preventDefault();
    if (!isOnline || !selectedEventId || reservationQuery.trim().length < 2) return;
    setSearching(true);
    setSearchError(null);
    setSearchResults([]);
    try {
      const params = new URLSearchParams({ event_id: selectedEventId, q: reservationQuery.trim() });
      const res = await fetch(`/api/admin/evenementiel/scan/search?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        setSearchError(data.error ?? 'Recherche impossible.');
        return;
      }
      setSearchResults((data.results ?? []) as ReservationSearchResult[]);
    } catch {
      setSearchError('Erreur réseau — réessayez.');
    } finally {
      setSearching(false);
    }
  }

  function handleEventChange(eventId: string) {
    setSelectedEventId(eventId);
    reset(false);
  }

  function handleScanSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!qrToken.trim() || !selectedEventId || !isOnline) return;
    const token = extractQrToken(qrToken);
    setQrToken(token);
    void loadPreview(token);
  }

  function setDelta(itemId: string, next: number, max: number) {
    setDeltas(previous => ({ ...previous, [itemId]: Math.max(0, Math.min(max, next)) }));
  }

  async function handleConfirm() {
    if (!preview || !selectedEventId || !preview.redeemable || !isOnline) return;
    const items = Object.entries(deltas).filter(([, quantity]) => quantity > 0).map(([reservation_item_id, quantity]) => ({ reservation_item_id, quantity }));
    const served = items.reduce((sum, item) => sum + item.quantity, 0);
    if (served === 0) {
      setError('Sélectionnez au moins une formule à servir.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/evenementiel/scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ qr_token: qrToken, event_id: selectedEventId, items }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && data.reservationItemId) {
          await loadPreview(qrToken);
          setError('La réservation a été mise à jour — données actualisées.');
          return;
        }
        setError(data.error ?? 'Erreur lors de la validation.');
        return;
      }
      setResult({ remaining: data.remaining, customerName: data.customerName, eventTitle: data.eventTitle, served });
      setStep('success');
      void refreshMetricsNow();
    } catch {
      setError('Erreur réseau — réessayez.');
    } finally {
      setLoading(false);
    }
  }

  async function handleVoidConfirm() {
    if (!voidTarget || !selectedEventId || !isOnline) return;
    if (voidTarget.requiresReason && !voidReason.trim()) {
      setError('Un motif est requis pour cette annulation.');
      return;
    }
    setVoidLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/evenementiel/scan/undo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redemption_id: voidTarget.redemptionId, event_id: selectedEventId, reason: voidReason.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Erreur lors de l'annulation.");
        return;
      }
      setVoidTarget(null);
      setVoidReason('');
      await loadPreview(qrToken);
      void refreshMetricsNow();
    } catch {
      setError('Erreur réseau — réessayez.');
    } finally {
      setVoidLoading(false);
    }
  }

  function reset(clearError = true) {
    setStep('scan');
    setQrToken('');
    setPreview(null);
    setDeltas({});
    setResult(null);
    setEditQuantities(false);
    setReservationQuery('');
    setSearchResults([]);
    setSearchError(null);
    if (clearError) setError(null);
  }

  if (!eventsEnabled) return <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Le module événementiel n&apos;est pas activé.</div>;
  if (events.length === 0 || !selectedEventId) return <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">Aucun événement disponible pour le service des formules.</div>;

  const selectedQuantity = Object.values(deltas).reduce((sum, quantity) => sum + Math.max(0, quantity), 0);
  const isExhausted = preview?.status === 'confirmed' && preview.quantity_remaining <= 0;
  const latestValidService = preview?.history.find(entry => !entry.voided_at) ?? null;
  const statusLabel = preview
    ? !preview.redeemable
      ? preview.blocking_reason ?? 'Réservation non utilisable'
      : preview.quantity_remaining < preview.quantity_total
        ? `Réservation partiellement servie — ${preview.quantity_remaining}/${preview.quantity_total} restantes`
        : 'Réservation valide'
    : null;

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><IconTicket size={18} /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-bold text-gray-950">{selectedEvent?.title}</h1>
              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-emerald-700">Service actif</span>
            </div>
            <p className="mt-0.5 text-[11px] text-gray-500">Retrait des formules réservées</p>
          </div>
        </div>
        {events.length > 1 && (
          <details className="mt-2 border-t border-gray-100 pt-2">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between text-xs font-semibold text-gray-500">Changer d&apos;événement <IconChevronDown size={15} /></summary>
            <select value={selectedEventId} onChange={event => handleEventChange(event.target.value)} disabled={loading || voidLoading} className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900">
              {events.map(event => <option key={event.id} value={event.id}>{formatEventLabel(event)}</option>)}
            </select>
          </details>
        )}
      </section>

      {!isOnline && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border-2 border-red-300 bg-red-50 px-4 py-4 text-red-900">
          <IconWifiOff size={22} className="mt-0.5 shrink-0" />
          <div><p className="font-black">Connexion perdue</p><p className="mt-1 text-sm font-medium">Scan, recherche et validation sont bloqués jusqu&apos;au retour du réseau.</p></div>
        </div>
      )}

      {error && <div className="flex items-start gap-2 rounded-2xl border-2 border-red-200 bg-red-50 px-4 py-3"><IconAlertCircle size={19} className="mt-0.5 shrink-0 text-red-600" /><p className="text-sm font-semibold text-red-800">{error}</p></div>}

      {step === 'scan' && (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-5 text-center"><h2 className="text-xl font-black text-gray-950">Scanner la réservation</h2><p className="mt-1 text-sm text-gray-500">Le repas à remettre s&apos;affichera automatiquement.</p></div>
          {isOnline ? (
            <CameraScanButton variant="primary" label="Scanner le QR code" onDecoded={text => { const token = extractQrToken(text); setQrToken(token); void loadPreview(token); }} />
          ) : (
            <button type="button" disabled className="min-h-16 w-full rounded-2xl bg-gray-200 text-base font-extrabold text-gray-500">Caméra indisponible hors connexion</button>
          )}
          <p className="mt-2 text-center text-xs font-medium text-gray-400">Mode recommandé pour le service</p>

          <details className="mt-5 border-t border-gray-100 pt-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold text-gray-500">Saisir un code manuellement <IconChevronDown size={16} /></summary>
            <form onSubmit={handleScanSubmit} className="mt-2 flex flex-col gap-3">
              <input type="text" autoComplete="off" value={qrToken} onChange={event => setQrToken(event.target.value)} placeholder="Code QR ou code réservation" disabled={loading || !isOnline} className="w-full rounded-xl border-2 border-gray-200 px-4 py-4 text-center text-sm tracking-wide focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:bg-gray-100" />
              <button type="submit" disabled={!qrToken.trim() || loading || !isOnline} className="min-h-12 w-full rounded-xl border border-gray-200 bg-gray-50 font-bold text-gray-700 disabled:opacity-50">{loading ? 'Lecture…' : 'Rechercher la réservation'}</button>
            </form>
          </details>

          <details className="mt-3 border-t border-gray-100 pt-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold text-gray-500"><span className="flex items-center gap-2"><IconSearch size={16} />Client sans QR ?</span><IconChevronDown size={16} /></summary>
            <form onSubmit={handleReservationSearch} className="mt-2 space-y-3">
              <p className="text-xs text-gray-500">Recherche par nom, e-mail, téléphone, QR ou référence complète.</p>
              <div className="flex gap-2">
                <input value={reservationQuery} onChange={event => setReservationQuery(event.target.value)} disabled={!isOnline || searching} placeholder="Nom, e-mail ou référence" className="min-h-12 min-w-0 flex-1 rounded-xl border border-gray-200 px-3 text-sm disabled:bg-gray-100" />
                <button type="submit" disabled={!isOnline || searching || reservationQuery.trim().length < 2} className="min-h-12 rounded-xl bg-gray-900 px-4 text-sm font-bold text-white disabled:opacity-40">{searching ? '…' : 'Chercher'}</button>
              </div>
              {searchError && <p className="text-xs font-semibold text-red-700">{searchError}</p>}
              {!searching && reservationQuery.trim().length >= 2 && searchResults.length === 0 && !searchError && <p className="text-xs text-gray-500">Aucun résultat chargé. Lancez la recherche.</p>}
              {searchResults.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  {searchResults.map(item => (
                    <button key={item.id} type="button" onClick={() => { setQrToken(item.qr_token); void loadPreview(item.qr_token); }} disabled={!isOnline} className="flex w-full items-center gap-3 border-b border-gray-100 px-3 py-3 text-left last:border-0 hover:bg-gray-50 disabled:opacity-50">
                      <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-gray-900">{item.customer_name}</p><p className="truncate text-xs text-gray-500">{item.customer_email}{item.customer_phone ? ` · ${item.customer_phone}` : ''}</p><p className="mt-0.5 text-[11px] text-gray-400">Réf. {item.reference}</p></div>
                      <div className={`shrink-0 rounded-lg px-2 py-1 text-xs font-bold ${item.quantity_remaining > 0 && item.status === 'confirmed' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{item.quantity_remaining}/{item.quantity_total}</div>
                    </button>
                  ))}
                </div>
              )}
            </form>
          </details>
        </section>
      )}

      {step === 'preview' && preview && (
        <section ref={ticketCardRef} className={`scroll-mt-20 rounded-2xl border-2 bg-white p-5 shadow-lg ${isExhausted ? 'border-red-400' : 'border-gray-300'}`}>
          <div className="flex items-center gap-3 border-b border-gray-100 pb-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gray-100"><IconTicket size={22} className="text-gray-700" /></div>
            <div className="min-w-0 flex-1"><p className="truncate text-lg font-black text-gray-950">{preview.customer_name}</p><p className="truncate text-xs text-gray-500">{preview.event_title}</p><p className="mt-1 text-[11px] font-medium text-gray-400">Réservation {preview.reservation_id.slice(0, 8).toUpperCase()}</p></div>
          </div>

          {isExhausted ? (
            <div className="mt-4 rounded-2xl border-2 border-red-500 bg-red-50 px-4 py-5 text-center text-red-950">
              <IconX size={36} className="mx-auto" />
              <p className="mt-2 text-2xl font-black tracking-tight">DÉJÀ SERVI</p>
              <p className="mt-1 text-base font-extrabold">AUCUN REPAS À REMETTRE</p>
              {latestValidService && (
                <div className="mt-4 rounded-xl bg-white/80 px-3 py-3 text-left text-xs text-red-900">
                  <p className="font-bold">Dernier service : {latestValidService.ticket_type_name} × {latestValidService.quantity}</p>
                  <p className="mt-1">{formatDateTime(latestValidService.redeemed_at)}</p>
                  <p className="mt-0.5">Opérateur : {latestValidService.redeemed_by_name || 'Non identifié'}</p>
                </div>
              )}
            </div>
          ) : (
            <div className={`mt-4 rounded-xl border-2 px-4 py-3 text-sm font-bold ${preview.redeemable ? preview.quantity_remaining < preview.quantity_total ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-800'}`}>{statusLabel}</div>
          )}

          <details open={!preview.redeemable} className="mt-4 rounded-xl border border-gray-200 bg-gray-50">
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 text-sm font-bold text-gray-700"><IconHistory size={17} className="text-gray-500" />Historique de cette réservation<span className="ml-auto text-xs font-medium text-gray-400">{preview.history.length} opération{preview.history.length > 1 ? 's' : ''}</span><IconChevronDown size={15} className="text-gray-400" /></summary>
            <div className="border-t border-gray-200 bg-white px-3 py-2">
              {preview.history.length === 0 ? <p className="py-3 text-xs text-gray-500">Aucune formule n&apos;a encore été servie sur cette réservation.</p> : preview.history.map(entry => (
                <div key={entry.id} className="border-b border-gray-100 py-3 last:border-0">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className={`text-sm font-bold ${entry.voided_at ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{entry.ticket_type_name} × {entry.quantity}</p><p className="mt-1 text-xs text-gray-500">Servi le {formatDateTime(entry.redeemed_at)}</p><p className="mt-0.5 text-xs text-gray-500">Opérateur : {entry.redeemed_by_name || 'Non identifié'}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase ${entry.voided_at ? 'bg-gray-100 text-gray-600' : 'bg-emerald-50 text-emerald-700'}`}>{entry.voided_at ? 'Annulé' : 'Valide'}</span></div>
                  {entry.voided_at && <div className="mt-2 rounded-lg bg-gray-50 px-2.5 py-2 text-xs text-gray-600"><p>Annulé le {formatDateTime(entry.voided_at)}</p><p className="mt-0.5">Par : {entry.voided_by_name || 'Non identifié'}</p>{entry.void_reason && <p className="mt-0.5 font-medium">Motif : {entry.void_reason}</p>}</div>}
                </div>
              ))}
            </div>
          </details>

          {preview.redeemable && (
            <>
              <div className="mt-5 flex items-center justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">À servir maintenant</p><p className="mt-0.5 text-sm text-gray-500">Tout le solde est présélectionné.</p></div><button type="button" onClick={() => setEditQuantities(value => !value)} className="min-h-11 text-xs font-bold text-gray-600 underline underline-offset-4">{editQuantities ? 'Terminer' : 'Modifier les quantités'}</button></div>
              <div className="mt-3 space-y-3">
                {preview.items.map(item => {
                  const remaining = residual(item);
                  const quantity = deltas[item.reservation_item_id] ?? 0;
                  const fullyServed = remaining === 0;
                  return (
                    <div key={item.reservation_item_id} className={`rounded-2xl border p-4 ${fullyServed ? 'border-gray-200 bg-gray-50' : 'border-gray-200 bg-white'}`}>
                      <div className="flex items-center justify-between gap-4"><div className="min-w-0"><p className={`text-base font-extrabold ${fullyServed ? 'text-gray-400 line-through' : 'text-gray-950'}`}>{item.ticket_type_name}</p>{item.quantity_redenta_netta > 0 && <p className="mt-1 text-xs text-gray-500">{item.quantity_redenta_netta} déjà servie{item.quantity_redenta_netta > 1 ? 's' : ''} · {remaining} restante{remaining > 1 ? 's' : ''}</p>}</div>
                        {!fullyServed && !editQuantities && <div className="shrink-0 text-3xl font-black text-gray-950">× {quantity}</div>}
                        {!fullyServed && editQuantities && <div className="flex shrink-0 items-center gap-2"><button type="button" onClick={() => setDelta(item.reservation_item_id, quantity - 1, remaining)} disabled={loading || quantity <= 0 || !isOnline} aria-label="Diminuer" className="flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 disabled:opacity-40"><IconMinus size={16} /></button><span className="w-6 text-center text-lg font-black">{quantity}</span><button type="button" onClick={() => setDelta(item.reservation_item_id, quantity + 1, remaining)} disabled={loading || quantity >= remaining || !isOnline} aria-label="Augmenter" className="flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 disabled:opacity-40"><IconPlus size={16} /></button></div>}
                      </div>
                      {item.ultima_redemption?.can_undo && <button type="button" disabled={!isOnline} onClick={() => { setVoidTarget({ redemptionId: item.ultima_redemption!.id, ticketTypeName: item.ticket_type_name, requiresReason: item.ultima_redemption!.undo_requires_reason }); setVoidReason(''); }} className="mt-2 flex min-h-11 items-center gap-1 text-xs font-medium text-gray-500 disabled:opacity-40"><IconArrowBackUp size={14} />Annuler le dernier service</button>}
                    </div>
                  );
                })}
              </div>
              <button type="button" onClick={handleConfirm} disabled={loading || selectedQuantity <= 0 || !isOnline} className="mt-5 min-h-14 w-full rounded-xl text-base font-extrabold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--color-primary)' }}>{loading ? 'Validation…' : !isOnline ? 'Connexion requise' : `Servir ${selectedQuantity} formule${selectedQuantity > 1 ? 's' : ''}`}</button>
            </>
          )}
          <button type="button" onClick={() => reset()} disabled={loading} className="mt-3 min-h-11 w-full rounded-xl border border-gray-200 text-sm font-semibold text-gray-500">Scanner une autre réservation</button>
        </section>
      )}

      {step === 'success' && result && (
        <section className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-6 text-center shadow-sm"><div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-600 text-white"><IconCheck size={42} /></div><p className="mt-4 text-2xl font-black text-emerald-950">{result.served} formule{result.served > 1 ? 's' : ''} servie{result.served > 1 ? 's' : ''}</p><p className="mt-1 font-bold text-emerald-900">{result.customerName || 'Réservation'}</p>{result.remaining !== null && <p className="mt-2 text-sm text-emerald-800">{result.remaining} formule{result.remaining > 1 ? 's' : ''} restante{result.remaining > 1 ? 's' : ''} sur la réservation</p>}<p className="mt-4 text-xs font-semibold text-emerald-700">Retour automatique au scanner dans 5 secondes</p><button type="button" onClick={() => reset()} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 font-bold text-white"><IconRotate size={18} />Scanner le suivant</button></section>
      )}

      {metrics && (
        <details className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 text-xs font-semibold text-gray-600"><span>Suivi du service</span><span className="ml-auto font-bold text-gray-900">{metrics.rights_redeemed} servies</span><span className="text-gray-300">·</span><span className="font-bold text-gray-900">{metrics.rights_remaining} à servir</span><span className="text-gray-300">·</span><span className="font-bold text-gray-900">{metrics.progress_percent}%</span><IconChevronDown size={14} className="shrink-0 text-gray-400" /></summary>
          <div className="border-t border-gray-100 p-3">
            <div className="grid grid-cols-3 gap-2"><div className="rounded-lg bg-gray-50 px-2 py-2 text-center"><p className="text-lg font-extrabold text-gray-950">{metrics.rights_redeemed}</p><p className="text-[10px] font-medium text-gray-500">servies</p></div><div className="rounded-lg bg-gray-50 px-2 py-2 text-center"><p className="text-lg font-extrabold text-gray-950">{metrics.rights_remaining}</p><p className="text-[10px] font-medium text-gray-500">à servir</p></div><div className="rounded-lg bg-gray-50 px-2 py-2 text-center"><p className="text-lg font-extrabold text-gray-950">{metrics.progress_percent}%</p><p className="text-[10px] font-medium text-gray-500">progression</p></div></div>
            {metrics.formula_breakdown.length > 0 && <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">{metrics.formula_breakdown.map(formula => { const percent = formula.total > 0 ? Math.round((formula.served / formula.total) * 100) : 0; return <div key={formula.ticket_type_id} className="rounded-lg bg-gray-50 px-3 py-2"><div className="flex items-center justify-between gap-3 text-xs"><span className="truncate font-bold text-gray-800">{formula.label}</span><span className={`shrink-0 font-bold ${formula.remaining === 0 ? 'text-emerald-700' : 'text-gray-700'}`}>{formula.remaining === 0 ? 'Terminé' : `${formula.remaining} restantes`}</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-200"><div className="h-full rounded-full bg-gray-700" style={{ width: `${Math.min(100, percent)}%` }} /></div><p className="mt-1 text-[10px] text-gray-500">{formula.served}/{formula.total} servies</p></div>; })}</div>}
          </div>
        </details>
      )}

      {metrics && metrics.recent_deliveries.length > 0 && (
        <details className="rounded-2xl border border-gray-200 bg-white shadow-sm"><summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 text-sm font-bold text-gray-800"><IconHistory size={18} className="text-gray-500" /><span>Historique des formules servies</span><span className="ml-auto text-xs font-medium text-gray-400">{metrics.recent_deliveries.length} dernières</span><IconChevronDown size={16} className="text-gray-400" /></summary><div className="border-t border-gray-100 px-4 py-2">{metrics.recent_deliveries.map(delivery => <div key={delivery.id} className="flex items-start gap-3 border-b border-gray-100 py-3 last:border-0"><div className="w-12 shrink-0 text-xs font-bold text-gray-500">{formatTime(delivery.redeemed_at)}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-gray-900">{delivery.customer_name}</p><p className="mt-0.5 text-xs text-gray-500">{delivery.ticket_type_name}</p></div><div className="shrink-0 rounded-lg bg-emerald-50 px-2.5 py-1 text-sm font-black text-emerald-800">× {delivery.quantity}</div></div>)}</div></details>
      )}

      {voidTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-sm rounded-2xl bg-white shadow-xl"><div className="flex items-center justify-between border-b border-gray-100 px-5 py-3"><h2 className="text-sm font-bold">Annuler le dernier service</h2><button type="button" onClick={() => setVoidTarget(null)} disabled={voidLoading} aria-label="Fermer" className="flex h-11 w-11 items-center justify-center"><IconX size={17} /></button></div><div className="space-y-3 px-5 py-4"><p className="text-sm text-gray-600">Annuler le dernier service pour <strong>{voidTarget.ticketTypeName}</strong> ?</p>{voidTarget.requiresReason && <label className="block text-xs font-semibold text-gray-600">Motif<textarea value={voidReason} onChange={event => setVoidReason(event.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-gray-200 p-3 text-sm" /></label>}<div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setVoidTarget(null)} disabled={voidLoading} className="min-h-11 rounded-xl border border-gray-200 text-sm font-bold text-gray-600">Retour</button><button type="button" onClick={handleVoidConfirm} disabled={voidLoading || !isOnline || (voidTarget.requiresReason && !voidReason.trim())} className="min-h-11 rounded-xl bg-red-600 text-sm font-bold text-white disabled:opacity-50">{voidLoading ? 'Annulation…' : 'Confirmer'}</button></div></div></div></div>
      )}
    </div>
  );
}
