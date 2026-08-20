interface CartQuantityControlProps {
  quantity: number;
  min?: number;
  max: number;
  productName: string;
  disabled?: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
}

/**
 * Stepper +/- dédié aux lignes de panier — même style visuel que le contrôle
 * déjà utilisé sur /cart (CartClient.tsx, non touché par cette tâche), mais
 * composant distinct de QuantitySelector.tsx (PDP) : celui-ci accepte une
 * saisie libre au clavier avant l'ajout au panier, ce contrôle-ci n'a que
 * +/- et un plancher à `min` (jamais de suppression accidentelle en
 * décrémentant — c'est le lien "Retirer" explicite qui supprime la ligne).
 * Boutons 44px (w-11 h-11) : cible tactile minimale (§7/§26).
 */
export function CartQuantityControl({
  quantity,
  min = 1,
  max,
  productName,
  disabled = false,
  onIncrement,
  onDecrement,
}: CartQuantityControlProps) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onDecrement}
        disabled={disabled || quantity <= min}
        aria-label={`Réduire la quantité de ${productName}`}
        className="w-11 h-11 rounded-full border border-gray-200 flex items-center justify-center text-sm font-bold text-gray-600 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-30 transition-colors"
      >
        −
      </button>
      <span className="w-6 text-center text-sm font-semibold tabular-nums" aria-live="polite">
        {quantity}
      </span>
      <button
        type="button"
        onClick={onIncrement}
        disabled={disabled || quantity >= max}
        aria-label={`Augmenter la quantité de ${productName}`}
        className="w-11 h-11 rounded-full border border-gray-200 flex items-center justify-center text-sm font-bold text-gray-600 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-30 transition-colors"
      >
        +
      </button>
    </div>
  );
}
