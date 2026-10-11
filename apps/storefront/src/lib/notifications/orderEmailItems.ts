import type { SupabaseClient } from '@supabase/supabase-js';
import { PRODUCT_SELLING_FORMAT_COLUMNS } from '@/lib/catalog/productCardSelect';
import { pickSellingFormatFields, type SellingFormatSource } from '@/lib/storefrontCopy/sellingFormat';
import type { OrderEmailItem } from '@/lib/notifications/customerEmails';

export interface OrderEmailSourceItem {
  productId: string | null;
  name: string;
  price: number;
  quantity: number;
}

type FormatRow = SellingFormatSource & { id: string };

/**
 * Lignes de l'email de confirmation : nom, quantité et prix payés tels
 * qu'enregistrés, plus le format de vente actuel du produit (l'email part
 * juste après le paiement). Ne lève jamais : sans format lisible, la ligne
 * s'affiche en « l'article » et l'email part quand même.
 */
export async function loadOrderEmailItems(
  supabase: SupabaseClient,
  tenantId: string,
  items: OrderEmailSourceItem[],
): Promise<OrderEmailItem[]> {
  const ids = [...new Set(items.map((item) => item.productId).filter((id): id is string => Boolean(id)))];
  const formats = new Map<string, SellingFormatSource>();
  if (ids.length) {
    try {
      const { data, error } = await supabase
        .from('products')
        .select(`id, ${PRODUCT_SELLING_FORMAT_COLUMNS}`)
        .eq('tenant_id', tenantId)
        .in('id', ids);
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as unknown as FormatRow[]) formats.set(row.id, pickSellingFormatFields(row));
    } catch (error) {
      console.warn('[order-email] selling formats unavailable — lines shown without format:', error);
    }
  }
  return items.map((item) => ({
    name: item.name,
    quantity: Number(item.quantity),
    unitPrice: Number(item.price),
    format: item.productId ? formats.get(item.productId) ?? null : null,
  }));
}
