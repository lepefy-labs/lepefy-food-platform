import Link from 'next/link';
import { IconLock } from '@tabler/icons-react';

// Même page pour un jeton mal formé, inconnu, révoqué ou d'un autre tenant :
// aucune information ne permet de distinguer ces cas.
export default function OrderPortalNotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-14">
      <section className="rounded-2xl border border-gray-200/80 bg-white px-6 py-10 text-center shadow-sm">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-600"><IconLock size={24} aria-hidden="true" /></span>
        <h1 className="mt-4 text-xl font-bold text-gray-950">Lien indisponible</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-gray-600">Ce lien n’est plus valide. Contactez la boutique en indiquant votre numéro de commande imprimé sur le récapitulatif.</p>
        <Link href="/" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--color-primary)] px-5 text-sm font-semibold text-white hover:bg-[var(--color-primary-hover)]">Aller à la boutique</Link>
      </section>
    </div>
  );
}
