'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { IconUserCircle } from '@tabler/icons-react';
import { OtpLoginForm } from '@/components/auth/OtpLoginForm';
import type { SessionCustomer } from '@/lib/auth/getSessionCustomer';

// Déviation par rapport à la version précédente : /compte n'était qu'un
// redirect vers cette page et n'avait pas de vrai tableau de bord, donc un
// client déjà connecté voyait ici un mini-résumé (CTA parrainage + logout).
// Maintenant que /compte est le vrai tableau de bord (page.tsx +
// AccountDashboard.tsx), cette page ne doit plus faire que de l'auth : un
// visiteur déjà connecté est renvoyé directement vers /compte au lieu de
// dupliquer une partie de son contenu ici.
export function ConnexionClient({ initialCustomer }: { initialCustomer: SessionCustomer | null }) {
  const router = useRouter();

  useEffect(() => {
    if (initialCustomer) router.replace('/compte');
  }, [initialCustomer, router]);

  if (initialCustomer) return null;

  return (
    <div className="max-w-sm mx-auto px-4 pt-10 pb-4 flex flex-col items-center gap-6">
      <IconUserCircle size={56} stroke={1.2} color="var(--color-primary)" />
      <div className="text-center">
        <h1 className="text-xl font-bold text-gray-900">Mon compte</h1>
        <p className="text-sm text-gray-400 mt-2">
          Connecte-toi pour retrouver tes commandes et gagner des points
        </p>
      </div>
      <div className="w-full">
        <OtpLoginForm onAuthenticated={() => router.push('/compte')} />
      </div>
    </div>
  );
}
