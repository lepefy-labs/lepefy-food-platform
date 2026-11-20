import type { CartItem } from '@lepefy/types';
import type { FormatBundlePlan, SaleFormatOption } from '@/lib/catalog/saleFormats';
import { bundleCaption } from '@/lib/storefrontCopy/saleFormatCopy';
import { formatCount, resolveSellingFormat, type SellingFormatSource } from '@/lib/storefrontCopy/sellingFormat';

/** Fiche à plusieurs formats présente dans le panier (sous-ensemble de `CartFormatGroup`). */
export interface SummaryFormatGroup {
  parent: SellingFormatSource & { id: string; name: string };
  options: SaleFormatOption[];
  ids: string[];
}

export interface CartSummaryLine {
  key: string;
  /** « 2× Arachide salé » ou, pour une fiche à formats, « Bobolo sous vide · 49 paquets ». */
  label: string;
  total: number;
  /** Composition d'une fiche à formats (« dont 2 cartons de 20 paquets · −28,20 € ») ; null sinon. */
  detail: string | null;
}

/**
 * Lignes du récapitulatif (checkout) présentées comme le panier : une fiche à
 * plusieurs formats = une ligne en unités de base avec sa composition, à la
 * place de « 2× Carton de 20 » + « 9× Bobolo ». Les lignes réelles envoyées au
 * serveur ne changent pas. Sans formats lus (`groups` vide), lignes brutes.
 */
export function buildCartSummaryLines(items: CartItem[], groups: Map<string, SummaryFormatGroup>, currency = 'EUR'): CartSummaryLine[] {
  const byProduct = new Map<string, SummaryFormatGroup>();
  for (const group of groups.values()) for (const id of group.ids) byProduct.set(id, group);
  const lines: CartSummaryLine[] = [];
  const done = new Set<string>();
  for (const item of items) {
    const group = byProduct.get(item.product.id);
    if (!group) {
      lines.push({ key: item.product.id, label: `${item.quantity}× ${item.product.name}`, total: item.product.price * item.quantity, detail: null });
      continue;
    }
    if (done.has(group.parent.id)) continue;
    done.add(group.parent.id);
    const planLines = group.options
      .map((option) => ({ option, quantity: items.find((entry) => entry.product.id === option.id)?.quantity ?? 0 }))
      .filter((line) => line.quantity > 0);
    const units = planLines.reduce((sum, line) => sum + line.quantity * line.option.units, 0);
    const total = planLines.reduce((sum, line) => sum + line.quantity * line.option.price, 0);
    const base = group.options.find((option) => option.isBase);
    const saving = base ? Math.round((base.price * units - total) * 100) / 100 : 0;
    const plan: FormatBundlePlan = { units, lines: planLines, total, savings: saving >= 0.01 ? saving : 0 };
    const sellingFormat = resolveSellingFormat(group.parent);
    const hasLot = planLines.some((line) => !line.option.isBase);
    lines.push({
      key: group.parent.id,
      label: `${group.parent.name} · ${formatCount(sellingFormat, units)}`,
      total,
      detail: hasLot ? bundleCaption(plan, group.options, sellingFormat, currency) : null,
    });
  }
  return lines;
}
