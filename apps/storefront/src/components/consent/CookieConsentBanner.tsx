'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

// Incrémenter cette version force une nouvelle demande de consentement pour
// tous les visiteurs, même ceux ayant déjà un cookie valide.
const CONSENT_VERSION = 1;
const COOKIE_NAME = 'lepefy_cookie_consent';

interface ConsentValue {
  necessary: boolean;
  analytics: boolean;
  marketing: boolean;
  version: number;
  consented_at: string;
}

function readConsentCookie(): ConsentValue | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  if (!match?.[1]) return null;
  try {
    return JSON.parse(decodeURIComponent(match[1])) as ConsentValue;
  } catch {
    return null;
  }
}

function writeConsentCookie(value: ConsentValue) {
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(value))}; path=/; max-age=${oneYear}; SameSite=Lax`;
}

function syncToServer(analytics: boolean, marketing: boolean) {
  // Fire-and-forget : ne doit jamais bloquer ni faire échouer l'UX du
  // bandeau. Le cookie client reste la source de vérité pour les guests ;
  // la route décide elle-même s'il y a une session à rattacher.
  fetch('/api/consent/cookies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analytics, marketing }),
  }).catch(() => {});
}

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    const existing = readConsentCookie();
    if (!existing || existing.version < CONSENT_VERSION) {
      setVisible(true);
    }
  }, []);

  function apply(nextAnalytics: boolean, nextMarketing: boolean) {
    const value: ConsentValue = {
      necessary: true,
      analytics: nextAnalytics,
      marketing: nextMarketing,
      version: CONSENT_VERSION,
      consented_at: new Date().toISOString(),
    };
    writeConsentCookie(value);
    syncToServer(nextAnalytics, nextMarketing);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[60] bg-white border-t border-gray-200 shadow-[0_-2px_10px_rgba(0,0,0,0.08)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      role="dialog"
      aria-label="Consentement aux cookies"
    >
      <div className="max-w-3xl mx-auto px-4 py-4 space-y-3">
        <p className="text-sm text-gray-600 leading-relaxed">
          Nous utilisons des cookies nécessaires au fonctionnement du site, ainsi que des cookies
          optionnels de mesure d&apos;audience et de personnalisation, soumis à votre consentement.
          Plus d&apos;informations dans notre{' '}
          <Link href="/politique-confidentialite" className="underline">
            politique de confidentialité
          </Link>
          .
        </p>

        {expanded && (
          <div className="space-y-2 border-t border-gray-100 pt-3">
            <label className="flex items-center justify-between gap-3 text-sm text-gray-600">
              <span>Nécessaires (toujours actifs)</span>
              <input type="checkbox" checked disabled className="h-4 w-4" />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm text-gray-600">
              <span>Mesure d&apos;audience (analytics)</span>
              <input
                type="checkbox"
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
                className="h-4 w-4"
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm text-gray-600">
              <span>Marketing</span>
              <input
                type="checkbox"
                checked={marketing}
                onChange={(e) => setMarketing(e.target.checked)}
                className="h-4 w-4"
              />
            </label>
          </div>
        )}

        <div className="flex flex-wrap gap-2 justify-end">
          {expanded ? (
            <button
              type="button"
              onClick={() => apply(analytics, marketing)}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              Enregistrer mes choix
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 border border-gray-300"
              >
                Personnaliser
              </button>
              <button
                type="button"
                onClick={() => apply(false, false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 border border-gray-300"
              >
                Refuser non essentiels
              </button>
              <button
                type="button"
                onClick={() => apply(true, true)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                Accepter tout
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
