'use client';

import { useEffect, useRef, useState } from 'react';
import {
  IconScan, IconCheck, IconAlertCircle, IconRotate, IconTicket,
  IconMinus, IconPlus, IconArrowBackUp, IconX,
} from '@tabler/icons-react';
import { CameraScanButton } from '../../loyalty/scan/CameraScanButton';
import { extractQrToken } from '@/lib/events/ticketUrl';

type Step = 'scan' | 'preview' | 'success';

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
  } | null;
}

interface PreviewData {
  reservation_id: string;
  customer_name: string;
  event_title: string | null;
  quantity_total: number;
  quantity_remaining: number;
  items: ScanPreviewItem[];
}

interface ScanResult {
  remaining: number | null;
  customerName: string | null;
  eventTitle: string | null;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function ScanClient({ eventsEnabled }: { eventsEnabled: boolean }) {
  const [step, setStep] = useState<Step>('scan');
  const [qrToken, setQrToken] = useState('');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [deltas, setDeltas] = useState<Record<string, number>>({});
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [voidTarget, setVoidTarget] = useState<{ redemptionId: string; ticketTypeName: string } | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidLoading, setVoidLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 'scan') inputRef.current?.focus();
  }, [step]);

  async function loadPreview(token: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/evenementiel/scan/${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Erreur lors de la lecture du billet.');
        return;
      }
      setPreview(data);
      setDeltas({});
      setStep('preview');
    } catch {
      setError('Erreur réseau — réessayez.');
    } finally {
      setLoading(false);
    }
  }

  function handleScanSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!qrToken.trim()) return;
    // Le QR encode désormais l'URL du billet — on extrait le token (les
    // anciens QR au token nu restent acceptés, cf. extractQrToken).
    const token = extractQrToken(qrToken);
    setQrToken(token);
    void loadPreview(token);
  }

  function residual(item: ScanPreviewItem): number {
    return item.quantity_totale - item.quantity_redenta_netta;
  }

  function setDelta(itemId: string, next: number, max: number) {
    const clamped = Math.max(0, Math.min(max, next));
    setDeltas(prev => ({ ...prev, [itemId]: clamped }));
  }

  async function handleConfirm() {
    if (!preview) return;

    const items = Object.entries(deltas)
      .filter(([, qty]) => qty > 0)
      .map(([reservation_item_id, quantity]) => ({ reservation_item_id, quantity }));

    if (items.length === 0) {
      setError('Sélectionnez au moins une formule à valider.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/evenementiel/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qr_token: qrToken, items }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Erreur lors de la validation.');
        return;
      }
      setResult({ remaining: data.remaining, customerName: data.customerName, eventTitle: data.eventTitle });
      setStep('success');
    } catch {
      setError('Erreur réseau — réessayez.');
    } finally {
      setLoading(false);
    }
  }

  async function handleVoidConfirm() {
    if (!voidTarget) return;
    setVoidLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/evenementiel/scan/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redemption_id: voidTarget.redemptionId, reason: voidReason.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Erreur lors de l'annulation.");
        return;
      }
      setVoidTarget(null);
      setVoidReason('');
      await loadPreview(qrToken);
    } catch {
      setError('Erreur réseau — réessayez.');
    } finally {
      setVoidLoading(false);
    }
  }

  function reset() {
    setStep('scan');
    setQrToken('');
    setPreview(null);
    setDeltas({});
    setResult(null);
    setError(null);
  }

  if (!eventsEnabled) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2">
        <IconAlertCircle size={18} stroke={1.8} className="text-amber-600 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800">
          Le module événementiel n&apos;est pas activé pour cette boutique.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 flex items-start gap-2">
          <IconAlertCircle size={16} stroke={1.8} className="text-red-600 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {step === 'scan' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2 text-gray-500">
            <IconScan size={20} stroke={1.6} />
            <span className="text-sm font-medium">Scannez le QR code d&apos;entrée</span>
          </div>

          <form onSubmit={handleScanSubmit} className="flex flex-col gap-3">
            <input
              ref={inputRef}
              type="text"
              autoComplete="off"
              value={qrToken}
              onChange={(e) => setQrToken(e.target.value)}
              placeholder="Code QR"
              disabled={loading}
              className="w-full text-sm tracking-wide text-center px-4 py-4 rounded-xl border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
            />
            <button
              type="submit"
              disabled={qrToken.trim().length === 0 || loading}
              className="w-full py-3.5 rounded-xl text-white font-bold disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              {loading ? 'Chargement…' : 'Continuer'}
            </button>
          </form>

          <CameraScanButton onDecoded={(text) => {
            const token = extractQrToken(text);
            setQrToken(token);
            void loadPreview(token);
          }} />
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 flex flex-col gap-4">
          <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 12%, white)' }}
            >
              <IconTicket size={22} stroke={1.6} color="var(--color-primary)" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-gray-900 truncate">{preview.customer_name}</div>
              {preview.event_title && (
                <div className="text-xs text-gray-500 truncate">{preview.event_title}</div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {preview.items.map(item => {
              const rem = residual(item);
              const done = rem === 0;
              const delta = deltas[item.reservation_item_id] ?? 0;

              return (
                <div
                  key={item.reservation_item_id}
                  className={`rounded-xl border p-3.5 ${done ? 'bg-gray-50 border-gray-200' : 'border-gray-200'}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className={`font-semibold text-sm ${done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                        {item.ticket_type_name}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {done && item.ultima_redemption
                          ? `Ritirato alle ${formatTime(item.ultima_redemption.redeemed_at)}`
                          : `${item.quantity_totale} au total`}
                        {!done && item.quantity_redenta_netta > 0 && item.ultima_redemption && (
                          <> — {item.quantity_redenta_netta} déjà retirés à {formatTime(item.ultima_redemption.redeemed_at)}</>
                        )}
                      </div>
                    </div>

                    {!done && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setDelta(item.reservation_item_id, delta - 1, rem)}
                          disabled={loading || delta <= 0}
                          aria-label="Diminuer"
                          className="w-11 h-11 rounded-full border border-gray-200 flex items-center justify-center disabled:opacity-40"
                        >
                          <IconMinus size={16} stroke={2} />
                        </button>
                        <span className="w-6 text-center font-bold text-gray-900">{delta}</span>
                        <button
                          type="button"
                          onClick={() => setDelta(item.reservation_item_id, delta + 1, rem)}
                          disabled={loading || delta >= rem}
                          aria-label="Augmenter"
                          className="w-11 h-11 rounded-full border border-gray-200 flex items-center justify-center disabled:opacity-40"
                          style={delta < rem ? { borderColor: 'var(--color-primary)', color: 'var(--color-primary)' } : undefined}
                        >
                          <IconPlus size={16} stroke={2} />
                        </button>
                      </div>
                    )}
                  </div>

                  {item.quantity_redenta_netta > 0 && item.ultima_redemption && (
                    <button
                      type="button"
                      onClick={() => { setVoidTarget({ redemptionId: item.ultima_redemption!.id, ticketTypeName: item.ticket_type_name }); setVoidReason(''); }}
                      disabled={loading}
                      className="mt-2 text-xs font-medium text-gray-500 flex items-center gap-1 min-h-[44px]"
                    >
                      <IconArrowBackUp size={14} stroke={1.8} />
                      Annuler le dernier retrait
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading || Object.values(deltas).every(v => v <= 0)}
            className="w-full py-3.5 rounded-xl text-white font-bold disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {loading ? 'Validation…' : 'Confirmer'}
          </button>

          <button
            type="button"
            onClick={reset}
            disabled={loading}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-gray-500 border border-gray-200"
          >
            Annuler
          </button>
        </div>
      )}

      {step === 'success' && result && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 flex flex-col items-center gap-4 text-center">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 14%, white)' }}
          >
            <IconCheck size={32} stroke={2} color="var(--color-primary)" />
          </div>
          <div>
            <div className="font-bold text-gray-900">{result.customerName || 'Réservation'}</div>
            <div className="text-sm text-gray-500 mt-1">Entrée validée avec succès</div>
          </div>

          {result.remaining !== null && (
            <div className="w-full rounded-xl bg-gray-50 py-3">
              <div className="text-xs text-gray-500">Places restantes sur ce billet</div>
              <div className="text-xl font-extrabold text-gray-900">{result.remaining}</div>
            </div>
          )}

          <button
            type="button"
            onClick={reset}
            className="w-full py-3.5 rounded-xl text-white font-bold flex items-center justify-center gap-2"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            <IconRotate size={18} stroke={1.8} />
            Nouveau scan
          </button>
        </div>
      )}

      {voidTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="void-redemption-title"
          onKeyDown={e => { if (e.key === 'Escape' && !voidLoading) setVoidTarget(null); }}
        >
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 id="void-redemption-title" className="text-sm font-semibold text-gray-900">
                Annuler le retrait
              </h2>
              <button
                onClick={() => setVoidTarget(null)}
                disabled={voidLoading}
                aria-label="Fermer"
                className="w-11 h-11 -mr-2 flex items-center justify-center rounded hover:bg-gray-100"
              >
                <IconX size={16} />
              </button>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3">
              <p className="text-sm text-gray-600">
                Annuler le dernier retrait pour <strong>{voidTarget.ticketTypeName}</strong> ?
              </p>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-gray-600" htmlFor="void-reason">
                  Motif (optionnel)
                </label>
                <input
                  id="void-reason"
                  type="text"
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  disabled={voidLoading}
                  className="w-full text-sm px-3.5 py-3 rounded-xl border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
                />
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button
                type="button"
                onClick={() => setVoidTarget(null)}
                disabled={voidLoading}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-gray-500 border border-gray-200"
              >
                Retour
              </button>
              <button
                type="button"
                onClick={handleVoidConfirm}
                disabled={voidLoading}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                {voidLoading ? 'Annulation…' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
