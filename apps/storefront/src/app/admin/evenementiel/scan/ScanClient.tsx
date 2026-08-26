'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconScan, IconCheck, IconAlertCircle, IconRotate, IconTicket,
  IconMinus, IconPlus, IconArrowBackUp, IconX, IconCalendarEvent, IconBolt, IconSettings,
} from '@tabler/icons-react';
import { CameraScanButton } from '../../loyalty/scan/CameraScanButton';
import { extractQrToken } from '@/lib/events/ticketUrl';

type Step = 'scan' | 'preview' | 'success';
type ScanMode = 'full' | 'quick';

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
}

interface ScanResult { remaining: number | null; customerName: string | null; eventTitle: string | null; }
interface ScanMetrics { reservations: number; reservations_started: number; rights_total: number; rights_redeemed: number; rights_remaining: number; }

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function formatEventLabel(event: ScanEvent): string {
  const date = new Date(event.date_start).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `${event.title} — ${date}`;
}
function toLocalInput(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
function toIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function ScanClient({
  eventsEnabled,
  events,
  initialEventId,
  canConfigureCheckin,
}: {
  eventsEnabled: boolean;
  events: ScanEvent[];
  initialEventId: string;
  canConfigureCheckin: boolean;
}) {
  const [step, setStep] = useState<Step>('scan');
  const [scanMode, setScanMode] = useState<ScanMode>('full');
  const [selectedEventId, setSelectedEventId] = useState(initialEventId);
  const [qrToken, setQrToken] = useState('');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [deltas, setDeltas] = useState<Record<string, number>>({});
  const [result, setResult] = useState<ScanResult | null>(null);
  const [metrics, setMetrics] = useState<ScanMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [voidTarget, setVoidTarget] = useState<{ redemptionId: string; ticketTypeName: string; requiresReason: boolean } | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidLoading, setVoidLoading] = useState(false);
  const [windowOpen, setWindowOpen] = useState('');
  const [windowClose, setWindowClose] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsFeedback, setSettingsFeedback] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedEvent = useMemo(() => events.find((event) => event.id === selectedEventId) ?? null, [events, selectedEventId]);

  useEffect(() => {
    if (step === 'scan' && selectedEventId) inputRef.current?.focus();
  }, [step, selectedEventId]);

  useEffect(() => {
    setWindowOpen(toLocalInput(selectedEvent?.checkin_opens_at));
    setWindowClose(toLocalInput(selectedEvent?.checkin_closes_at));
    setSettingsFeedback(null);
  }, [selectedEvent]);

  useEffect(() => {
    if (!selectedEventId) { setMetrics(null); return; }
    let active = true;
    async function refreshMetrics() {
      try {
        const res = await fetch(`/api/admin/evenementiel/scan/metrics?event_id=${encodeURIComponent(selectedEventId)}`, { cache: 'no-store' });
        const data = await res.json();
        if (active && res.ok) setMetrics(data);
      } catch { /* KPI non bloquants */ }
    }
    void refreshMetrics();
    const timer = window.setInterval(() => { void refreshMetrics(); }, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [selectedEventId]);

  async function refreshMetricsNow() {
    if (!selectedEventId) return;
    try {
      const res = await fetch(`/api/admin/evenementiel/scan/metrics?event_id=${encodeURIComponent(selectedEventId)}`, { cache: 'no-store' });
      if (res.ok) setMetrics(await res.json());
    } catch { /* non bloquant */ }
  }

  async function loadPreview(token: string) {
    if (!selectedEventId) { setError('Sélectionnez d’abord l’événement à contrôler.'); return; }
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ event_id: selectedEventId });
      const res = await fetch(`/api/admin/evenementiel/scan/${encodeURIComponent(token)}?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Erreur lors de la lecture du billet.'); return; }
      const next = data as PreviewData;
      setPreview(next);
      if (scanMode === 'quick' && next.redeemable) {
        const available = next.items.filter((item) => item.quantity_totale - item.quantity_redenta_netta > 0);
        setDeltas(available.length === 1 ? { [available[0]!.reservation_item_id]: 1 } : {});
      } else {
        setDeltas({});
      }
      setStep('preview');
    } catch { setError('Erreur réseau — réessayez.'); }
    finally { setLoading(false); }
  }

  function handleEventChange(eventId: string) {
    setSelectedEventId(eventId); setStep('scan'); setQrToken(''); setPreview(null); setDeltas({}); setResult(null); setError(null);
  }
  function handleScanSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!qrToken.trim() || !selectedEventId) return;
    const token = extractQrToken(qrToken); setQrToken(token); void loadPreview(token);
  }
  function residual(item: ScanPreviewItem): number { return item.quantity_totale - item.quantity_redenta_netta; }
  function setDelta(itemId: string, next: number, max: number) {
    setDeltas(prev => ({ ...prev, [itemId]: Math.max(0, Math.min(max, next)) }));
  }

  async function handleConfirm() {
    if (!preview || !selectedEventId || !preview.redeemable) return;
    const items = Object.entries(deltas).filter(([, qty]) => qty > 0).map(([reservation_item_id, quantity]) => ({ reservation_item_id, quantity }));
    if (items.length === 0) { setError('Sélectionnez au moins un droit à valider.'); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/admin/evenementiel/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ qr_token: qrToken, event_id: selectedEventId, items }) });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && data.reservationItemId) { await loadPreview(qrToken); setError('Ce billet a été mis à jour sur un autre appareil — données actualisées.'); return; }
        setError(data.error ?? 'Erreur lors de la validation.'); return;
      }
      setResult({ remaining: data.remaining, customerName: data.customerName, eventTitle: data.eventTitle });
      setStep('success'); void refreshMetricsNow();
    } catch { setError('Erreur réseau — réessayez.'); }
    finally { setLoading(false); }
  }

  async function handleVoidConfirm() {
    if (!voidTarget || !selectedEventId) return;
    if (voidTarget.requiresReason && !voidReason.trim()) { setError('Un motif est requis pour cette annulation.'); return; }
    setVoidLoading(true); setError(null);
    try {
      const res = await fetch('/api/admin/evenementiel/scan/undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redemption_id: voidTarget.redemptionId, event_id: selectedEventId, reason: voidReason.trim() || undefined }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Erreur lors de l'annulation."); return; }
      setVoidTarget(null); setVoidReason(''); await loadPreview(qrToken); void refreshMetricsNow();
    } catch { setError('Erreur réseau — réessayez.'); }
    finally { setVoidLoading(false); }
  }

  async function saveCheckinWindow() {
    if (!selectedEventId) return;
    const opens = toIso(windowOpen); const closes = toIso(windowClose);
    if (windowOpen && !opens) { setSettingsFeedback('Date d’ouverture invalide.'); return; }
    if (windowClose && !closes) { setSettingsFeedback('Date de fermeture invalide.'); return; }
    if (opens && closes && new Date(closes).getTime() < new Date(opens).getTime()) { setSettingsFeedback('La fermeture doit être postérieure à l’ouverture.'); return; }
    setSettingsSaving(true); setSettingsFeedback(null);
    try {
      const res = await fetch(`/api/admin/evenementiel/events/${selectedEventId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checkin_opens_at: opens, checkin_closes_at: closes }) });
      const data = await res.json();
      setSettingsFeedback(res.ok ? 'Fenêtre de contrôle enregistrée.' : (data.error ?? 'Impossible d’enregistrer la fenêtre.'));
    } catch { setSettingsFeedback('Erreur réseau lors de l’enregistrement.'); }
    finally { setSettingsSaving(false); }
  }

  function reset() { setStep('scan'); setQrToken(''); setPreview(null); setDeltas({}); setResult(null); setError(null); }

  if (!eventsEnabled) return <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2"><IconAlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" /><p className="text-sm text-amber-800">Le module événementiel n&apos;est pas activé pour cette boutique.</p></div>;
  if (events.length === 0) return <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 flex items-start gap-2"><IconCalendarEvent size={18} className="text-amber-600 shrink-0 mt-0.5" /><p className="text-sm text-amber-800">Aucun événement publié ou clôturé n’est disponible pour le contrôle des billets.</p></div>;

  const statusLabel = preview ? (!preview.redeemable ? preview.blocking_reason ?? 'Billet non utilisable' : preview.quantity_remaining < preview.quantity_total ? `Billet partiellement utilisé — ${preview.quantity_remaining}/${preview.quantity_total} restants` : 'Billet valide') : null;
  const selectedQuantity = Object.values(deltas).reduce((sum, qty) => sum + Math.max(0, qty), 0);

  return (
    <div className="flex flex-col gap-4">
      <section className="bg-white rounded-2xl border border-gray-200 p-4">
        <label htmlFor="scan-event" className="text-xs font-semibold uppercase tracking-wide text-gray-500">Événement contrôlé</label>
        <select id="scan-event" value={selectedEventId} onChange={(e) => handleEventChange(e.target.value)} disabled={loading || voidLoading} className="mt-2 w-full rounded-xl border-2 border-gray-200 bg-white px-3.5 py-3 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]">
          <option value="">Sélectionner un événement</option>{events.map((event) => <option key={event.id} value={event.id}>{formatEventLabel(event)}</option>)}
        </select>
        {selectedEvent && <p className="mt-2 text-xs text-gray-500">Les billets d’un autre événement sont refusés avant validation.</p>}
      </section>

      {selectedEventId && metrics && <section className="grid grid-cols-3 gap-2"><div className="rounded-xl border border-gray-200 bg-white p-3 text-center"><p className="text-xl font-bold text-gray-900">{metrics.rights_redeemed}</p><p className="text-[11px] text-gray-500">validés</p></div><div className="rounded-xl border border-gray-200 bg-white p-3 text-center"><p className="text-xl font-bold text-gray-900">{metrics.rights_remaining}</p><p className="text-[11px] text-gray-500">restants</p></div><div className="rounded-xl border border-gray-200 bg-white p-3 text-center"><p className="text-xl font-bold text-gray-900">{metrics.reservations_started}</p><p className="text-[11px] text-gray-500">billets utilisés</p></div></section>}

      {selectedEventId && <section className="bg-white rounded-2xl border border-gray-200 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Mode de contrôle</p><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => setScanMode('full')} className={`min-h-11 rounded-xl border text-sm font-semibold ${scanMode === 'full' ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]' : 'border-gray-200 text-gray-600'}`}><IconScan size={15} className="inline mr-1" />Complet</button><button type="button" onClick={() => setScanMode('quick')} className={`min-h-11 rounded-xl border text-sm font-semibold ${scanMode === 'quick' ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]' : 'border-gray-200 text-gray-600'}`}><IconBolt size={15} className="inline mr-1" />Entrée rapide</button></div><p className="mt-2 text-xs text-gray-500">Entrée rapide présélectionne 1 droit seulement quand le billet est non ambigu. La confirmation reste obligatoire.</p></section>}

      {selectedEventId && canConfigureCheckin && <details className="bg-white rounded-2xl border border-gray-200"><summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2 text-sm font-semibold text-gray-700"><IconSettings size={16} />Fenêtre de contrôle</summary><div className="border-t border-gray-100 p-4 space-y-3"><p className="text-xs text-gray-500">Laisser vide conserve le comportement historique sans restriction horaire.</p><label className="block text-xs font-semibold text-gray-600">Ouverture<input type="datetime-local" value={windowOpen} onChange={(e) => setWindowOpen(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3 text-sm" /></label><label className="block text-xs font-semibold text-gray-600">Fermeture<input type="datetime-local" value={windowClose} onChange={(e) => setWindowClose(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3 text-sm" /></label>{settingsFeedback && <p className="text-xs text-gray-600">{settingsFeedback}</p>}<button type="button" onClick={saveCheckinWindow} disabled={settingsSaving} className="min-h-11 w-full rounded-xl border border-gray-200 text-sm font-semibold disabled:opacity-50">{settingsSaving ? 'Enregistrement…' : 'Enregistrer la fenêtre'}</button></div></details>}

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 flex items-start gap-2"><IconAlertCircle size={16} className="text-red-600 shrink-0 mt-0.5" /><p className="text-sm text-red-700">{error}</p></div>}

      {step === 'scan' && <section className="bg-white rounded-2xl border border-gray-200 p-5 flex flex-col gap-4"><div className="flex items-center gap-2 text-gray-500"><IconScan size={20} /><span className="text-sm font-medium">Scannez le QR code d&apos;entrée</span></div><form onSubmit={handleScanSubmit} className="flex flex-col gap-3"><input ref={inputRef} type="text" autoComplete="off" value={qrToken} onChange={(e) => setQrToken(e.target.value)} placeholder={selectedEventId ? 'Code QR' : 'Sélectionnez d’abord un événement'} disabled={loading || !selectedEventId} className="w-full text-sm tracking-wide text-center px-4 py-4 rounded-xl border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:bg-gray-50" /><button type="submit" disabled={!selectedEventId || !qrToken.trim() || loading} className="w-full py-3.5 rounded-xl text-white font-bold disabled:opacity-50" style={{ backgroundColor: 'var(--color-primary)' }}>{loading ? 'Chargement…' : 'Continuer'}</button></form>{selectedEventId && <CameraScanButton onDecoded={(text) => { const token = extractQrToken(text); setQrToken(token); void loadPreview(token); }} />}</section>}

      {step === 'preview' && preview && <section className="bg-white rounded-2xl border border-gray-200 p-5 flex flex-col gap-4"><div className="flex items-center gap-3 pb-4 border-b border-gray-100"><div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 12%, white)' }}><IconTicket size={22} color="var(--color-primary)" /></div><div className="min-w-0"><div className="font-bold text-gray-900 truncate">{preview.customer_name}</div>{preview.event_title && <div className="text-xs text-gray-500 truncate">{preview.event_title}</div>}</div></div><div className={`rounded-xl border px-3.5 py-3 text-sm font-semibold ${preview.redeemable ? preview.quantity_remaining < preview.quantity_total ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{statusLabel}</div><div className="flex flex-col gap-3">{preview.items.map((item) => { const rem = residual(item); const done = rem === 0; const delta = deltas[item.reservation_item_id] ?? 0; return <div key={item.reservation_item_id} className={`rounded-xl border p-3.5 ${done || !preview.redeemable ? 'bg-gray-50 border-gray-200' : 'border-gray-200'}`}><div className="flex items-center justify-between gap-3"><div className="min-w-0"><div className={`font-semibold text-sm ${done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{item.ticket_type_name}</div><div className="text-xs text-gray-500 mt-0.5">{done && item.ultima_redemption ? `Retiré à ${formatTime(item.ultima_redemption.redeemed_at)}` : `${item.quantity_totale} au total`}{!done && item.quantity_redenta_netta > 0 && item.ultima_redemption && <> — {item.quantity_redenta_netta} déjà retirés</>}</div></div>{!done && preview.redeemable && <div className="flex items-center gap-2 shrink-0"><button type="button" onClick={() => setDelta(item.reservation_item_id, delta - 1, rem)} disabled={loading || delta <= 0} aria-label="Diminuer" className="w-11 h-11 rounded-full border border-gray-200 flex items-center justify-center disabled:opacity-40"><IconMinus size={16} /></button><span className="w-6 text-center font-bold">{delta}</span><button type="button" onClick={() => setDelta(item.reservation_item_id, delta + 1, rem)} disabled={loading || delta >= rem} aria-label="Augmenter" className="w-11 h-11 rounded-full border border-gray-200 flex items-center justify-center disabled:opacity-40"><IconPlus size={16} /></button></div>}</div>{item.ultima_redemption?.can_undo && <button type="button" onClick={() => { setVoidTarget({ redemptionId: item.ultima_redemption!.id, ticketTypeName: item.ticket_type_name, requiresReason: item.ultima_redemption!.undo_requires_reason }); setVoidReason(''); }} className="mt-2 text-xs font-medium text-gray-500 flex items-center gap-1 min-h-[44px]"><IconArrowBackUp size={14} />Annuler le dernier retrait</button>}</div>; })}</div>{preview.redeemable && <button type="button" onClick={handleConfirm} disabled={loading || selectedQuantity <= 0} className="w-full py-3.5 rounded-xl text-white font-bold disabled:opacity-50" style={{ backgroundColor: 'var(--color-primary)' }}>{loading ? 'Validation…' : scanMode === 'quick' && selectedQuantity === 1 ? 'Valider 1 entrée' : `Confirmer${selectedQuantity > 0 ? ` (${selectedQuantity})` : ''}`}</button>}<button type="button" onClick={reset} disabled={loading} className="w-full py-2.5 rounded-xl text-sm font-semibold text-gray-500 border border-gray-200">Nouveau billet</button></section>}

      {step === 'success' && result && <section className="bg-white rounded-2xl border border-gray-200 p-6 flex flex-col items-center gap-4 text-center"><div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 14%, white)' }}><IconCheck size={32} color="var(--color-primary)" /></div><div><div className="font-bold text-gray-900">{result.customerName || 'Réservation'}</div><div className="text-sm text-gray-500 mt-1">Validation enregistrée</div></div>{result.remaining !== null && <div className="w-full rounded-xl bg-gray-50 py-3"><div className="text-xs text-gray-500">Droits restants sur ce billet</div><div className="text-xl font-extrabold text-gray-900">{result.remaining}</div></div>}<button type="button" onClick={reset} className="w-full py-3.5 rounded-xl text-white font-bold flex items-center justify-center gap-2" style={{ backgroundColor: 'var(--color-primary)' }}><IconRotate size={18} />Nouveau scan</button></section>}

      {voidTarget && <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true"><div className="bg-white rounded-2xl shadow-xl max-w-sm w-full"><div className="flex items-center justify-between px-5 py-4 border-b border-gray-100"><h2 className="text-sm font-semibold">Annuler le retrait</h2><button onClick={() => setVoidTarget(null)} disabled={voidLoading} aria-label="Fermer" className="w-11 h-11 flex items-center justify-center"><IconX size={16} /></button></div><div className="px-5 py-4 space-y-3"><p className="text-sm text-gray-600">Annuler le dernier retrait pour <strong>{voidTarget.ticketTypeName}</strong> ?</p><label className="block text-xs font-medium text-gray-600">Motif {voidTarget.requiresReason ? '(requis)' : '(optionnel)'}<input type="text" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} className="mt-1 w-full text-sm px-3.5 py-3 rounded-xl border-2 border-gray-200" /></label></div><div className="px-5 pb-5 flex gap-2"><button type="button" onClick={() => setVoidTarget(null)} className="flex-1 py-3 rounded-xl text-sm font-semibold border border-gray-200">Retour</button><button type="button" onClick={handleVoidConfirm} disabled={voidLoading || (voidTarget.requiresReason && !voidReason.trim())} className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--color-primary)' }}>{voidLoading ? 'Annulation…' : 'Confirmer'}</button></div></div></div>}
    </div>
  );
}
