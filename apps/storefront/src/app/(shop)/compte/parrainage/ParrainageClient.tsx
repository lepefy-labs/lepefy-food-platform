'use client';

import { useState } from 'react';
import { IconCopy, IconShare2, IconCheck } from '@tabler/icons-react';
import { ShopTag } from '@/components/ui/ShopTag';
import { ReferralRope } from '@/components/loyalty/ReferralRope';
import { LockedTagProgress } from '@/components/loyalty/LockedTagProgress';
import type { ReferralAvailabilityMode } from '@lepefy/types';

interface ParrainageClientProps {
  eligible: boolean;
  mode: ReferralAvailabilityMode;
  code: string | null;
  confirmedBalance: number;
  pendingBalance: number;
  progress: { currentSpend: number; threshold: number | null } | null;
  nodes: { customerId: string; level: number; points: number }[];
  appUrl: string;
  currency: string;
}

export function ParrainageClient({
  eligible,
  mode,
  code,
  confirmedBalance,
  pendingBalance,
  progress,
  nodes,
  appUrl,
  currency,
}: ParrainageClientProps) {
  const [copied, setCopied] = useState(false);

  const shareUrl = code ? `${appUrl}/compte/connexion?ref=${code}` : '';

  async function handleCopy() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleShare() {
    if (!shareUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Ton lien', url: shareUrl });
      } catch {
        // partage annulé par l'utilisateur — rien à faire
      }
    } else {
      await handleCopy();
    }
  }

  if (!eligible) {
    return (
      <div className="max-w-sm mx-auto px-4 pt-10 pb-4 flex flex-col items-center gap-6">
        <h1 className="text-xl font-bold text-gray-900 text-center">Invite un ami</h1>

        {mode === 'SPENDING_THRESHOLD' && progress && progress.threshold != null ? (
          <LockedTagProgress
            currentSpend={progress.currentSpend}
            threshold={progress.threshold}
            currency={currency}
          />
        ) : (
          <p className="text-sm text-gray-500 text-center max-w-[240px]">
            Le parrainage arrive bientôt pour toi.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto px-4 pt-8 pb-6 flex flex-col gap-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <ShopTag className="text-sm px-4 py-2">
          Ton code : {code ?? '…'}
        </ShopTag>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-700"
          >
            {copied ? <IconCheck size={16} stroke={2} /> : <IconCopy size={16} stroke={1.7} />}
            {copied ? 'Copié !' : 'Copier'}
          </button>
          <button
            type="button"
            onClick={handleShare}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-white"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            <IconShare2 size={16} stroke={1.7} />
            Partager
          </button>
        </div>
      </div>

      <div
        className="rounded-2xl border border-gray-100 px-4 py-3 text-center text-sm text-gray-600"
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        Solde : <span className="font-semibold text-gray-900">{confirmedBalance} pts</span> confirmés
        {' · '}
        {pendingBalance} en attente
      </div>

      <div className="rounded-2xl border border-gray-100 py-3" style={{ boxShadow: 'var(--shadow-card)' }}>
        <ReferralRope nodes={nodes} />
      </div>
    </div>
  );
}
