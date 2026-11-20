/**
 * Lecture admin des formats d'une fiche (route …/formats, rattachement et
 * détachement 188). Serveur uniquement : client service role, toujours filtré
 * par tenant.
 */
import 'server-only';
import type { createServiceClient } from '@/lib/supabase/server';
import { saleFormatWarnings } from './saleFormatsAdmin';

const BASE_SELECT = 'id, name, slug, price, stock, min_order_quantity, order_quantity_step, weight_grams, format_label, format_parent_id, sale_unit, net_content_value, net_content_unit, pack_count, net_quantity_display';
const FORMAT_SELECT = 'id, name, slug, price, compare_at_price, promo_applied, promo_price, stock, active, weight_grams, format_label, units_per_sale, format_position, format_stock_mode, min_order_quantity, order_quantity_step';

export interface AdminSaleFormatsResponse {
  base: {
    id: string; name: string; slug: string; price: number; stock: number;
    min_order_quantity: number; order_quantity_step: number; weight_grams: number | null; format_label: string | null;
    sale_unit: string | null; net_content_value: number | null; net_content_unit: string | null; pack_count: number | null; net_quantity_display: string | null;
  };
  formats: Array<{
    id: string; name: string; slug: string; price: number; compare_at_price: number | null; promo_applied: boolean; promo_price: number | null;
    stock: number; active: boolean; weight_grams: number | null; format_label: string | null; units_per_sale: number;
    format_position: number; format_stock_mode: 'shared' | 'own'; min_order_quantity: number; order_quantity_step: number;
  }>;
  groups: Array<{ name: string; min_quantity: number }>;
  warnings: string[];
}

type ServiceDb = ReturnType<typeof createServiceClient>;

export async function readSaleFormats(db: ServiceDb, tenantId: string, productId: string): Promise<AdminSaleFormatsResponse | null> {
  const { data: base, error } = await db.from('products').select(BASE_SELECT)
    .eq('tenant_id', tenantId).eq('id', productId).maybeSingle();
  if (error) throw error;
  if (!base || (base as { format_parent_id: string | null }).format_parent_id) return null;
  const { data: formats, error: formatsError } = await db.from('products').select(FORMAT_SELECT)
    .eq('tenant_id', tenantId).eq('format_parent_id', productId)
    .order('active', { ascending: false }).order('format_position').order('units_per_sale');
  if (formatsError) throw formatsError;
  const formatRows = (formats ?? []) as unknown as AdminSaleFormatsResponse['formats'];
  // Groupes à mélanger actifs de la fiche ou de ses formats : signalés, jamais désactivés.
  const memberIds = [productId, ...formatRows.map((row) => row.id)];
  const { data: memberships } = await db.from('purchase_quantity_group_products')
    .select('purchase_quantity_groups!inner(name, min_quantity, active, tenant_id)')
    .in('product_id', memberIds)
    .eq('purchase_quantity_groups.tenant_id', tenantId)
    .eq('purchase_quantity_groups.active', true);
  const groups = [...new Map(((memberships ?? []) as unknown as Array<{ purchase_quantity_groups: { name: string; min_quantity: number } }>)
    .map((row) => [row.purchase_quantity_groups.name, { name: row.purchase_quantity_groups.name, min_quantity: row.purchase_quantity_groups.min_quantity }])).values()];
  const typedBase = base as unknown as AdminSaleFormatsResponse['base'];
  return {
    base: typedBase,
    formats: formatRows,
    groups,
    warnings: saleFormatWarnings({
      base: typedBase,
      basePrice: Number(typedBase.price),
      formats: formatRows.map((row) => ({
        label: row.format_label ?? '', units_per_sale: row.units_per_sale, weight_grams: row.weight_grams, active: row.active, price: Number(row.price),
      })),
      groups,
    }),
  };
}
