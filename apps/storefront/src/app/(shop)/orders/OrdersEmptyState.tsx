import Link from 'next/link';
import { IconTruckDelivery } from '@tabler/icons-react';

export function OrdersEmptyState() {
  return (
    <div className="max-w-sm mx-auto px-4 pt-10 pb-4 flex flex-col items-center gap-6 text-center">
      <IconTruckDelivery size={56} stroke={1.2} color="#1D9E75" />
      <div>
        <h1 className="text-xl font-bold text-gray-900">Aucune commande pour l&apos;instant</h1>
        <p className="text-sm text-gray-400 mt-2">
          Découvre notre catalogue et passe ta première commande&nbsp;!
        </p>
      </div>
      <Link
        href="/products"
        className="w-full text-center bg-[#1D9E75] text-white font-medium py-3 rounded-xl text-sm hover:bg-[#0F6E56] transition-colors"
      >
        Découvrir la boutique
      </Link>
    </div>
  );
}
