import { IconFlask } from '@tabler/icons-react';
import DemoTour from './DemoTour';

/**
 * Bandeau permanent de la démo (root layout, démo active uniquement) : rappelle
 * que tout est fictif et qu'aucun paiement ni message réel ne part. Dans le
 * flux de la page (pas fixe) : il ne recouvre aucun en-tête collant.
 */
export default function DemoRibbon() {
  return (
    <>
      <div role="note" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-amber-100 px-4 py-1.5 text-[13px] text-amber-950">
        <p className="flex items-center gap-1.5 font-semibold">
          <IconFlask size={16} aria-hidden="true" />
          Démonstration · données fictives · aucun paiement ni message réel
        </p>
        <p className="flex flex-wrap gap-x-4">
          <span>Carte de test : 4242 4242 4242 4242</span>
          <a href="/demo/messages" className="underline underline-offset-2">Messages simulés</a>
          <a href="/demo" className="font-semibold underline underline-offset-2">Retour à la démo</a>
        </p>
      </div>
      <DemoTour />
    </>
  );
}
