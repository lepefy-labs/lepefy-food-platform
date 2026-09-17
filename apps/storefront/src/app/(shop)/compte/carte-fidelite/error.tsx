'use client';

import Link from 'next/link';

export default function LoyaltyCardError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-12 text-center">
      <h1 className="text-xl font-bold text-gray-900">Votre carte est momentanément indisponible</h1>
      <p className="mt-3 text-sm text-gray-600">Nous n’avons pas pu charger votre carte et votre solde. Réessayez dans un instant.</p>
      <button type="button" onClick={reset} className="mt-6 min-h-11 rounded-xl bg-gray-900 px-5 text-sm font-semibold text-white">Réessayer</button>
      <Link href="/compte" className="mt-4 block py-3 text-sm text-gray-600">Retour à mon compte</Link>
    </div>
  );
}
