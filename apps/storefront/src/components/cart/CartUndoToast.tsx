interface CartUndoToastProps {
  productName: string;
  onUndo: () => void;
}

// Rendu en flux normal entre la liste d'articles et le footer (jamais en
// `position: absolute` par-dessus le footer) — une première version flottait
// au-dessus du footer et recouvrait "Continuer mes achats" ; détecté par la
// vérification statique de cette tâche (mesure réelle des rects qui se
// chevauchaient), pas juste "visuellement plausible". Le flux normal évite ce
// chevauchement quel que soit le contenu du footer (bannière sync présente ou
// non, free shipping progress ou non).
//
// Jamais de confirmation modale bloquante avant suppression (§8) : l'article
// est déjà retiré quand ce toast apparaît, "Annuler" ne fait que le
// ré-ajouter via cartStore.addItem (mêmes API publiques que le reste de
// l'app, aucun accès direct à l'API/au sync engine — §22/§23).
export function CartUndoToast({ productName, onUndo }: CartUndoToastProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-5 mb-3 flex items-center justify-between gap-3 bg-gray-900 text-white text-sm rounded-2xl px-4 py-3 shadow-lg shrink-0"
    >
      <span className="truncate">
        <span className="font-medium">{productName}</span> retiré du panier
      </span>
      <button
        type="button"
        onClick={onUndo}
        className="font-semibold underline underline-offset-2 shrink-0 py-1"
      >
        Annuler
      </button>
    </div>
  );
}
