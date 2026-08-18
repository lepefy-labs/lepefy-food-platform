'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface ConsentementClientProps {
  tenantName: string;
  showMarketingCheckbox: boolean;
  returnPath: string;
}

export function ConsentementClient({ tenantName, showMarketingCheckbox, returnPath }: ConsentementClientProps) {
  const router = useRouter();
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/consent/reconsent-gate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ marketingOptIn, returnPath }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Une erreur est survenue.');
        return;
      }
      router.push(data.redirectTo ?? '/compte');
      router.refresh();
    } catch {
      setError('Une erreur est survenue. Veuillez réessayer.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 py-10 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">
          Nos Conditions Générales de Vente ont été mises à jour
        </h1>
        <p className="text-sm text-gray-600 leading-relaxed">
          Pour continuer à utiliser votre compte {tenantName}, merci de prendre connaissance et
          d&apos;accepter la nouvelle version de nos{' '}
          <Link href="/conditions-generales-vente" target="_blank" className="underline">
            Conditions Générales de Vente
          </Link>
          .
        </p>
      </div>

      {showMarketingCheckbox && (
        <label className="flex items-start gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={marketingOptIn}
            onChange={(e) => setMarketingOptIn(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span>Je souhaite recevoir les offres et actualités de {tenantName} par email.</span>
        </label>
      )}

      {error && <p className="text-red-500 text-sm bg-red-50 rounded-xl px-4 py-3">{error}</p>}

      <button
        type="button"
        onClick={handleAccept}
        disabled={isSubmitting}
        className="w-full py-3.5 rounded-2xl font-bold text-white text-sm disabled:opacity-50 transition-opacity"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        {isSubmitting ? 'Traitement…' : 'J\'accepte'}
      </button>
    </div>
  );
}
