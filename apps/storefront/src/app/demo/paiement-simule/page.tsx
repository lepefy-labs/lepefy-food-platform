import Link from 'next/link';
import { IconCircleCheck } from '@tabler/icons-react';

export const dynamic = 'force-dynamic';

/**
 * Cible du moyen de paiement « Lien de paiement (simulé) » du tenant de démo :
 * dans un vrai commerce, ce lien ouvre le prestataire de paiement choisi.
 */
export default function SimulatedPaymentPage() {
  return (
    <main className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-16 text-center">
      <IconCircleCheck size={40} className="text-tone-success-solid" aria-hidden="true" />
      <h1 className="font-display text-2xl font-semibold text-a-text">Paiement simulé</h1>
      <p className="text-a-text-2">
        Dans un vrai commerce, ce lien ouvre le moyen de paiement choisi par la boutique (lien bancaire, Satispay, PayPal…).
        Ici, rien n’est débité. Côté commerçant, la commande attend la vérification du paiement dans « Paiements en attente ».
      </p>
      <Link href="/demo" className="rounded-lg bg-a-brand px-4 py-2 text-sm font-semibold text-a-on-brand hover:bg-a-brand-hover">Retour à la démo</Link>
    </main>
  );
}
