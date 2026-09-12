'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  IconAlertTriangle,
  IconCheck,
  IconLock,
  IconMail,
  IconTrash,
} from '@tabler/icons-react';

type Step = 'identify' | 'otp' | 'confirm' | 'success' | 'manual_review';

interface AccountDeletionClientProps {
  tenantName: string;
  initialEmail: string | null;
  legalEmail: string | null;
}

async function readJson(response: Response): Promise<{ error?: string; status?: string }> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export function AccountDeletionClient({
  tenantName,
  initialEmail,
  legalEmail,
}: AccountDeletionClientProps) {
  const [step, setStep] = useState<Step>(initialEmail ? 'confirm' : 'identify');
  const [email, setEmail] = useState(initialEmail ?? '');
  const [token, setToken] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (step !== 'identify') headingRef.current?.focus();
  }, [step]);

  async function requestOtp(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/privacy/account-deletion/request-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(body.error || 'Envoi impossible.');
      setStep('otp');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Envoi impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/privacy/account-deletion/verify-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, token }),
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(body.error || 'Vérification impossible.');
      setStep('confirm');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Vérification impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    if (!confirmed || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/privacy/account-deletion', { method: 'POST' });
      const body = await readJson(response);
      if (body.status === 'manual_review') {
        setStep('manual_review');
        return;
      }
      if (!response.ok || body.status !== 'completed') {
        throw new Error('La suppression n’a pas pu être terminée. Veuillez réessayer.');
      }

      try {
        localStorage.removeItem('lepefy-cart');
        sessionStorage.removeItem('lepefy:nala:conversation:v1');
      } catch {
        // Le stockage peut être indisponible; la session serveur est déjà supprimée.
      }
      window.dispatchEvent(new Event('lepefy:customer-logged-out'));
      setStep('success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Suppression impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10 sm:py-14">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-card sm:p-8">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-700">
          {step === 'success' ? <IconCheck aria-hidden="true" /> : <IconTrash aria-hidden="true" />}
        </div>

        <h1 ref={headingRef} tabIndex={-1} className="font-display text-2xl font-bold text-gray-900 outline-none">
          {step === 'success'
            ? 'Votre compte a été supprimé'
            : step === 'manual_review'
              ? 'Votre demande doit être vérifiée'
              : 'Supprimer mon compte'}
        </h1>

        {step === 'identify' && (
          <>
            <p className="mt-3 text-sm leading-6 text-gray-600">
              Saisissez l’adresse email de votre compte {tenantName}. Nous vous enverrons un code
              pour vérifier votre identité, sans créer de nouveau compte.
            </p>
            <form onSubmit={requestOtp} className="mt-6 space-y-4">
              <label className="block text-sm font-semibold text-gray-800" htmlFor="deletion-email">
                Adresse email
              </label>
              <div className="relative">
                <IconMail size={19} aria-hidden="true" className="absolute left-3 top-3 text-gray-400" />
                <input
                  id="deletion-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="min-h-11 w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 focus:border-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-200"
                />
              </div>
              <button disabled={busy} className="min-h-11 w-full rounded-lg bg-gray-900 px-4 py-2.5 font-semibold text-white disabled:opacity-50">
                {busy ? 'Envoi…' : 'Recevoir le code'}
              </button>
            </form>
          </>
        )}

        {step === 'otp' && (
          <>
            <p className="mt-3 text-sm leading-6 text-gray-600">
              Entrez le code à 6 chiffres envoyé à <strong>{email}</strong>. Aucune donnée ne sera
              supprimée à cette étape.
            </p>
            <form onSubmit={verifyOtp} className="mt-6 space-y-4">
              <label className="block text-sm font-semibold text-gray-800" htmlFor="deletion-token">
                Code de vérification
              </label>
              <input
                id="deletion-token"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={token}
                onChange={(event) => setToken(event.target.value.replace(/\D/g, '').slice(0, 6))}
                className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-center text-xl tracking-[0.35em] focus:border-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-200"
              />
              <button disabled={busy || token.length !== 6} className="min-h-11 w-full rounded-lg bg-gray-900 px-4 py-2.5 font-semibold text-white disabled:opacity-50">
                {busy ? 'Vérification…' : 'Vérifier mon identité'}
              </button>
            </form>
          </>
        )}

        {step === 'confirm' && (
          <>
            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900">
              <div className="flex gap-3">
                <IconAlertTriangle className="mt-0.5 shrink-0" size={21} aria-hidden="true" />
                <p>
                  Cette action est irréversible. Votre profil, vos adresses, votre panier, vos
                  points et vos données Nala liées au compte seront supprimés. Les commandes,
                  paiements et justificatifs légalement nécessaires seront conservés sans lien
                  vers votre compte.
                </p>
              </div>
            </div>
            <label className="mt-6 flex cursor-pointer items-start gap-3 text-sm leading-6 text-gray-700">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-1 h-5 w-5 rounded border-gray-300 text-red-700 focus:ring-red-600"
              />
              Je comprends que la suppression est définitive et je confirme vouloir supprimer mon compte.
            </label>
            <button
              type="button"
              onClick={deleteAccount}
              disabled={!confirmed || busy}
              className="mt-5 min-h-11 w-full rounded-lg bg-red-700 px-4 py-2.5 font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Suppression…' : 'Supprimer définitivement mon compte'}
            </button>
          </>
        )}

        {step === 'success' && (
          <div className="mt-4 space-y-5 text-sm leading-6 text-gray-600">
            <p>Vous êtes maintenant déconnecté. Merci d’avoir utilisé {tenantName}.</p>
            <Link href="/" className="inline-flex min-h-11 items-center rounded-lg bg-gray-900 px-5 py-2.5 font-semibold text-white">
              Retour à l’accueil
            </Link>
          </div>
        )}

        {step === 'manual_review' && (
          <div className="mt-4 space-y-5 text-sm leading-6 text-gray-600">
            <p>
              Pour protéger les accès administratifs ou régler une obligation ambassadeur en cours,
              aucune suppression automatique n’a été effectuée.
            </p>
            {legalEmail ? (
              <a href={`mailto:${legalEmail}`} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 font-semibold text-gray-800">
                <IconLock size={18} aria-hidden="true" />
                Contacter le support
              </a>
            ) : (
              <p>Contactez directement la boutique pour finaliser votre demande.</p>
            )}
          </div>
        )}

        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}

        {step !== 'success' && (
          <p className="mt-6 text-center text-sm">
            <Link href="/" className="min-h-11 text-gray-500 underline hover:text-gray-800">Annuler et revenir à l’accueil</Link>
          </p>
        )}
      </div>
    </main>
  );
}
