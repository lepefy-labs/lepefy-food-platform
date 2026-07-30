import Link from 'next/link';
import { IconUserCircle } from '@tabler/icons-react';
import { OrderLookupForm } from './OrderLookupForm';

export function OrdersLoginPrompt() {
  return (
    <div className="max-w-sm mx-auto px-4 pt-10 pb-4 flex flex-col items-center gap-6">
      <IconUserCircle size={56} stroke={1.2} color="#1D9E75" />
      <div className="text-center">
        <h1 className="text-xl font-bold text-gray-900">Retrouve tes commandes</h1>
        <p className="text-sm text-gray-400 mt-2">
          Connecte-toi pour retrouver toutes tes commandes
        </p>
      </div>

      <Link
        href="/compte/connexion"
        className="w-full text-center bg-[#1D9E75] text-white font-medium py-3 rounded-xl text-sm hover:bg-[#0F6E56] transition-colors"
      >
        Se connecter
      </Link>

      <div className="w-full border-t border-gray-100 pt-6 flex flex-col gap-3">
        <p className="text-xs text-gray-400 text-center">
          Tu as un numéro de commande&nbsp;? Suis-la directement ici
        </p>
        <OrderLookupForm variant="compact" />
      </div>
    </div>
  );
}
