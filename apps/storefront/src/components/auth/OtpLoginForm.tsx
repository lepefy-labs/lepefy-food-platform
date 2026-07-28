'use client';

import { useState, useRef, useEffect } from 'react';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent';

const RESEND_DELAY_S = 60;

interface OtpLoginFormProps {
  onAuthenticated?: () => void;
}

export function OtpLoginForm({ onAuthenticated }: OtpLoginFormProps) {
  const [step, setStep]           = useState<'email' | 'code'>('email');
  const [email, setEmail]         = useState('');
  const [code, setCode]           = useState<string[]>(Array(6).fill(''));
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [resendIn, setResendIn]   = useState(0);
  const cellRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (!email || isSending) return;
    setIsSending(true);
    setError(null);
    try {
      const res  = await fetch('/api/auth/request-otp', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Erreur lors de l\'envoi du code.');
        return;
      }
      setStep('code');
      setCode(Array(6).fill(''));
      setResendIn(RESEND_DELAY_S);
      setTimeout(() => cellRefs.current[0]?.focus(), 50);
    } catch {
      setError('Erreur lors de l\'envoi du code.');
    } finally {
      setIsSending(false);
    }
  }

  async function submitCode(fullCode: string) {
    if (isVerifying) return;
    setIsVerifying(true);
    setError(null);
    try {
      const res  = await fetch('/api/auth/verify-otp', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, token: fullCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Code invalide ou expiré.');
        setCode(Array(6).fill(''));
        cellRefs.current[0]?.focus();
        return;
      }
      onAuthenticated?.();
    } catch {
      setError('Erreur lors de la vérification du code.');
    } finally {
      setIsVerifying(false);
    }
  }

  function handleCellChange(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next  = [...code];
    next[index] = digit;
    setCode(next);

    if (digit && index < 5) {
      cellRefs.current[index + 1]?.focus();
    }

    if (digit && index === 5) {
      const fullCode = next.join('');
      if (fullCode.length === 6) submitCode(fullCode);
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
      submitCode(pasted);
    } else {
      cellRefs.current[pasted.length]?.focus();
    }
  }

  return (
    <div
      className="rounded-2xl border border-gray-100 p-4"
      style={{ boxShadow: 'var(--shadow-card)' }}
    >
      {step === 'email' ? (
        <form onSubmit={sendCode} className="space-y-3">
          <p className="text-sm font-semibold text-gray-700">Connecte-toi pour gagner des points</p>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="Ton email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={INPUT_CLS}
            required
          />
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={isSending || !email}
            className="w-full py-2.5 rounded-xl font-semibold text-white text-sm disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {isSending ? 'Envoi…' : 'Recevoir mon code'}
          </button>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Code envoyé à <span className="font-medium text-gray-800">{email}</span>
          </p>
          <div className="flex gap-2 justify-between" onPaste={handlePaste}>
            {code.map((digit, i) => (
              <input
                key={i}
                ref={(el) => { cellRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleCellChange(i, e.target.value)}
                onKeyDown={(e) => handleCellKeyDown(i, e)}
                className="w-10 h-12 text-center text-lg font-semibold border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
                disabled={isVerifying}
              />
            ))}
          </div>
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <button
            type="button"
            onClick={() => sendCode()}
            disabled={resendIn > 0 || isSending}
            className="text-xs text-gray-400 disabled:opacity-60"
            style={resendIn === 0 ? { color: 'var(--color-primary)' } : undefined}
          >
            {resendIn > 0 ? `Renvoyer le code (${resendIn}s)` : 'Renvoyer le code'}
          </button>
        </div>
      )}
    </div>
  );
}
