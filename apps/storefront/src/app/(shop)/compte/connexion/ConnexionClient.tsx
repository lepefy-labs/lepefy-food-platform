'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconUserCircle } from '@tabler/icons-react';
import { OtpLoginForm } from '@/components/auth/OtpLoginForm';
import type { SessionCustomer } from '@/lib/auth/getSessionCustomer';

export function ConnexionClient({ initialCustomer }: { initialCustomer: SessionCustomer | null }) {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      // refresh() ré-exécute le Server Component parent : initialCustomer
      // redevient null et la vue bascule sur le formulaire de connexion.
      router.refresh();
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto px-4 pt-10 pb-4 flex flex-col items-center gap-6">
      <IconUserCircle size={56} stroke={1.2} color="var(--color-primary)" />
      <div className="text-center">
        <h1 className="text-xl font-bold text-gray-900">Mon compte</h1>
        <p className="text-sm text-gray-400 mt-2">
          {initialCustomer
            ? 'Tu es connecté(e) — tes commandes te font gagner des points'
            : 'Connecte-toi pour retrouver tes commandes et gagner des points'}
        </p>
      </div>
      <div className="w-full">
        {initialCustomer ? (
          <div
            className="rounded-2xl border border-gray-100 p-4 space-y-3"
            style={{ boxShadow: 'var(--shadow-card)' }}
          >
            <p className="text-sm text-gray-600">
              Connecté(e) en tant que{' '}
              <span className="font-medium text-gray-800">{initialCustomer.email}</span>
            </p>
            <button
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="w-full py-2.5 rounded-xl font-semibold text-sm border border-gray-200 text-gray-600 disabled:opacity-50"
            >
              {isLoggingOut ? 'Déconnexion…' : 'Se déconnecter'}
            </button>
          </div>
        ) : (
          // refresh() après vérification : le Server Component relit la
          // session et affiche l'état connecté dans la même vue, sans
          // redirection — cohérent avec le choix OTP (pas de rupture PWA).
          <OtpLoginForm onAuthenticated={() => router.refresh()} />
        )}
      </div>
    </div>
  );
}
