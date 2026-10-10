'use client';

import { useEffect, useRef, useState } from 'react';
import {
  IconScan,
  IconUserCircle,
  IconCheck,
  IconAlertCircle,
  IconAlertTriangle,
  IconRotate,
  IconSearch,
  IconHistory,
} from '@tabler/icons-react';
import { CameraScanButton } from './CameraScanButton';
import {
  SCAN_SEARCH_MIN_LENGTH,
  formatSecondsAgo,
  isUnusualAmount,
  parseScanAmount,
  previewPurchasePoints,
} from '@/lib/loyalty/loyaltyScan';

interface CustomerLookup {
  id: string;
  fullName: string | null;
  email: string | null;
  cardLast4: string | null;
  confirmedBalance: number;
}

interface SearchResult {
  id: string;
  fullName: string | null;
  maskedEmail: string | null;
  cardLast4: string | null;
}

interface ConfirmResult {
  customerName: string | null;
  pointsAwarded: number;
  newBalance: number;
}

interface DuplicateWarning {
  secondsAgo: number;
  pointsAwarded: number | null;
}

interface SessionCredit {
  at: Date;
  name: string;
  amount: number;
  points: number;
}

type Step = 'scan' | 'confirm' | 'success';

const SESSION_HISTORY_MAX = 10;

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function ScanClient({ loyaltyEnabled, purchasePointsRate }: { loyaltyEnabled: boolean; purchasePointsRate: number }) {
  const [step, setStep] = useState<Step>('scan');
  const [cardNumber, setCardNumber] = useState('');
  const [customer, setCustomer] = useState<CustomerLookup | null>(null);
  const [amount, setAmount] = useState('');
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [unusualPending, setUnusualPending] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicateWarning | null>(null);
  const [history, setHistory] = useState<SessionCredit[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const nextScanRef = useRef<HTMLButtonElement>(null);
  // One credit request at a time, whatever the render state (double tap).
  const submittingRef = useRef(false);

  // Focus automatique — un lecteur code-barres USB/Bluetooth émule un
  // clavier : il suffit que ce champ ait le focus pour capter le scan sans
  // aucun code dédié (le lecteur tape les chiffres puis Entrée).
  useEffect(() => {
    if (step === 'scan' && !searchOpen) inputRef.current?.focus();
    if (step === 'success') nextScanRef.current?.focus();
  }, [step, searchOpen]);

  // Forgotten card: debounced name/phone search (scan-scoped, masked results).
  useEffect(() => {
    if (!searchOpen) return;
    const q = searchQuery.trim();
    if (q.length < SCAN_SEARCH_MIN_LENGTH) {
      setSearchResults(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/admin/loyalty/scan/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? 'Recherche indisponible.');
          return;
        }
        setSearchResults(data.customers ?? []);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setError('Erreur réseau — réessayez.');
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [searchOpen, searchQuery]);

  const parsedAmount = parseScanAmount(amount);
  const previewPoints = parsedAmount ? previewPurchasePoints(parsedAmount, purchasePointsRate) : 0;

  async function loadCustomer(query: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/loyalty/scan/lookup?${query}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Client introuvable.');
        return;
      }
      setCustomer(data.customer);
      setSearchOpen(false);
      setStep('confirm');
    } catch {
      setError('Erreur réseau — réessayez.');
    } finally {
      setLoading(false);
    }
  }

  async function lookupCard(rawCode: string) {
    const code = rawCode.trim().replace(/[^0-9]/g, '');
    if (code.length < 8) {
      setError('Numéro de carte invalide.');
      return;
    }
    await loadCustomer(`cardNumber=${encodeURIComponent(code)}`);
  }

  async function handleScanSubmit(e: React.FormEvent) {
    e.preventDefault();
    await lookupCard(cardNumber);
  }

  async function submitCredit(confirmDuplicate: boolean) {
    if (!customer || parsedAmount === null || submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/loyalty/scan/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: customer.id, amount: parsedAmount, confirmDuplicate }),
      });
      const data = await res.json();
      if (res.status === 409 && data.code === 'DUPLICATE_RECENT') {
        setDuplicate({ secondsAgo: data.secondsAgo, pointsAwarded: data.pointsAwarded });
        return;
      }
      if (!res.ok) {
        setError(data.error ?? 'Erreur lors de la validation.');
        return;
      }
      setResult(data);
      setDuplicate(null);
      setHistory((previous) => [
        {
          at: new Date(),
          name: data.customerName || customer.fullName || 'Client',
          amount: parsedAmount,
          points: data.pointsAwarded,
        },
        ...previous,
      ].slice(0, SESSION_HISTORY_MAX));
      setStep('success');
    } catch {
      setError('Erreur réseau — réessayez.');
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }

  function handleConfirmPurchase(e?: React.FormEvent) {
    e?.preventDefault();
    if (parsedAmount === null) {
      setError('Montant invalide.');
      return;
    }
    // Typo guard: an unusual amount needs a second, explicit confirmation.
    if (isUnusualAmount(parsedAmount) && !unusualPending) {
      setUnusualPending(true);
      return;
    }
    void submitCredit(false);
  }

  function reset() {
    setStep('scan');
    setCardNumber('');
    setCustomer(null);
    setAmount('');
    setResult(null);
    setError(null);
    setUnusualPending(false);
    setDuplicate(null);
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults(null);
  }

  if (!loyaltyEnabled) {
    return (
      <div className="rounded-2xl border border-tone-warning-border bg-tone-warning-bg px-4 py-3 flex items-start gap-2">
        <IconAlertCircle size={18} stroke={1.8} className="text-tone-warning-fg shrink-0 mt-0.5" />
        <p className="text-sm text-tone-warning-fg">
          Le programme de fidélité n&apos;est pas activé pour cette boutique — activez-le dans
          « Fidélité &amp; parrainage » avant d&apos;utiliser le scan en caisse.
        </p>
      </div>
    );
  }

  const primaryLabel = loading
    ? 'Validation…'
    : unusualPending && parsedAmount !== null
      ? `Oui, créditer ${euro.format(parsedAmount)}`
      : parsedAmount !== null
        ? `Créditer ${previewPoints} pts`
        : 'Créditer les points';

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div role="alert" className="rounded-xl border border-tone-danger-border bg-tone-danger-bg px-3.5 py-2.5 flex items-start gap-2">
          <IconAlertCircle size={16} stroke={1.8} className="text-tone-danger-fg shrink-0 mt-0.5" />
          <p className="text-sm text-tone-danger-fg">{error}</p>
        </div>
      )}

      {step === 'scan' && (
        <div className="bg-a-surface rounded-2xl border border-a-border p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2 text-a-text-3">
            <IconScan size={20} stroke={1.6} />
            <span className="text-sm font-medium">Scannez ou saisissez le numéro de carte</span>
          </div>

          <form onSubmit={handleScanSubmit} className="flex flex-col gap-3">
            <label htmlFor="loyalty-card-number" className="text-xs font-medium text-a-text-2">
              Numéro de carte fidélité
            </label>
            <input
              id="loyalty-card-number"
              ref={inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              placeholder="Scannez la carte"
              disabled={loading}
              className="w-full text-lg tracking-wider text-center px-4 py-4 rounded-xl border-2 border-a-border focus:outline-none focus:ring-2 focus:ring-a-focus focus:border-transparent"
            />
            <button
              type="submit"
              disabled={loading || cardNumber.trim().length === 0}
              className="w-full py-3.5 rounded-xl text-white font-bold disabled:opacity-50"
              style={{ backgroundColor: 'var(--admin-primary)' }}
            >
              {loading ? 'Recherche…' : 'Rechercher'}
            </button>
          </form>

          <CameraScanButton onDecoded={(text) => { setCardNumber(text); void lookupCard(text); }} />

          <div className="border-t border-a-border pt-3">
            {!searchOpen ? (
              <button
                type="button"
                onClick={() => { setSearchOpen(true); setError(null); }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-a-text-2 border border-a-border hover:bg-a-surface-2"
              >
                <IconSearch size={16} stroke={1.8} />
                Carte oubliée ? Rechercher par nom ou téléphone
              </button>
            ) : (
              <div className="flex flex-col gap-2">
                <label htmlFor="loyalty-scan-search" className="text-xs font-medium text-a-text-2">
                  Nom ou téléphone du client
                </label>
                <input
                  id="loyalty-scan-search"
                  type="search"
                  autoFocus
                  autoComplete="off"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`${SCAN_SEARCH_MIN_LENGTH} caractères minimum`}
                  className="w-full px-3.5 py-3 rounded-xl border-2 border-a-border focus:outline-none focus:ring-2 focus:ring-a-focus focus:border-transparent"
                />
                <div aria-live="polite" className="flex flex-col gap-1.5">
                  {searching && <p className="text-xs text-a-text-3">Recherche…</p>}
                  {!searching && searchResults && searchResults.length === 0 && (
                    <p className="text-xs text-a-text-3">Aucun porteur de carte trouvé.</p>
                  )}
                  {searchResults?.map((match) => (
                    <button
                      key={match.id}
                      type="button"
                      disabled={loading}
                      onClick={() => void loadCustomer(`customerId=${encodeURIComponent(match.id)}`)}
                      className="w-full flex items-center justify-between gap-3 rounded-xl border border-a-border px-3.5 py-2.5 text-left hover:bg-a-surface-2 disabled:opacity-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-a-text">{match.fullName || 'Client'}</span>
                        {match.maskedEmail && <span className="block truncate text-xs text-a-text-3">{match.maskedEmail}</span>}
                      </span>
                      {match.cardLast4 && <span className="shrink-0 text-xs font-medium text-a-text-3">Carte …{match.cardLast4}</span>}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => { setSearchOpen(false); setSearchQuery(''); setSearchResults(null); }}
                  className="self-start text-xs font-semibold text-a-text-3 underline"
                >
                  Revenir au scan
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {step === 'confirm' && customer && (
        <form onSubmit={handleConfirmPurchase} className="bg-a-surface rounded-2xl border border-a-border p-5 flex flex-col gap-4">
          <div className="flex items-center gap-3 pb-4 border-b border-a-border">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
              style={{ backgroundColor: 'color-mix(in srgb, var(--admin-primary) 12%, white)' }}
            >
              <IconUserCircle size={26} stroke={1.6} color="var(--admin-primary)" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-a-text truncate">{customer.fullName || customer.email || 'Client'}</div>
              <div className="text-xs text-a-text-3 truncate">
                {[customer.email, customer.cardLast4 ? `Carte …${customer.cardLast4}` : null].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>

          <div className="rounded-xl px-3.5 py-3 text-center" style={{ backgroundColor: 'var(--admin-primary-soft)' }}>
            <span className="text-xs text-a-text-2">Solde actuel</span>
            <div className="text-2xl font-extrabold" style={{ color: 'var(--admin-primary)' }}>
              {customer.confirmedBalance} pts
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-a-text-2" htmlFor="amount">
              Montant dépensé (€)
            </label>
            <input
              id="amount"
              type="text"
              inputMode="decimal"
              autoFocus
              autoComplete="off"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setUnusualPending(false); setDuplicate(null); }}
              placeholder="0,00"
              disabled={loading}
              aria-describedby="amount-preview"
              className="w-full text-lg text-center px-4 py-4 rounded-xl border-2 border-a-border focus:outline-none focus:ring-2 focus:ring-a-focus focus:border-transparent"
            />
            <p id="amount-preview" aria-live="polite" className="text-center text-sm text-a-text-2 min-h-5">
              {parsedAmount !== null && (
                <>≈ <strong className="text-a-text">+{previewPoints} pts</strong> → nouveau solde {customer.confirmedBalance + previewPoints}</>
              )}
              {parsedAmount === null && amount.trim().length > 0 && <span className="text-tone-danger-fg">Montant invalide</span>}
            </p>
          </div>

          {unusualPending && parsedAmount !== null && !duplicate && (
            <div role="alert" className="rounded-xl border border-tone-warning-border bg-tone-warning-bg px-3.5 py-2.5 flex items-start gap-2">
              <IconAlertTriangle size={16} stroke={1.8} className="text-tone-warning-fg shrink-0 mt-0.5" />
              <p className="text-sm text-tone-warning-fg">
                Montant inhabituel : <strong>{euro.format(parsedAmount)}</strong> ? Vérifiez avant de créditer.
              </p>
            </div>
          )}

          {duplicate ? (
            <div role="alert" className="rounded-xl border border-tone-warning-border bg-tone-warning-bg p-3.5 flex flex-col gap-3">
              <div className="flex items-start gap-2">
                <IconAlertTriangle size={16} stroke={1.8} className="text-tone-warning-fg shrink-0 mt-0.5" />
                <p className="text-sm text-tone-warning-fg">
                  Achat identique déjà enregistré {formatSecondsAgo(duplicate.secondsAgo)}
                  {duplicate.pointsAwarded !== null ? ` (+${duplicate.pointsAwarded} pts)` : ''}. Il s&apos;agit
                  probablement d&apos;un double scan.
                </p>
              </div>
              <button
                type="button"
                autoFocus
                onClick={reset}
                className="w-full py-3 rounded-xl text-white font-bold"
                style={{ backgroundColor: 'var(--admin-primary)' }}
              >
                Ne pas recréditer
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => void submitCredit(true)}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-tone-warning-fg border border-tone-warning-border disabled:opacity-50"
              >
                {loading ? 'Validation…' : 'Créditer quand même'}
              </button>
            </div>
          ) : (
            <button
              type="submit"
              disabled={loading || parsedAmount === null}
              className="w-full py-3.5 rounded-xl text-white font-bold disabled:opacity-50"
              style={{ backgroundColor: 'var(--admin-primary)' }}
            >
              {primaryLabel}
            </button>
          )}

          <button
            type="button"
            onClick={reset}
            disabled={loading}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-a-text-3 border border-a-border"
          >
            Annuler
          </button>
        </form>
      )}

      {step === 'success' && result && (
        <div aria-live="polite" className="bg-a-surface rounded-2xl border border-a-border p-6 flex flex-col items-center gap-4 text-center">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'color-mix(in srgb, var(--admin-primary) 14%, white)' }}
          >
            <IconCheck size={32} stroke={2} color="var(--admin-primary)" />
          </div>
          <div>
            <div className="font-bold text-a-text">{result.customerName || 'Client'}</div>
            <div className="text-sm text-a-text-3 mt-1">Achat enregistré avec succès</div>
          </div>

          <div className="w-full flex gap-3">
            <div className="flex-1 rounded-xl bg-a-surface-2 py-3">
              <div className="text-xs text-a-text-3">Points attribués</div>
              <div className="text-xl font-extrabold text-a-text">+{result.pointsAwarded}</div>
            </div>
            <div className="flex-1 rounded-xl py-3" style={{ backgroundColor: 'var(--admin-primary-soft)' }}>
              <div className="text-xs text-a-text-2">Nouveau solde</div>
              <div className="text-xl font-extrabold" style={{ color: 'var(--admin-primary)' }}>
                {result.newBalance}
              </div>
            </div>
          </div>

          <button
            ref={nextScanRef}
            type="button"
            onClick={reset}
            className="w-full py-3.5 rounded-xl text-white font-bold flex items-center justify-center gap-2"
            style={{ backgroundColor: 'var(--admin-primary)' }}
          >
            <IconRotate size={18} stroke={1.8} />
            Nouveau scan (Entrée)
          </button>
        </div>
      )}

      {history.length > 0 && (
        <section aria-label="Accréditations de cette session" className="bg-a-surface rounded-2xl border border-a-border p-4">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-a-text-3">
            <IconHistory size={14} stroke={1.8} />
            Cette session
          </h2>
          <ul className="mt-2 divide-y divide-a-border">
            {history.map((credit) => (
              <li key={credit.at.getTime()} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate text-a-text-2">
                  <span className="text-a-text-3">{time.format(credit.at)}</span> · {credit.name}
                </span>
                <span className="shrink-0 text-a-text-2">
                  {euro.format(credit.amount)} · <strong className="text-a-text">+{credit.points} pts</strong>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-a-text-3">Visible uniquement sur cet écran, effacé à la fermeture.</p>
        </section>
      )}
    </div>
  );
}
