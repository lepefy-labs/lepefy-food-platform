interface QuantitySelectorProps { value: number; min?: number; max?: number; step?: number; onChange: (n: number) => void; }

/** min/step reflètent la règle de quantité d'achat du produit (défaut 1/1 = aucune règle) :
 *  min=4/step=4 avance par paliers de 4 (4 → 8 → 12…), jamais une quantité intermédiaire invalide. */
export function QuantitySelector({ value, min = 1, max = 99, step = 1, onChange }: QuantitySelectorProps) {
  return (
    <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden w-fit">
      <button type="button" onClick={() => onChange(Math.max(min, value - step))} disabled={value <= min} className="w-11 h-11 flex items-center justify-center text-gray-600 hover:bg-gray-100 disabled:opacity-40 transition-colors font-medium">−</button>
      <input type="number" value={value} min={min} max={max} step={step}
        onChange={(e) => { const n = parseInt(e.target.value, 10); if (!isNaN(n)) onChange(Math.max(min, Math.min(max, n))); }}
        className="w-12 h-11 text-center text-sm font-medium border-0 focus:ring-0 focus:outline-none" />
      <button type="button" onClick={() => onChange(Math.min(max, value + step))} disabled={value >= max} className="w-11 h-11 flex items-center justify-center text-gray-600 hover:bg-gray-100 disabled:opacity-40 transition-colors font-medium">+</button>
    </div>
  );
}
