import { getNextValidQuantity, getPreviousValidQuantity } from '@/lib/purchaseQuantityRules';

interface QuantitySelectorProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (n: number) => void;
}

/** Only real purchasable quantities can leave this control. */
export function QuantitySelector({ value, min = 1, max = 99, step = 1, onChange }: QuantitySelectorProps) {
  const previous = getPreviousValidQuantity(value, min, step);
  const next = getNextValidQuantity(value, min, step, max);
  return (
    <div className="flex items-center overflow-hidden rounded-lg border border-gray-300 w-fit" role="group" aria-label="Quantité">
      <button type="button" onClick={() => { if (previous !== null) onChange(previous); }} disabled={previous === null}
        aria-label="Diminuer la quantité"
        className="flex h-11 w-11 items-center justify-center font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-40">−</button>
      <output aria-live="polite" aria-atomic="true" className="flex h-11 w-12 items-center justify-center text-center text-sm font-medium">
        {value}
      </output>
      <button type="button" onClick={() => { if (next !== null) onChange(next); }} disabled={next === null}
        aria-label="Augmenter la quantité"
        className="flex h-11 w-11 items-center justify-center font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-40">+</button>
    </div>
  );
}
