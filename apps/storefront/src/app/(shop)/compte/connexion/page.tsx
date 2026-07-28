'use client';

import { useRouter } from 'next/navigation';
import { IconUserCircle } from '@tabler/icons-react';
import { OtpLoginForm } from '@/components/auth/OtpLoginForm';

export const dynamic = 'force-dynamic';

export default function ConnexionPage() {
  const router = useRouter();

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
        <OtpLoginForm onAuthenticated={() => router.push('/')} />
      </div>
    </div>
  );
}
