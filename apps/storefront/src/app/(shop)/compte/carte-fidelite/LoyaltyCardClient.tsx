'use client';

import { useState } from 'react';
import Link from 'next/link';
import { IconArrowLeft, IconCopy, IconCheck, IconWallet } from '@tabler/icons-react';
import { LoyaltyCardFace } from '@/components/loyalty/LoyaltyCardFace';
import type { LoyaltyBrand } from '@/lib/loyalty/wallet/brand';

interface LoyaltyCardClientProps {
  fullName: string | null;
  cardNumber: string | null;
  cardNumberDisplay: string | null;
  confirmedBalance: number;
  qrSvg: string | null;
  barcodeSvg: string | null;
  brand: LoyaltyBrand;
  wallets: { google: boolean; apple: boolean };
}

export function LoyaltyCardClient({
  fullName, cardNumber, cardNumberDisplay, confirmedBalance, qrSvg, barcodeSvg, brand, wallets,
}: LoyaltyCardClientProps) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<'google' | 'apple' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCopy() {
    if (!cardNumber) return;
    try {
      await navigator.clipboard.writeText(cardNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('La copie est indisponible. Vous pouvez sélectionner le numéro affiché.');
    }
  }

  async function addToWallet(provider: 'google' | 'apple') {
    setBusy(provider);
    setError(null);
    try {
      const response = await fetch(`/api/loyalty/wallet/${provider}`, { cache: 'no-store' });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || 'Impossible de préparer la carte. Réessayez dans un instant.');
      }
      if (provider === 'google') {
        const body = await response.json();
        window.location.assign(body.url);
      } else {
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = url;
        link.download = 'carte-fidelite.pkpass';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'La carte est momentanément indisponible.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f8fa] px-4 py-6 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <Link href="/compte" className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-gray-600">
          <IconArrowLeft size={18} aria-hidden="true" /> Mon compte
        </Link>
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Votre fidélité, toujours avec vous.</h1>
          <p className="mt-2 text-sm text-gray-600">Votre carte {brand.name}, en caisse et sur votre téléphone.</p>
        </header>
        <div className="grid items-start gap-6 md:grid-cols-2">
          <div>
            <LoyaltyCardFace brand={brand} fullName={fullName} points={confirmedBalance}
              cardNumberDisplay={cardNumberDisplay} />
            <section className="mt-5 rounded-2xl border border-gray-200 bg-white p-5" aria-labelledby="wallet-heading">
              <h2 id="wallet-heading" className="flex items-center gap-2 font-semibold text-gray-900">
                <IconWallet size={21} aria-hidden="true" /> Gardez votre carte dans Wallet
              </h2>
              <p className="mt-2 text-sm leading-6 text-gray-600">Retrouvez votre QR code sans ouvrir la boutique.</p>
              {cardNumber && (wallets.google || wallets.apple) ? (
                <>
                  <div className="mt-4 flex flex-col gap-3">
                    {wallets.google && <button type="button" disabled={busy !== null}
                      onClick={() => addToWallet('google')}
                      className="min-h-12 rounded-xl bg-gray-950 px-4 py-3 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50">
                      {busy === 'google' ? 'Préparation…' : 'Ajouter à Google Wallet'}
                    </button>}
                    {wallets.apple && <button type="button" disabled={busy !== null}
                      onClick={() => addToWallet('apple')}
                      className="min-h-12 rounded-xl bg-gray-950 px-4 py-3 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50">
                      {busy === 'apple' ? 'Préparation…' : 'Ajouter à Apple Wallet'}
                    </button>}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-gray-500">Le solde est actualisé lorsque vous ajoutez à nouveau la carte. Consultez cette page pour le solde actuel.</p>
                </>
              ) : <p className="mt-3 text-sm text-gray-500">L’ajout à Wallet sera disponible prochainement. Vous pouvez déjà présenter votre carte ci-dessous.</p>}
              {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
            </section>
          </div>
          <section className="rounded-3xl border border-gray-200 bg-white p-5 text-center sm:p-6" aria-labelledby="scan-heading">
            <h2 id="scan-heading" className="text-lg font-bold text-gray-900">Présentez votre carte en caisse</h2>
            {cardNumber ? (
              <>
                <div className="mx-auto my-5 h-[220px] w-[220px] max-w-full bg-white [&>svg]:h-full [&>svg]:w-full"
                  role="img" aria-label="QR code de votre carte de fidélité"
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{ __html: qrSvg ?? '' }} />
                <p className="mb-5 text-sm text-gray-500">Faites scanner ce QR code ou le code-barres.</p>
                {barcodeSvg && <div className="mx-auto max-w-[320px] bg-white [&>svg]:h-auto [&>svg]:w-full"
                  role="img" aria-label="Code-barres de votre carte de fidélité"
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{ __html: barcodeSvg }} />}
                <button type="button" onClick={handleCopy}
                  className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 font-mono text-sm text-gray-700">
                  {copied ? <IconCheck size={17} aria-hidden="true" /> : <IconCopy size={17} aria-hidden="true" />}
                  {cardNumberDisplay}
                </button>
                <p aria-live="polite" className="mt-2 text-xs text-gray-500">{copied ? 'Numéro copié' : 'Toucher pour copier le numéro'}</p>
              </>
            ) : (
              <div className="py-10">
                <p className="text-sm text-gray-500">Votre numéro de carte est en cours de génération.</p>
                <button type="button" onClick={() => window.location.reload()}
                  className="mt-4 min-h-11 rounded-xl border border-gray-200 px-4 text-sm font-semibold">Réessayer</button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
