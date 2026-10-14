/**
 * Tick des promotions programmées et des nouveautés (migration 156), appelé
 * par n8n via POST /api/internal/catalog-schedule. Toutes les transitions
 * sont faites en base par `apply_product_promotion_schedule` (tous tenants,
 * idempotent) ; ici on ne fait que résumer et dire quel tenant invalider.
 */

export interface CatalogScheduleChange {
  out_tenant_id: string;
  out_product_id: string;
  out_change: 'promo_started' | 'promo_ended' | 'promo_expired' | 'novelty_ended' | string;
}

export interface CatalogScheduleSummary {
  started: number;
  ended: number;
  expired: number;
  noveltiesEnded: number;
  tenantIds: string[];
}

export function summarizeCatalogSchedule(rows: readonly CatalogScheduleChange[]): CatalogScheduleSummary {
  const count = (change: string) => rows.filter((row) => row.out_change === change).length;
  return {
    started: count('promo_started'),
    ended: count('promo_ended'),
    expired: count('promo_expired'),
    noveltiesEnded: count('novelty_ended'),
    tenantIds: [...new Set(rows.map((row) => row.out_tenant_id))].sort(),
  };
}
