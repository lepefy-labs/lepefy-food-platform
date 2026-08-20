import Link from 'next/link';
import { IconShoppingCartOff } from '@tabler/icons-react';

interface CartDrawerEmptyProps {
  onNavigate: () => void;
}

// Copie identique à l'état vide de /cart (CartClient.tsx, non touché) —
// réutilisation volontaire du texte déjà validé plutôt qu'une nouvelle
// formulation : cohérence entre le drawer et la page panier complète.
export function CartDrawerEmpty({ onNavigate }: CartDrawerEmptyProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center">
      <IconShoppingCartOff size={48} className="text-gray-300 mb-4" stroke={1.25} />
      <h3 className="text-base font-bold mb-1.5">Votre panier est vide</h3>
      <p className="text-sm text-gray-500 mb-6 max-w-[240px]">
        Ajoutez des produits pour commencer votre commande.
      </p>
      <Link
        href="/products"
        onClick={onNavigate}
        className="px-6 py-3 rounded-2xl font-semibold text-white text-sm"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        Voir le catalogue
      </Link>
    </div>
  );
}
