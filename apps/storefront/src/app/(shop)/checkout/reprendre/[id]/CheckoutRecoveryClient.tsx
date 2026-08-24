'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconArrowLeft, IconLock } from '@tabler/icons-react';
import { CheckoutSessionEditor } from '@/components/checkout-session/CheckoutSessionEditor';
import type { Tenant, TenantPaymentMethod } from '@lepefy/types';

export function CheckoutRecoveryClient({
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
    <div className="mx-auto max-w-md px-4 pb-10 pt-6">
      <Link href="/orders" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900">
        <IconArrowLeft size={16} /> Mes commandes
      </Link>

      <div className="mb-5 mt-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-700">Achat à finaliser</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-950">Finaliser votre achat</h1>
        <p className="mt-2 text-sm leading-5 text-gray-600">
          Votre commande n&apos;est pas encore confirmée. Vérifiez les informations ci-dessous puis terminez le paiement.
        </p>
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500">
          <IconLock size={14} /> Aucun stock n&apos;est réservé avant la confirmation du paiement.
        </p>
      </div>

      <CheckoutSessionEditor
        tenant={tenant}
        externalPaymentMethods={externalPaymentMethods}
        sessionId={sessionId}
        onCancelled={() => router.push('/orders')}
      />
    </div>
  );
}
