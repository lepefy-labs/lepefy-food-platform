import Link from 'next/link';
import { IconLogin2, IconUserCircle } from '@tabler/icons-react';
import { OrderLookupForm } from './OrderLookupForm';

export function OrdersLoginPrompt() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
        <div
          className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary-dark)' }}
        >
          <IconUserCircle size={28} stroke={1.6} />
        </div>

        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Mes commandes</p>
        <h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">Retrouvez toutes vos commandes</h1>
        <p className="mt-2 text-sm leading-6 text-gray-500">
          Connectez-vous pour consulter votre historique, le détail de vos achats et leur avancement.
        </p>

        <Link
          href="/compte/connexion"
          className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <IconLogin2 size={17} />
          Se connecter
        </Link>

        <div className="mt-7 border-t border-gray-100 pt-6">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-gray-800">Suivre une commande sans se connecter</h2>
            <p className="mt-1 text-xs leading-5 text-gray-500">
              Utilisez directement votre numéro de commande si vous l’avez sous la main.
            </p>
          </div>
          <OrderLookupForm variant="compact" />
        </div>
      </div>
    </div>
  );
}
