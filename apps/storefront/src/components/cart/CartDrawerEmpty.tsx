import { CartEmpty } from './CartEmpty';

interface CartDrawerEmptyProps {
  onNavigate: () => void;
}

// Copie identique à l'état vide de /cart (CartClient.tsx, non touché) —
// réutilisation volontaire du texte déjà validé plutôt qu'une nouvelle
// formulation : cohérence entre le drawer et la page panier complète.
export function CartDrawerEmpty({ onNavigate }: CartDrawerEmptyProps) {
  return <CartEmpty onNavigate={onNavigate} headingLevel="h3" />;
}
