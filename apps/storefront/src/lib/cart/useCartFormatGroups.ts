'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CartItem } from '@lepefy/types';
import type { ProductFormatsResponse } from '@/app/api/products/formats/route';
import { buildSaleFormatOptions, planFormatBundle, type SaleFormatOption } from '@/lib/catalog/saleFormats';
import type { FormatParentForCart } from './saleFormatCart';
import { setFormatUnits } from './useFormatUnits';

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;

export interface CartFormatGroupsState {
  groups: Map<string, CartFormatGroup>;
  /**
   * Formats pas encore lus : les lignes déjà marquées comme formats (lot,
   * format de base) ne doivent pas offrir de +/− par ligne, sinon un « + »
   * sur un lot ajouterait un lot entier au lieu d'un paquet.
   */
  pending: boolean;
}

/** Ligne d'un format connu (lot ou format de base) : regroupée dès que les formats sont lus. */
export function isKnownFormatLine(item: CartItem): boolean {
  return Boolean(item.product.format_parent_id || item.product.format_label);
}

export interface CartFormatGroup {
  parent: FormatParentForCart & ProductFormatsResponse['products'][number];
  options: SaleFormatOption[];
  /** Ids des formats de la fiche (lignes réelles du panier regroupées). */
  ids: string[];
}

/**
 * Fiches à plusieurs formats présentes dans le panier, lues fraîches
 * (`GET /api/products/formats`, une requête par visite) : le panier et le
 * drawer les affichent comme une seule ligne en unités de base. Sans données
 * fraîches, rien n'est regroupé (les lignes restent comme avant).
 *
 * `normalize` (page panier seulement) : un panier enregistré avant le
 * regroupement automatique (3 paquets séparés) est recomposé une fois au
 * prix le plus bas ; le total ne peut que baisser.
 */
export function useCartFormatGroups(
  items: CartItem[],
  { enabled = true, onlyKnownFormats = false, normalize = false }: { enabled?: boolean; onlyKnownFormats?: boolean; normalize?: boolean } = {},
): CartFormatGroupsState {
  const parentIds = useMemo(() => Array.from(new Set(items
    .filter((item) => !onlyKnownFormats || item.product.format_parent_id || item.product.format_label)
    .map((item) => item.product.format_parent_id ?? item.product.id)
    .filter((id): id is string => Boolean(id)))).sort().slice(0, 50).join(','), [items, onlyKnownFormats]);
  const [fresh, setFresh] = useState<{ key: string; products: ProductFormatsResponse['products'] } | null>(null);
  const normalized = useRef(new Set<string>());
  const [attempt, setAttempt] = useState(0);
  const [gaveUp, setGaveUp] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    if (!enabled || !parentIds) return;
    if (fresh?.key === parentIds || gaveUp === parentIds) return;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    // Échec ou réponse vide alors qu'un format est au panier : nouvel essai (3 au plus),
    // puis lignes séparées comme avant (jamais bloquées indéfiniment).
    const failed = () => {
      if (controller.signal.aborted) return;
      if (attempt + 1 < MAX_ATTEMPTS) retry = setTimeout(() => setAttempt((value) => value + 1), RETRY_DELAY_MS);
      else setGaveUp(parentIds);
    };
    fetch(`/api/products/formats?ids=${encodeURIComponent(parentIds)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async (res) => (res.ok ? res.json() as Promise<ProductFormatsResponse> : null))
      .then((data) => {
        if (controller.signal.aborted) return;
        if (!data || ((data.products ?? []).length === 0 && itemsRef.current.some((item) => item.product.format_parent_id))) {
          failed();
          return;
        }
        setFresh({ key: parentIds, products: data.products ?? [] });
      })
      .catch(failed);
    return () => { controller.abort(); if (retry) clearTimeout(retry); };
  }, [enabled, parentIds, fresh?.key, attempt, gaveUp]);

  const groups = useMemo(() => {
    const map = new Map<string, CartFormatGroup>();
    if (!fresh || fresh.key !== parentIds) return map;
    for (const parent of fresh.products) {
      const options = buildSaleFormatOptions(parent);
      if (options.length === 0) continue;
      const ids = options.map((option) => option.id);
      if (!items.some((item) => ids.includes(item.product.id))) continue;
      map.set(parent.id, { parent: parent as CartFormatGroup['parent'], options, ids });
    }
    return map;
  }, [fresh, parentIds, items]);

  useEffect(() => {
    if (!normalize) return;
    for (const group of groups.values()) {
      if (normalized.current.has(group.parent.id)) continue;
      normalized.current.add(group.parent.id);
      const units = group.options.reduce((sum, option) => sum + (items.find((item) => item.product.id === option.id)?.quantity ?? 0) * option.units, 0);
      const current = group.options.reduce((sum, option) => sum + (items.find((item) => item.product.id === option.id)?.quantity ?? 0) * option.price, 0);
      const best = planFormatBundle(units, group.options);
      if (best && best.total < current - 0.004) setFormatUnits(group.parent, group.options, units);
    }
  }, [groups, items, normalize]);

  const pending = Boolean(enabled && parentIds && fresh?.key !== parentIds && gaveUp !== parentIds
    && items.some(isKnownFormatLine));
  return { groups, pending };
}
