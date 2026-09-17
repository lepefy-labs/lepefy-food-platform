'use client';

import Link from 'next/link';
import { IconMaximize } from '@tabler/icons-react';
import { LoyaltyCardFace } from '@/components/loyalty/LoyaltyCardFace';
import type { LoyaltyBrand } from '@/lib/loyalty/wallet/brand';

interface LoyaltyCardWidgetProps {
  brand: LoyaltyBrand;
  fullName: string | null;
  confirmedPoints: number;
  cardNumberDisplay: string | null;
  barcodeSvg: string | null;
}

export function LoyaltyCardWidget({ brand, fullName, confirmedPoints, cardNumberDisplay, barcodeSvg }: LoyaltyCardWidgetProps) {
  return (
    <Link href="/compte/carte-fidelite"
      aria-label={`Voir ma carte de fidélité ${brand.name} et l’ajouter à mon Wallet`}
      className="group block rounded-3xl transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">
      <LoyaltyCardFace brand={brand} fullName={fullName} points={confirmedPoints}
        cardNumberDisplay={cardNumberDisplay} barcodeSvg={barcodeSvg} />
      <span className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-gray-700">
        <IconMaximize size={17} aria-hidden="true" /> Présenter ma carte · Wallet
      </span>
    </Link>
  );
}
