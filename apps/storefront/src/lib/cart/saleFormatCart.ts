import type { CartItem, ProductFulfillmentPolicy } from '@lepefy/types';
import { normalizeFulfillmentPolicy } from '@/lib/fulfillment/fulfillmentPolicy';
import { pickSellingFormatFields, type SellingFormatSource } from '@/lib/storefrontCopy/sellingFormat';
import type { SaleFormatFields, SaleFormatOption } from '@/lib/catalog/saleFormats';

type CartProduct = CartItem['product'];

/** Champs de format (187) recopiés sur la ligne du panier. */
export function pickSaleFormatFields(row: SaleFormatFields): Pick<CartProduct,
  'format_parent_id' | 'units_per_sale' | 'format_label' | 'format_stock_mode'> {
  return {
    format_parent_id: row.format_parent_id ?? null,
    units_per_sale: row.units_per_sale ?? 1,
    format_label: row.format_label?.trim() || null,
    format_stock_mode: row.format_stock_mode === 'own' ? 'own' : 'shared',
  };
}

/** Fiche canonique telle que lue par la card ou la fiche produit. */
export interface FormatParentForCart extends SellingFormatSource, SaleFormatFields {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  storage_type?: 'dry' | 'fresh' | 'frozen' | null;
  fulfillment_policy?: ProductFulfillmentPolicy | string | null;
}

/**
 * Produit de panier pour un format choisi. La base garde sa fiche ; un format
 * enfant garde son propre id (stock, prix, commande) mais le slug et l'image
 * de la fiche, pour que la ligne du panier ramène à la page publique unique.
 */
export function toFormatCartProduct(parent: FormatParentForCart, option: SaleFormatOption): CartProduct {
  const row = option.row;
  const isBase = option.isBase;
  return {
    id: row.id,
    name: isBase ? parent.name : row.name ?? `${parent.name} — ${option.label}`,
    slug: parent.slug,
    price: option.price,
    image_url: parent.image_url,
    weight_grams: row.weight_grams ?? null,
    stock: option.stock,
    storage_type: parent.storage_type ?? null,
    min_order_quantity: option.minimum,
    order_quantity_step: option.step,
    fulfillment_policy: normalizeFulfillmentPolicy(parent.fulfillment_policy ?? null),
    // Le format de vente affiché (« le paquet ») décrit l'unité de base : un lot n'en hérite pas.
    ...(isBase ? pickSellingFormatFields(parent) : {
      net_quantity_display: null, sale_unit: null, net_content_value: null, net_content_unit: null, pack_count: null,
    }),
    ...pickSaleFormatFields({ ...row, format_label: option.label }),
  };
}
