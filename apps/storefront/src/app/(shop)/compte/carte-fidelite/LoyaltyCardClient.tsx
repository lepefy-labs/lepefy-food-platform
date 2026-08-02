'use client';

import { useState } from 'react';
import Link from 'next/link';
import { IconArrowLeft, IconCopy, IconCheck } from '@tabler/icons-react';

interface LoyaltyCardClientProps {
  fullName: string | null;
  cardNumber: string | null;
  cardNumberDisplay: string | null;
  confirmedBalance: number;
  qrSvg: string | null;
  barcodeSvg: string | null;
  tenantName: string;
}

const pointsFormatter = new Intl.NumberFormat('fr-FR');

export function LoyaltyCardClient({
  fullName, cardNumber, cardNumberDisplay, confirmedBalance, qrSvg, barcodeSvg, tenantName,
}: LoyaltyCardClientProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!cardNumber) return;
    await navigator.clipboard.writeText(cardNumber);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="min-h-screen flex justify-center px-4 py-8 sm:py-10" style={{ backgroundColor: '#f7f8f6' }}>
      <div className="w-full flex flex-col gap-4" style={{ maxWidth: 430 }}>
        <Link href="/compte" className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500">
          <IconArrowLeft size={16} stroke={1.8} />
          Mon compte
        </Link>

        <div
          className="w-full flex flex-col overflow-hidden rounded-[20px]"
          style={{ boxShadow: '0 8px 30px rgba(20, 40, 30, 0.12)', backgroundColor: 'white' }}
        >
          <div
            className="text-center px-5 pt-7 pb-6 text-white"
            style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))' }}
          >
            <span style={{ fontSize: 12, opacity: 0.85 }}>{tenantName}</span>
            <div className="font-extrabold mt-1" style={{ fontSize: 20 }}>
              {fullName || 'Carte fidélité'}
            </div>
            <div className="font-extrabold mt-3" style={{ fontSize: 36 }}>
              {pointsFormatter.format(confirmedBalance)} pts
            </div>
          </div>

          {cardNumber ? (
            <>
              <div className="flex flex-col items-center gap-3 px-5 py-6 border-b border-gray-100">
                <div
                  className="p-3 rounded-2xl border border-gray-100"
                  style={{ width: 180, height: 180 }}
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{ __html: qrSvg ?? '' }}
                />
                <p className="text-xs text-gray-400 text-center max-w-[240px]">
                  Présentez ce QR code ou le code-barres ci-dessous en caisse
                </p>
              </div>

              <div className="flex flex-col items-center gap-3 px-5 py-6">
                {barcodeSvg && (
                  <div
                    className="w-full flex justify-center"
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: barcodeSvg }}
                  />
                )}
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-mono font-medium border border-gray-200 text-gray-700"
                >
                  {copied ? <IconCheck size={16} stroke={2} /> : <IconCopy size={16} stroke={1.7} />}
                  {cardNumberDisplay}
                </button>
              </div>
            </>
          ) : (
            <div className="px-5 py-8 text-center text-sm text-gray-400">
              Numéro de carte en cours de génération — réessayez dans un instant.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
