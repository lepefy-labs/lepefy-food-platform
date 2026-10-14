import Link from 'next/link';
import { IconChevronRight } from '@tabler/icons-react';
import { CATALOG_PROMOS_HREF } from '@/lib/catalog/catalogSearchUrl';

/**
 * Rappel discret des promotions en cours, placé après les articles du panier :
 * jamais dans la barre d'action, jamais au-dessus du sous-total. Rien n'est
 * affiché sans promotion active.
 */
export function CartPromoReminder({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Link
      href={CATALOG_PROMOS_HREF}
      className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-dashed border-red-300 bg-red-50/60 px-4 py-2 text-sm font-semibold text-red-900 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700"
    >
      <span><span aria-hidden="true">🔥 </span>{count} promo{count > 1 ? 's' : ''} en cours</span>
      <span className="inline-flex items-center gap-0.5 font-bold">Voir les promos <IconChevronRight size={16} aria-hidden="true" /></span>
    </Link>
  );
}
