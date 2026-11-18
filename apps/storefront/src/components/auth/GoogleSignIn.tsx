'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTenant } from '@/providers/TenantProvider';
import { marketingConsentLabel } from '@/lib/legal/consentCopy';
import { detectInstallContext } from '@/lib/pwa/appInstall';
import { FieldMessage } from '@/components/ui/form';

// "Continuer avec Google" (Google Identity Services button) and, where asked,
// the One Tap prompt. The ID token goes to POST /api/auth/google; a new
// customer of the shop is asked for the CGV consent before the account opens.
//
// The client ID is per deployment (one Vercel project = one shop, one Google
// Cloud project per shop so Google shows the shop's name). Without
// NEXT_PUBLIC_GOOGLE_CLIENT_ID the component renders nothing.

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const CLIENT_ID = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '').split(',')[0]?.trim() ?? '';

interface GoogleCredentialResponse { credential?: string }

interface GoogleIdApi {
  initialize(config: Record<string, unknown>): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
  prompt(): void;
  cancel(): void;
}

declare global {
  interface Window { google?: { accounts?: { id?: GoogleIdApi } } }
}

let gsiLoader: Promise<GoogleIdApi> | null = null;

function loadGsi(): Promise<GoogleIdApi> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (gsiLoader) return gsiLoader;
  gsiLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.onload = () => {
      const api = window.google?.accounts?.id;
      if (api) resolve(api);
      else reject(new Error('gsi_unavailable'));
    };
    script.onerror = () => {
      gsiLoader = null;
      reject(new Error('gsi_load_failed'));
    };
    document.head.appendChild(script);
  });
  return gsiLoader;
}

function randomNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

interface GoogleSignInProps {
  onAuthenticated?: () => void;
  /** Also show Google's One Tap prompt (account page only, not in checkout). */
  oneTap?: boolean;
}

export function GoogleSignIn({ onAuthenticated, oneTap = false }: GoogleSignInProps) {
  const tenant = useTenant();
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const nonceRef = useRef('');
  const onAuthenticatedRef = useRef(onAuthenticated);
  onAuthenticatedRef.current = onAuthenticated;

  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ credential: string; email: string } | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);

  async function submit(credential: string, consent?: { terms: boolean; marketing: boolean }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential,
          nonce: nonceRef.current,
          termsAccepted: consent?.terms === true,
          marketingOptIn: consent?.marketing === true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPending(null);
        setError(data.error ?? 'Connexion Google impossible. Veuillez réessayer.');
        return;
      }
      if (data.needsConsent) {
        setPending({ credential, email: typeof data.email === 'string' ? data.email : '' });
        setTermsAccepted(false);
        setMarketingOptIn(false);
        return;
      }
      setPending(null);
      window.dispatchEvent(new Event('lepefy:customer-authenticated'));
      onAuthenticatedRef.current?.();
    } catch {
      setError('Connexion Google impossible. Veuillez réessayer.');
    } finally {
      setBusy(false);
    }
  }

  const submitRef = useRef(submit);
  submitRef.current = submit;

  useEffect(() => {
    if (!CLIENT_ID) return;
    // Google refuses sign-in inside in-app browsers (Instagram, Gmail…): the
    // e-mail code stays the way in there.
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
    if (detectInstallContext(navigator.userAgent, standalone, navigator.maxTouchPoints) === 'in_app_browser') return;

    let cancelled = false;
    let api: GoogleIdApi | null = null;

    (async () => {
      try {
        api = await loadGsi();
        if (cancelled || !buttonRef.current) return;
        nonceRef.current = randomNonce();
        api.initialize({
          client_id: CLIENT_ID,
          nonce: await sha256Hex(nonceRef.current),
          callback: (response: GoogleCredentialResponse) => {
            if (response.credential) void submitRef.current(response.credential);
          },
          context: 'signin',
          ux_mode: 'popup',
          auto_select: false,
          cancel_on_tap_outside: true,
          itp_support: true,
          use_fedcm_for_prompt: true,
        });
        if (cancelled || !buttonRef.current) return;
        const width = Math.min(400, Math.max(200, Math.floor(buttonRef.current.clientWidth)));
        api.renderButton(buttonRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          logo_alignment: 'center',
          locale: 'fr',
          width,
        });
        setAvailable(true);
        if (oneTap) api.prompt();
      } catch {
        // Google unreachable (network, blocker): the e-mail code still works.
      }
    })();

    return () => {
      cancelled = true;
      if (oneTap) api?.cancel();
    };
  }, [oneTap]);

  if (!CLIENT_ID) return null;

  return (
    <div className="space-y-3">
      <div
        ref={buttonRef}
        aria-busy={busy}
        className={pending ? 'hidden' : `flex w-full justify-center ${available ? 'min-h-11' : ''}`}
      />
      {pending && (
        <div className="space-y-2 rounded-xl border border-gray-200 p-3">
          <p className="text-sm text-gray-800">
            Première connexion{pending.email ? <> avec <span className="font-semibold">{pending.email}</span></> : null} :
            merci de confirmer pour créer votre compte.
          </p>
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
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void submit(pending.credential, { terms: termsAccepted, marketing: marketingOptIn })}
              disabled={!termsAccepted || busy}
              className="min-h-11 flex-1 rounded-xl text-sm font-bold text-white disabled:opacity-60"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              {busy ? 'Connexion…' : 'Créer mon compte'}
            </button>
            <button
              type="button"
              onClick={() => { setPending(null); setError(null); }}
              className="min-h-11 rounded-xl px-3 text-sm font-semibold text-gray-700"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
      {error && <FieldMessage tone="error">{error}</FieldMessage>}
      {available && !pending && (
        <div className="flex items-center gap-3 text-xs text-gray-500" aria-hidden="true">
          <span className="h-px flex-1 bg-gray-200" />
          ou
          <span className="h-px flex-1 bg-gray-200" />
        </div>
      )}
    </div>
  );
}
