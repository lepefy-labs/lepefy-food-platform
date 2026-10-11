import { CartEmpty } from './CartEmpty';

interface CartDrawerEmptyProps {
  onNavigate: () => void;
}

// Même état vide que la page /cart (CartPurchaseClient.tsx, via CartEmpty) —
// réutilisation volontaire du texte déjà validé plutôt qu'une nouvelle
// formulation : cohérence entre le drawer et la page panier complète.
export function CartDrawerEmpty({ onNavigate }: CartDrawerEmptyProps) {
  return <CartEmpty onNavigate={onNavigate} headingLevel="h3" />;
}
