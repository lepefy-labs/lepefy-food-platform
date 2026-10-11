'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useTenant } from '@/providers/TenantProvider';
import { marketingConsentLabel } from '@/lib/legal/consentCopy';
import { FieldMessage, TextField } from '@/components/ui/form';

const RESEND_DELAY_S = 60;

interface OtpLoginFormProps {
  onAuthenticated?: () => void;
}

export function OtpLoginForm({ onAuthenticated }: OtpLoginFormProps) {
  const tenant = useTenant();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState<string[]>(Array(6).fill(''));
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const cellRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function sendCode() {
    if (!email || isSending) return;
    setIsSending(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Erreur lors de l'envoi du code.");
        return;
      }
      setIsNewCustomer(data.isNewCustomer === true);
      setTermsAccepted(false);
      setMarketingOptIn(false);
      setStep('code');
      setCode(Array(6).fill(''));
      setResendIn(RESEND_DELAY_S);
      setTimeout(() => cellRefs.current[0]?.focus(), 50);
    } catch {
      setError("Erreur lors de l'envoi du code.");
    } finally {
      setIsSending(false);
    }
  }

  async function submitCode(fullCode: string) {
    if (isVerifying) return;
    if (isNewCustomer && !termsAccepted) {
      setError("Merci d'accepter les Conditions Générales de Vente pour continuer.");
      return;
    }
    setIsVerifying(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token: fullCode, marketingOptIn }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Code invalide ou expiré.');
        setCode(Array(6).fill(''));
        cellRefs.current[0]?.focus();
        return;
      }
      window.dispatchEvent(new Event('lepefy:customer-authenticated'));
      onAuthenticated?.();
    } catch {
      setError('Erreur lors de la vérification du code.');
    } finally {
      setIsVerifying(false);
    }
  }

  function handleCellChange(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...code];
    next[index] = digit;
    setCode(next);

    if (digit && index < 5) cellRefs.current[index + 1]?.focus();
    if (digit && index === 5) {
      const fullCode = next.join('');
      if (fullCode.length === 6) void submitCode(fullCode);
    }
  }

  function handleCellKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      cellRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    const next = Array(6).fill('');
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setCode(next);
    if (pasted.length === 6) {
      void submitCode(pasted);
    } else {
      cellRefs.current[pasted.length]?.focus();
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4" style={{ boxShadow: 'var(--shadow-card)' }}>
      {step === 'email' ? (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-gray-800">Connectez-vous pour gagner des points</p>
          <TextField
            label="Votre e-mail"
            hint="Nous vous envoyons un code à 6 chiffres."
            error={error}
            type="email"
            inputMode="email"
            autoComplete="email"
            enterKeyHint="send"
            placeholder="Ex. : nom@gmail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              e.stopPropagation();
              void sendCode();
            }}
            required
          />
          <button
            type="button"
            onClick={() => void sendCode()}
            disabled={isSending || !email}
            className="min-h-12 w-full rounded-xl text-base font-bold text-white disabled:opacity-60 transition-opacity"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {isSending ? 'Envoi…' : 'Recevoir mon code'}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-700" id="otp-code-help">
            Code envoyé à <span className="font-semibold text-gray-950">{email}</span>. Écrivez les 6 chiffres.
          </p>
          {isNewCustomer && (
            <div className="space-y-2 border-t border-gray-100 pt-3">
              <label className="flex min-h-11 items-start gap-3 text-sm text-gray-800">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="sf-checkbox mt-0.5"
                />
                <span>
                  J&apos;accepte les{' '}
                  <Link href="/conditions-generales-vente" target="_blank" className="underline">
                    Conditions Générales de Vente
                  </Link>{' '}
                  et la{' '}
                  <Link href="/politique-confidentialite" target="_blank" className="underline">
                    Politique de confidentialité
                  </Link>
                  .
                </span>
              </label>
              <label className="flex min-h-11 items-start gap-3 text-sm text-gray-800">
                <input
                  type="checkbox"
                  checked={marketingOptIn}
                  onChange={(e) => setMarketingOptIn(e.target.checked)}
                  className="sf-checkbox mt-0.5"
                />
                <span>{marketingConsentLabel(tenant.name)}</span>
              </label>
            </div>
          )}

          <div className="grid grid-cols-6 gap-2" onPaste={handlePaste} role="group" aria-labelledby="otp-code-help">
            {code.map((digit, i) => (
              <input
                key={i}
                ref={(el) => { cellRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                autoComplete={i === 0 ? 'one-time-code' : 'off'}
                aria-label={`Chiffre ${i + 1} sur 6`}
                maxLength={1}
                value={digit}
                onChange={(e) => handleCellChange(i, e.target.value)}
                onKeyDown={(e) => handleCellKeyDown(i, e)}
                className="sf-control px-0 text-center text-xl font-semibold"
                disabled={isVerifying || (isNewCustomer && !termsAccepted)}
              />
            ))}
          </div>
          {error && <FieldMessage tone="error">{error}</FieldMessage>}
          <button
            type="button"
            onClick={() => void sendCode()}
            disabled={resendIn > 0 || isSending}
            className="min-h-11 text-sm font-semibold text-gray-700 disabled:opacity-80"
            style={resendIn === 0 ? { color: 'var(--color-primary-dark)' } : undefined}
          >
            {resendIn > 0 ? `Renvoyer le code (${resendIn}s)` : 'Renvoyer le code'}
          </button>
        </div>
      )}
    </div>
  );
}
