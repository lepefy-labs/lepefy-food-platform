import { IconCheck } from '@tabler/icons-react';

// Colocated avec CheckoutForm.tsx (state machine à 3 étapes déjà existante,
// `step`) — pas de stepper partagé trouvé ailleurs dans le repo (les
// checkouts événementiel/rental suivent le même pattern de branches
// conditionnelles sans indicateur visuel). Purement décoratif : ne lit ni ne
// modifie `step`/`setStep`, aucun impact sur la logique existante.

const STEPS: { key: 'form' | 'select-payment' | 'payment'; label: string }[] = [
  { key: 'form',           label: 'Coordonnées' },
  { key: 'select-payment', label: 'Paiement' },
  { key: 'payment',        label: 'Confirmation' },
];

interface CheckoutProgressIndicatorProps {
  currentStep: 'form' | 'select-payment' | 'payment';
}

export function CheckoutProgressIndicator({ currentStep }: CheckoutProgressIndicatorProps) {
  const activeIdx = STEPS.findIndex((s) => s.key === currentStep);

  return (
    <div className="flex items-start mb-6" aria-label="Progression de la commande">
      {STEPS.map((s, i) => {
        const done    = i < activeIdx;
        const current = i === activeIdx;
        const last    = i === STEPS.length - 1;
        return (
          <div key={s.key} className={`flex items-start ${last ? '' : 'flex-1'}`}>
            <div className="flex flex-col items-center flex-shrink-0" style={{ width: 72 }}>
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 transition-colors"
                style={{
                  backgroundColor: done || current ? 'var(--color-primary)' : '#E5E7EB',
                  color:           done || current ? 'white' : '#9CA3AF',
                }}
              >
                {done ? <IconCheck size={13} stroke={2.5} /> : i + 1}
              </div>
              <span
                className="text-[10px] font-medium mt-1 text-center leading-tight"
                style={{ color: current ? 'var(--color-primary)' : done ? 'var(--color-primary-dark, var(--color-primary))' : '#9CA3AF' }}
              >
                {s.label}
              </span>
            </div>
            {!last && (
              <div
                className="flex-1 h-0.5 mt-3 mx-1.5 transition-colors"
                style={{ backgroundColor: done ? 'var(--color-primary)' : '#E5E7EB' }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
