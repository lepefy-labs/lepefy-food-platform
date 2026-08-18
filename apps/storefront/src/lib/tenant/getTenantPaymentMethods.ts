import { createPublicClient } from '@/lib/supabase/public';
import type { TenantPaymentMethod, PaymentModule } from '@lepefy/types';

// Même défaut que la colonne `enabled_modules` (migration 066) — tant que
// cette migration n'a pas encore été appliquée sur l'environnement (fenêtre
// entre le déploiement du code et `supabase db push`), `select('*')` ne
// retourne pas cette colonne du tout et `row.enabled_modules` vaut
// `undefined`. Normaliser ici évite un crash sur `.includes(...)` chez tous
// les appelants, avec un comportement identique à après migration (tous les
// modules) — pas une divergence de logique, juste un filet pour cette
// fenêtre de rollout.
const DEFAULT_ENABLED_MODULES: PaymentModule[] = ['shop', 'card', 'event', 'rental'];

export async function getTenantPaymentMethods(tenantId: string): Promise<TenantPaymentMethod[]> {
  const supabase = createPublicClient();

  const { data, error } = await supabase
    .from('tenant_payment_methods')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('[getTenantPaymentMethods] errore:', error.message);
    return [];
  }

  return ((data ?? []) as TenantPaymentMethod[]).map((m) => ({
    ...m,
    enabled_modules: m.enabled_modules ?? DEFAULT_ENABLED_MODULES,
  }));
}
