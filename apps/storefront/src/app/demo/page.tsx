import { notFound } from 'next/navigation';
import { IconFlask } from '@tabler/icons-react';
import { getDemoContext } from '@/lib/demo/server/demoContext';
import { countDemoEvent } from '@/lib/demo/server/demoServices';
import { DEMO_PATHS } from '@/lib/demo/tours';
import DemoPathCards from './_components/DemoPathCards';
import DemoRequestPanel from './_components/DemoRequestPanel';

export const dynamic = 'force-dynamic';

export default async function DemoLandingPage({ searchParams }: { searchParams: { acces?: string } }) {
  const demo = await getDemoContext();
  if (!demo) notFound();
  await countDemoEvent('landing.view');

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 sm:py-12">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-a-border bg-a-surface px-3 py-1 text-xs font-semibold text-a-text-2">
            <IconFlask size={14} aria-hidden="true" /> Démonstration Lepefy
          </span>
          <span className="rounded-full border border-a-border bg-a-surface px-3 py-1 text-xs font-semibold text-a-text-2">
            Exemple : {demo.tenant.name}
          </span>
          <span className="rounded-full border border-a-border bg-a-surface px-3 py-1 text-xs font-semibold text-a-text-3">
            Remise à zéro chaque nuit
          </span>
        </div>
        <h1 className="font-display text-3xl font-semibold leading-tight text-a-text sm:text-4xl">
          Voyez Lepefy tourner chez un commerçant
        </h1>
        <p className="max-w-2xl text-base text-a-text-2">
          Boutique, événements, commandes et gestion : ce sont les vrais écrans de la plateforme, remplis avec des données d’exemple.
          Les paiements passent par la carte de test et aucun message n’est envoyé.
        </p>
        {searchParams.acces === 'invalide' && (
          <p role="alert" className="rounded-lg border border-tone-warning-border bg-tone-warning-bg px-3 py-2 text-sm text-tone-warning-fg">
            Ce lien d’accès n’est plus valable. Demandez-en un nouveau à l’équipe Lepefy.
          </p>
        )}
      </header>

      <section aria-labelledby="demo-paths" className="flex flex-col gap-3">
        <h2 id="demo-paths" className="text-base font-semibold text-a-text">Choisissez un parcours</h2>
        <DemoPathCards paths={DEMO_PATHS.map(({ key, title, summary, minutes, admin, steps }) => ({ key, title, summary, minutes, admin, firstHref: steps[0]?.href ?? '/' }))} />
        <p className="text-sm text-a-text-3">
          Les parcours « commandes » et « gestion » ouvrent l’administration en visite lecture seule pendant 4 heures, sans créer de compte.
        </p>
      </section>

      <DemoRequestPanel />
    </main>
  );
}
