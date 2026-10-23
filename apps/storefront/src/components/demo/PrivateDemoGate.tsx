import { IconLock } from '@tabler/icons-react';

/** Démo privée sans lien d'accès valide : rien d'autre n'est affiché. */
export default function PrivateDemoGate() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <div className="max-w-md space-y-3 text-center">
        <IconLock size={32} className="mx-auto text-gray-500" aria-hidden="true" />
        <h1 className="text-xl font-semibold text-gray-900">Démonstration privée</h1>
        <p className="text-gray-700">
          Cette démonstration est réservée à la personne qui a reçu le lien d’accès. Ouvrez le lien reçu, ou demandez-en un nouveau à
          l’équipe Lepefy s’il a expiré.
        </p>
      </div>
    </main>
  );
}
