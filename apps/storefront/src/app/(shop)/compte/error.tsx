'use client';

export default function AccountError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-12 text-center">
      <h1 className="text-xl font-bold text-gray-900">Votre compte est momentanément indisponible</h1>
      <p className="mt-3 text-sm leading-6 text-gray-600">Nous n’avons pas pu charger vos informations. Réessayez dans un instant.</p>
      <button type="button" onClick={reset} className="mt-6 min-h-11 rounded-xl bg-gray-900 px-5 py-3 text-sm font-semibold text-white">Réessayer</button>
    </div>
  );
}
