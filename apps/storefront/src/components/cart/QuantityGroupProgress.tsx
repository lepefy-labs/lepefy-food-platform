import { IconCircleCheck, IconAlertCircle } from '@tabler/icons-react';
import Link from 'next/link';
import type { CartItem } from '@lepefy/types';
import type { PublicQuantityGroup } from '@/app/api/quantity-groups/route';
import { computeQuantityRuleState } from '@/lib/purchaseQuantityRules';

/**
 * Progression des groupes de quantité combinable présents dans le panier
 * (ex. "Boissons : 10/12, ajoutez encore 2"). N'affiche que les groupes
 * effectivement entamés — un groupe jamais touché ne doit pas alarmer le
 * client, cf. lib/purchaseQuantityRules.ts §4 (le panier peut être
 * temporairement incomplet). La validation qui bloque réellement le
 * checkout reste côté serveur (/api/checkout) : ce composant est un guide,
 * jamais la source de vérité.
 */
export function QuantityGroupProgress({ groups, items }: { groups: PublicQuantityGroup[]; items: CartItem[] }) {
  const rows = groups
    .map((group) => {
      const current = items
        .filter((item) => group.productIds.includes(item.product.id))
        .reduce((sum, item) => sum + item.quantity, 0);
      return { group, current };
    })
    .filter((row) => row.current > 0);

  if (rows.length === 0) return null;

  return (
    <ul className="mb-3 space-y-2" aria-label="Progression des quantités combinées">
      {rows.map(({ group, current }) => (
        <GroupProgressCard key={group.id} group={group} current={current} />
      ))}
    </ul>
  );
}

function GroupProgressCard({ group, current }: { group: PublicQuantityGroup; current: number }) {
  const state = computeQuantityRuleState(current, group.min_quantity, group.quantity_step);

  if (state.isValid) {
    return (
      <li className="flex items-center gap-2 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        <IconCircleCheck size={18} className="shrink-0" />
        <span className="font-semibold">Minimum « {group.name} » atteint — {state.currentQuantity} unités</span>
      </li>
    );
  }

  return (
    <li className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
      <div className="flex items-center gap-2">
        <IconAlertCircle size={18} className="shrink-0 text-amber-700" />
        <span className="font-semibold text-amber-900">{group.name}</span>
        <span className="ml-auto font-semibold tabular-nums text-amber-900">{state.currentQuantity} / {state.nextValidQuantity}</span>
      </div>
      <p className="mt-1 pl-[26px] text-amber-700">
        Ajoutez encore {state.missingQuantity} unité{state.missingQuantity > 1 ? 's' : ''} de {group.name.toLowerCase()} pour valider votre commande.
      </p>
      <Link href={`/?quantityGroup=${encodeURIComponent(group.id)}`}
        className="ml-[26px] mt-2 inline-flex min-h-11 items-center rounded-lg bg-amber-900 px-4 py-2 text-sm font-bold text-white hover:bg-amber-800">
        Compléter ma sélection
      </Link>
    </li>
  );
}
