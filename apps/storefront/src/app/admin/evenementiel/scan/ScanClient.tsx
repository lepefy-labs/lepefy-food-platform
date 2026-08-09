'use client';

import { useEffect, useRef, useState } from 'react';
import { IconScan, IconCheck, IconAlertCircle, IconRotate, IconTicket } from '@tabler/icons-react';
import { CameraScanButton } from '../../loyalty/scan/CameraScanButton';
import { extractQrToken } from '@/lib/events/ticketUrl';

type Step = 'scan' | 'confirm' | 'success';

interface ScanResult {
  remaining: number;
  customerName: string | null;
  eventTitle: string | null;
}

export function ScanClient({ eventsEnabled }: { eventsEnabled: boolean }) {
  const [step, setStep] = useState<Step>('scan');
  const [qrToken, setQrToken] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 'scan') inputRef.current?.focus();
  }, [step]);

  function handleScanSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!qrToken.trim()) return;
    // Le QR encode désormais l'URL du billet — on extrait le token (les
    // anciens QR au token nu restent acceptés, cf. extractQrToken).
    setQrToken(extractQrToken(qrToken));
    setError(null);
    setStep('confirm');
  }

  async function handleConfirm() {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      setError('Quantité invalide.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/evenementiel/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qr_token: qrToken.trim(), quantity: qty }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Erreur lors de la validation.');
        return;
      }
      setResult(data);
      setStep('success');
    } catch {
      setError('Erreur réseau — réessayez.');
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setStep('scan');
    setQrToken('');
    setQuantity('1');
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
              className="w-full text-sm tracking-wide text-center px-4 py-4 rounded-xl border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
            />
            <button
              type="submit"
              disabled={qrToken.trim().length === 0}
              className="w-full py-3.5 rounded-xl text-white font-bold disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              Continuer
            </button>
          </form>

          <CameraScanButton onDecoded={(text) => { setQrToken(extractQrToken(text)); setStep('confirm'); }} />
        </div>
      )}

      {step === 'confirm' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 flex flex-col gap-4">
          <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 12%, white)' }}
            >
              <IconTicket size={22} stroke={1.6} color="var(--color-primary)" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-gray-900 truncate">Validation d&apos;entrée</div>
              <div className="text-xs text-gray-500 truncate font-mono">{qrToken.slice(0, 24)}…</div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600" htmlFor="quantity">
              Nombre de personnes entrant
            </label>
            <input
              id="quantity"
              type="text"
              inputMode="numeric"
              autoFocus
              value={quantity}
              onChange={(e) => setQuantity(e.target.value.replace(/[^0-9]/g, ''))}
              disabled={loading}
              className="w-full text-lg text-center px-4 py-4 rounded-xl border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
            />
          </div>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading || quantity.trim().length === 0}
            className="w-full py-3.5 rounded-xl text-white font-bold disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {loading ? 'Validation…' : 'Valider l\'entrée'}
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

          <div className="w-full rounded-xl bg-gray-50 py-3">
            <div className="text-xs text-gray-500">Places restantes sur ce billet</div>
            <div className="text-xl font-extrabold text-gray-900">{result.remaining}</div>
          </div>

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
    </div>
  );
}
