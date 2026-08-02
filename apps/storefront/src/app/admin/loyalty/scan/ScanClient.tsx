'use client';

import { useEffect, useRef, useState } from 'react';
import { IconScan, IconUserCircle, IconCheck, IconAlertCircle, IconRotate } from '@tabler/icons-react';
import { CameraScanButton } from './CameraScanButton';

interface CustomerLookup {
  id: string;
  fullName: string | null;
  email: string;
  confirmedBalance: number;
}

interface ConfirmResult {
  customerName: string | null;
  pointsAwarded: number;
  newBalance: number;
}

type Step = 'scan' | 'confirm' | 'success';

export function ScanClient({ tenantId: _tenantId, loyaltyEnabled }: { tenantId: string; loyaltyEnabled: boolean }) {
  const [step, setStep] = useState<Step>('scan');
  const [cardNumber, setCardNumber] = useState('');
  const [customer, setCustomer] = useState<CustomerLookup | null>(null);
  const [amount, setAmount] = useState('');
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // Focus automatique — un lecteur code-barres USB/Bluetooth émule un
  // clavier : il suffit que ce champ ait le focus pour capter le scan sans
  // aucun code dédié (le lecteur tape les chiffres puis Entrée).
  useEffect(() => {
    if (step === 'scan') inputRef.current?.focus();
  }, [step]);

  async function lookupCard(rawCode: string) {
    const code = rawCode.trim().replace(/[^0-9]/g, '');
    if (code.length < 8) {
      setError('Numéro de carte invalide.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/loyalty/scan/lookup?cardNumber=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Client introuvable.');
        return;
      }
      setCustomer(data.customer);
      setStep('confirm');
    } catch {
      setError('Erreur réseau — réessayez.');
    } finally {
      setLoading(false);
    }
  }

  async function handleScanSubmit(e: React.FormEvent) {
    e.preventDefault();
    await lookupCard(cardNumber);
  }

  async function handleConfirmPurchase() {
    if (!customer) return;
    const parsedAmount = Number(amount.replace(',', '.'));
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Montant invalide.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/loyalty/scan/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: customer.id, amount: parsedAmount }),
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
    setCardNumber('');
    setCustomer(null);
    setAmount('');
    setResult(null);
    setError(null);
  }

  if (!loyaltyEnabled) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2">
        <IconAlertCircle size={18} stroke={1.8} className="text-amber-600 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800">
          Le programme de fidélité n&apos;est pas activé pour cette boutique — activez-le dans
          « Fidélité &amp; parrainage » avant d&apos;utiliser le scan en caisse.
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
            <span className="text-sm font-medium">Scannez ou saisissez le numéro de carte</span>
          </div>

          <form onSubmit={handleScanSubmit} className="flex flex-col gap-3">
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              placeholder="Numéro de carte fidélité"
              disabled={loading}
              className="w-full text-lg tracking-wider text-center px-4 py-4 rounded-xl border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
            />
            <button
              type="submit"
              disabled={loading || cardNumber.trim().length === 0}
              className="w-full py-3.5 rounded-xl text-white font-bold disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              {loading ? 'Recherche…' : 'Rechercher'}
            </button>
          </form>

          <CameraScanButton onDecoded={(text) => { setCardNumber(text); void lookupCard(text); }} />
        </div>
      )}

      {step === 'confirm' && customer && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 flex flex-col gap-4">
          <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 12%, white)' }}
            >
              <IconUserCircle size={26} stroke={1.6} color="var(--color-primary)" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-gray-900 truncate">{customer.fullName || customer.email}</div>
              <div className="text-xs text-gray-500 truncate">{customer.email}</div>
            </div>
          </div>

          <div className="rounded-xl px-3.5 py-3 text-center" style={{ backgroundColor: 'var(--color-primary-light)' }}>
            <span className="text-xs text-gray-600">Solde actuel</span>
            <div className="text-2xl font-extrabold" style={{ color: 'var(--color-primary)' }}>
              {customer.confirmedBalance} pts
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600" htmlFor="amount">
              Montant dépensé (€)
            </label>
            <input
              id="amount"
              type="text"
              inputMode="decimal"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              disabled={loading}
              className="w-full text-lg text-center px-4 py-4 rounded-xl border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
            />
          </div>

          <button
            type="button"
            onClick={handleConfirmPurchase}
            disabled={loading || amount.trim().length === 0}
            className="w-full py-3.5 rounded-xl text-white font-bold disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {loading ? 'Validation…' : 'Confirmer l\'achat'}
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
            <div className="font-bold text-gray-900">{result.customerName || 'Client'}</div>
            <div className="text-sm text-gray-500 mt-1">Achat enregistré avec succès</div>
          </div>

          <div className="w-full flex gap-3">
            <div className="flex-1 rounded-xl bg-gray-50 py-3">
              <div className="text-xs text-gray-500">Points attribués</div>
              <div className="text-xl font-extrabold text-gray-900">+{result.pointsAwarded}</div>
            </div>
            <div className="flex-1 rounded-xl py-3" style={{ backgroundColor: 'var(--color-primary-light)' }}>
              <div className="text-xs text-gray-600">Nouveau solde</div>
              <div className="text-xl font-extrabold" style={{ color: 'var(--color-primary)' }}>
                {result.newBalance}
              </div>
            </div>
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
