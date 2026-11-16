'use client';

import { IconMinus } from '@tabler/icons-react';
import type { PaymentModule, TenantPaymentMethod } from '@lepefy/types';
import { cn } from '@/lib/utils/cn';
import { PAYMENT_MODULES, paymentMethodName, paymentTypeLabel } from '@/lib/payments/paymentMethodForm';
import { paymentMethodAvailability } from '@/lib/payments/paymentMethodAvailability';
import { useAdminToast } from '../../_components/ui/Toaster';
import { PaymentMethodIcon } from './PaymentMethodIcon';
import { paymentModuleIcon } from './PaymentModuleChip';

interface PaymentMethodsMatrixProps {
  methods: TenantPaymentMethod[];
  busyId: string | null;
  onToggle: (method: TenantPaymentMethod, module: PaymentModule) => void;
}

/** Methods × services: one switch per combination that can reach a customer. */
export function PaymentMethodsMatrix({ methods, busyId, onToggle }: PaymentMethodsMatrixProps) {
  const toast = useAdminToast();

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <caption className="sr-only">Services où chaque moyen de paiement est proposé</caption>
        <thead>
          <tr className="bg-a-surface-2">
            <th scope="col" className="px-3 py-2.5 text-left text-xs font-semibold text-a-text-2">Moyen</th>
            {PAYMENT_MODULES.map((module) => {
              const Glyph = paymentModuleIcon(module.value);
              return (
              <th key={module.value} scope="col" className="px-3 py-2.5 text-center align-bottom text-xs font-semibold text-a-text-2">
                <Glyph size={16} stroke={1.8} aria-hidden="true" className="mx-auto mb-1 text-a-brand-fg" />
                {module.label}
                <span className="mt-0.5 block text-[11px] font-normal leading-4 text-a-text-3">{module.detail}</span>
              </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {methods.map((method) => {
            const name = paymentMethodName(method);
            return (
              <tr key={method.id} className="border-t border-a-border">
                <th scope="row" className="px-3 py-2.5 text-left font-normal">
                  <span className="flex items-center gap-2.5">
                    <PaymentMethodIcon method={method.method} size="sm" className={cn(!method.active && 'opacity-50')} />
                    <span className="min-w-0">
                      <span className="block font-semibold text-a-text">{name}</span>
                      <span className="block text-xs text-a-text-3">{method.active ? paymentTypeLabel(method.method) : 'Désactivé'}</span>
                    </span>
                  </span>
                </th>
                {PAYMENT_MODULES.map((module) => {
                  const availability = paymentMethodAvailability(method, module.value);
                  if (!availability.ok) {
                    return (
                      <td key={module.value} className="px-3 py-2.5 text-center">
                        <button
                          type="button"
                          title={availability.detail}
                          onClick={() => toast.info(`${name} · ${module.label} : sans effet`, { description: availability.detail })}
                          className="inline-flex min-h-8 items-center gap-1 rounded-full border border-dashed border-a-border-strong px-2.5 text-[11px] font-medium text-a-text-3 hover:bg-a-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus"
                        >
                          <IconMinus size={12} aria-hidden="true" /> Sans effet
                          <span className="sr-only"> : {availability.detail}</span>
                        </button>
                      </td>
                    );
                  }
                  const on = method.enabled_modules.includes(module.value);
                  return (
                    <td key={module.value} className="px-3 py-2.5 text-center">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={`${name} sur ${module.label}`}
                        title={availability.detail}
                        disabled={busyId === method.id || !method.active}
                        onClick={() => onToggle(method, module.value)}
                        className="inline-flex min-h-10 items-center justify-center rounded-lg px-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <span aria-hidden="true" className={cn('relative inline-flex h-6 w-11 items-center rounded-full transition-colors', on ? 'bg-a-brand' : 'bg-a-border-strong')}>
                          <span className={cn('inline-block h-5 w-5 rounded-full bg-a-surface shadow transition-transform', on ? 'translate-x-5' : 'translate-x-0.5')} />
                        </span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-a-border px-3 py-2.5 text-xs leading-5 text-a-text-3">
        « Sans effet » : ce service ne peut pas afficher ce moyen avec ses réglages actuels. Touchez-le pour savoir pourquoi. Un moyen désactivé se réactive depuis la liste.
      </p>
    </div>
  );
}
