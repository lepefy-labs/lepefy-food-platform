'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconArrowLeft } from '@tabler/icons-react';
import { CheckoutSessionEditor } from '@/components/checkout-session/CheckoutSessionEditor';
import type { Tenant, TenantPaymentMethod } from '@lepefy/types';

// Wrapper client minimal : la page (Server Component) ne peut pas passer de
// fonction (onCancelled → useRouter) à CheckoutSessionEditor à travers la
// frontière RSC — même pattern que les autres pages `(shop)/compte/*Client.tsx`.
export function PendingSessionDetailClient({
  tenant,
  externalPaymentMethods,
  sessionId,
}: {
  tenant: Tenant;
  externalPaymentMethods: TenantPaymentMethod[];
  sessionId: string;
}) {
  const router = useRouter();

  return (
    <div className="max-w-md mx-auto px-4 pt-6">
      <Link href="/orders" className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800">
        <IconArrowLeft size={14} /> Retour à mes commandes
      </Link>

      <CheckoutSessionEditor
        tenant={tenant}
        externalPaymentMethods={externalPaymentMethods}
        sessionId={sessionId}
        onCancelled={() => router.push('/orders')}
      />
    </div>
  );
}
