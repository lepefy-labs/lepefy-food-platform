import Link from 'next/link';
import { IconMaximize, IconWallet } from '@tabler/icons-react';
import { LoyaltyCardFace } from '@/components/loyalty/LoyaltyCardFace';
import type { LoyaltyBrand } from '@/lib/loyalty/wallet/brand';

interface LoyaltyCardWidgetProps {
  brand: LoyaltyBrand;
  fullName: string | null;
  confirmedPoints: number | null;
  cardNumberDisplay: string | null;
  walletAvailable: boolean;
}

export function LoyaltyCardWidget({ brand, fullName, confirmedPoints, cardNumberDisplay, walletAvailable }: LoyaltyCardWidgetProps) {
  return (
    <div>
      <LoyaltyCardFace brand={brand} fullName={fullName} points={confirmedPoints}
        cardNumberDisplay={cardNumberDisplay} variant="compact" />
      <Link href="/compte/carte-fidelite"
        className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 transition-colors hover:bg-gray-50">
        <IconMaximize size={18} aria-hidden="true" /> Présenter ma carte
      </Link>
      {walletAvailable && (
        <Link href="/compte/carte-fidelite#wallet-heading"
          className="mt-1 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900">
          <IconWallet size={17} aria-hidden="true" /> Ajouter à mon Wallet
        </Link>
      )}
      {!cardNumberDisplay && <p className="mt-2 text-xs leading-5 text-gray-500">Votre numéro de carte est en cours de génération.</p>}
    </div>
  );
}
