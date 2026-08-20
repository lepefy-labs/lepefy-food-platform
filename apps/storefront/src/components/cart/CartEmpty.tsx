import Link from 'next/link';
import { IconShoppingCartOff } from '@tabler/icons-react';

interface CartEmptyProps {
  onNavigate?: () => void;
  headingLevel?: 'h1' | 'h2' | 'h3';
}

export function CartEmpty({ onNavigate, headingLevel = 'h2' }: CartEmptyProps) {
  const Heading = headingLevel;

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
      <IconShoppingCartOff size={48} className="text-gray-300 mb-4" stroke={1.25} aria-hidden="true" />
      <Heading className="text-xl font-bold mb-1.5">Votre panier est vide</Heading>
      <p className="text-sm text-gray-500 mb-6 max-w-[280px]">
        Ajoutez des produits pour commencer votre commande.
      </p>
      <Link
        href="/products"
        onClick={onNavigate}
        className="px-6 py-3 rounded-2xl font-semibold text-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-primary)]"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        Commencer mes achats
      </Link>
    </div>
  );
}
