interface QuantitySelectorProps { value: number; min?: number; max?: number; onChange: (n: number) => void; }

export function QuantitySelector({ value, min = 1, max = 99, onChange }: QuantitySelectorProps) {
  return (
    <div className="flex items-center gap-1 border border-gray-300 rounded-lg overflow-hidden w-fit">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} className="px-3 py-2 text-gray-600 hover:bg-gray-100 disabled:opacity-40 transition-colors font-medium">−</button>
      <input type="number" value={value} min={min} max={max}
        onChange={(e) => { const n = parseInt(e.target.value, 10); if (!isNaN(n)) onChange(Math.max(min, Math.min(max, n))); }}
        className="w-12 text-center text-sm font-medium border-0 focus:ring-0 focus:outline-none py-2" />
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} className="px-3 py-2 text-gray-600 hover:bg-gray-100 disabled:opacity-40 transition-colors font-medium">+</button>
    </div>
  );
}
