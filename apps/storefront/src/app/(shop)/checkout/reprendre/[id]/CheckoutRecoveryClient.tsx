'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconAlertTriangle, IconArrowLeft, IconLock } from '@tabler/icons-react';
import { CheckoutSessionEditor } from '@/components/checkout-session/CheckoutSessionEditor';
import type { Tenant, TenantPaymentMethod } from '@lepefy/types';

export function CheckoutRecoveryClient({
  tenant,
  externalPaymentMethods,
  sessionId,
  accessToken,
  awaitingVerification = false,
}: {
  tenant: Tenant;
  externalPaymentMethods: TenantPaymentMethod[];
  sessionId: string;
  accessToken?: string;
  awaitingVerification?: boolean;
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

      {awaitingVerification && (
        <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900" role="alert">
          <div className="flex items-start gap-2">
            <IconAlertTriangle size={19} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-bold">Vous avez peut-être déjà effectué ce paiement.</p>
              <p className="mt-1">
                Si vous avez déjà payé via le moyen externe affiché ci-dessous, <strong>ne payez pas une seconde fois</strong> : notre équipe est peut-être encore en train de vérifier sa réception.
              </p>
              <p className="mt-2">
                Si vous êtes certain de ne pas avoir payé, vous pouvez reprendre cet achat, conserver le même moyen de paiement ou en choisir un autre.
              </p>
            </div>
          </div>
        </div>
      )}

      <CheckoutSessionEditor
        tenant={tenant}
        externalPaymentMethods={externalPaymentMethods}
        sessionId={sessionId}
        accessToken={accessToken}
        onCancelled={() => router.push('/orders')}
      />
    </div>
  );
}
