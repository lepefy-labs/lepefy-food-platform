'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { IconClock, IconExternalLink } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';

interface PendingRentalPaymentData {
  requestId: string;
  link: string;
  amount: number;
  currency: string;
  isPaypal: boolean;
  label: string;
}

export default function PendingRentalPaymentClient({ requestId }: { requestId: string | null }) {
  const [data, setData] = useState<PendingRentalPaymentData | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem('lepefy-pending-rental-payment');
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as PendingRentalPaymentData;
        if (!requestId || parsed.requestId === requestId) setData(parsed);
      } catch {
        // Invalid local data: generic state below remains available.
      }
    }
    setHydrated(true);
  }, [requestId]);

  if (!hydrated) return null;

  return (
    <main className="mx-auto max-w-xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-amber-100 text-amber-700"><IconClock size={30} /></div>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Paiement en attente</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-gray-900 sm:text-4xl">Votre demande de location est enregistrée.</h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-gray-600">La réservation sera confirmée après vérification du paiement par l’équipe.</p>
      </div>

      {data ? (
        <section className="mt-8 rounded-3xl border border-black/[0.06] bg-white p-5 shadow-[0_18px_45px_rgba(50,37,20,.08)] sm:p-6">
          <dl className="space-y-4">
            <div className="flex items-center justify-between gap-4"><dt className="text-sm text-gray-500">Moyen choisi</dt><dd className="text-sm font-semibold text-gray-900">{data.label}</dd></div>
            <div className="flex items-center justify-between gap-4 border-t border-black/[0.06] pt-4"><dt className="text-sm text-gray-500">Montant à envoyer</dt><dd className="text-xl font-bold text-gray-900">{formatPrice(data.amount, data.currency)}</dd></div>
            <div className="flex items-start justify-between gap-4 border-t border-black/[0.06] pt-4"><dt className="text-sm text-gray-500">Référence</dt><dd className="max-w-[65%] break-all text-right font-mono text-xs text-gray-700">{data.requestId}</dd></div>
          </dl>

          <a href={data.link} target="_blank" rel="noopener noreferrer" className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-5 text-sm font-bold text-white">
            Ouvrir {data.label} <IconExternalLink size={16} />
          </a>

          <div className="mt-5 rounded-2xl bg-[#f7f3eb] p-4 text-xs leading-relaxed text-gray-600">
            {data.isPaypal ? <p>Sélectionnez « Amis et famille » lors du paiement pour éviter les frais.</p> : <p>Le montant n’est pas prérempli sur ce lien. Saisissez manuellement <strong>{formatPrice(data.amount, data.currency)}</strong>.</p>}
            <p className="mt-3">Une fois le paiement reçu et vérifié, vous recevrez un email de confirmation.</p>
          </div>
        </section>
      ) : (
        <p className="mt-8 rounded-3xl border border-black/[0.06] bg-white p-6 text-center text-sm text-gray-600 shadow-sm">Votre demande a bien été enregistrée. Consultez vos emails pour le récapitulatif.</p>
      )}

      <div className="mt-7 text-center"><Link href="/evenementiel" className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-[var(--color-primary)] hover:bg-white">← Retour aux services</Link></div>
    </main>
  );
}
