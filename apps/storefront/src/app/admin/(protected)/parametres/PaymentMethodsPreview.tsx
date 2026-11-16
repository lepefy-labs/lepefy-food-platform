'use client';

import { useState } from 'react';
import type { PaymentModule, TenantPaymentMethod } from '@lepefy/types';
import { cn } from '@/lib/utils/cn';
import { PAYMENT_MODULES, paymentMethodName } from '@/lib/payments/paymentMethodForm';
import { customerView, paymentMethodAvailability } from '@/lib/payments/paymentMethodAvailability';
import { PaymentMethodIcon } from './PaymentMethodIcon';

/** What a customer is offered in one service, in display order. Updates with the list. */
export function PaymentMethodsPreview({ methods }: { methods: TenantPaymentMethod[] }) {
  const [service, setService] = useState<PaymentModule>('shop');
  const { shown, ignored } = customerView(methods, service);
  const meta = PAYMENT_MODULES.find((m) => m.value === service)!;

  return (
    <section aria-labelledby="pm-preview-title" className="border-t border-a-border px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="pm-preview-title" className="text-sm font-semibold text-a-text">Ce que voit le client</h3>
          <p className="mt-0.5 text-xs text-a-text-3">{meta.detail}</p>
        </div>
        <div role="group" aria-label="Service" className="flex flex-wrap gap-1">
          {PAYMENT_MODULES.map((m) => (
            <button
              key={m.value}
              type="button"
              aria-pressed={m.value === service}
              onClick={() => setService(m.value)}
              className={cn(
                'min-h-8 rounded-full border px-3 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus',
                m.value === service ? 'border-a-text bg-a-text text-a-surface' : 'border-a-border bg-a-surface text-a-text-2 hover:bg-a-hover',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid gap-2 rounded-2xl border border-a-border bg-a-surface-2 p-3 sm:max-w-md">
        <p className="text-xs font-semibold text-a-text-2">Choisissez votre moyen de paiement</p>
        {service === 'shop' && (
          <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-a-border-strong px-3 py-2 text-xs text-a-text-3">
            Carte bancaire (Stripe), réglée dans Intégrations
          </div>
        )}
        {shown.length === 0 && <p className="px-1 py-2 text-xs text-a-text-3">Aucun moyen de cette page n’est proposé ici.</p>}
        {shown.map((m, i) => (
          <div key={m.id} className="flex items-center gap-2.5 rounded-xl border border-a-border bg-a-surface px-3 py-2">
            <PaymentMethodIcon method={m.method} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-a-text">{paymentMethodName(m)}</span>
              {service === 'shop' && <span className="block text-[11px] leading-4 text-a-text-3">{paymentMethodAvailability(m, 'shop').detail}</span>}
            </span>
            <span className="text-[11px] tabular-nums text-a-text-3">{i + 1}</span>
          </div>
        ))}
      </div>

      {ignored.length > 0 && (
        <div className="mt-3 text-xs leading-5 text-a-text-3">
          <p className="font-semibold text-a-text-2">Cochés pour ce service mais sans effet :</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {ignored.map(({ method, reason }) => <li key={method.id}><span className="font-medium text-a-text-2">{paymentMethodName(method)}</span> · {reason}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
