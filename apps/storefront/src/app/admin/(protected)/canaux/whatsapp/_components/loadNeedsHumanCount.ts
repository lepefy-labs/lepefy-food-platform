import { createServiceClient } from '@/lib/supabase/server';

/** Conversations en attente d'un opérateur (badge des onglets). */
export async function loadNeedsHumanCount(tenantId: string): Promise<number> {
  const { count } = await createServiceClient().from('whatsapp_conversations')
    .select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'waiting_human');
  return count ?? 0;
}
