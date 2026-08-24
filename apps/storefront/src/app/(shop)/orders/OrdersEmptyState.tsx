import Link from 'next/link';
import { IconArrowRight, IconTruckDelivery } from '@tabler/icons-react';

export function OrdersEmptyState() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-14 text-center sm:px-6 sm:py-20">
      <div
        className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary-dark)' }}
      >
        <IconTruckDelivery size={30} stroke={1.6} />
      </div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Mes commandes</p>
      <h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">Aucune commande pour l&apos;instant</h1>
      <p className="mt-3 max-w-md text-sm leading-6 text-gray-500">
        Vos prochaines commandes apparaîtront ici avec leur statut, leur montant et leur suivi.
      </p>
      <Link
        href="/products"
        className="mt-7 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 sm:w-auto"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        Découvrir la boutique
        <IconArrowRight size={17} />
      </Link>
    </div>
  );
}
