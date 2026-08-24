import { IconCheck } from '@tabler/icons-react';

type CheckoutStep = 'shipping' | 'contact' | 'select-payment' | 'payment';

const STEPS = [
  { key: 'shipping', label: 'Livraison' },
  { key: 'contact', label: 'Coordonnées' },
  { key: 'payment', label: 'Paiement' },
] as const;

interface CheckoutProgressIndicatorProps {
  currentStep: CheckoutStep;
}

export function CheckoutProgressIndicator({ currentStep }: CheckoutProgressIndicatorProps) {
  const logicalStep = currentStep === 'select-payment' ? 'payment' : currentStep;
  const activeIdx = STEPS.findIndex((step) => step.key === logicalStep);

  return (
    <div className="mb-5 flex items-start" aria-label="Progression de la commande">
      {STEPS.map((step, index) => {
        const done = index < activeIdx;
        const current = index === activeIdx;
        const last = index === STEPS.length - 1;
        return (
          <div key={step.key} className={`flex items-start ${last ? '' : 'flex-1'}`}>
            <div className="flex w-[78px] shrink-0 flex-col items-center">
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors"
                style={{
                  backgroundColor: done || current ? 'var(--color-primary)' : '#E5E7EB',
                  color: done || current ? 'white' : '#9CA3AF',
                }}
              >
                {done ? <IconCheck size={14} stroke={2.5} /> : index + 1}
              </div>
              <span className="mt-1 text-center text-[10px] font-semibold leading-tight" style={{ color: current ? 'var(--color-primary)' : done ? '#15803d' : '#9CA3AF' }}>
                {step.label}
              </span>
            </div>
            {!last && <div className="mx-1.5 mt-3.5 h-0.5 flex-1" style={{ backgroundColor: done ? '#16A34A' : '#E5E7EB' }} />}
          </div>
        );
      })}
    </div>
  );
}
