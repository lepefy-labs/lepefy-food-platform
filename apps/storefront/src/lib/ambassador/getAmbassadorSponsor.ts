import { createServiceClient } from '@/lib/supabase/server';

/**
 * Ritorna l'id del sponsor (referred_by_id) SOLO se quel customer è
 * attualmente un ambassador — null in ogni altro caso (nessuno sponsor,
 * sponsor non promosso, sponsor demosso da admin). Riusata sia dal checkout
 * (decisione sconto) sia dal punto d'ingresso alla consegna (decisione
 * commissione + esclusione dal ledger punti).
 */
export async function getAmbassadorSponsor(tenantId: string, customerId: string): Promise<string | null> {
  const supabase = createServiceClient();

  const { data: buyer } = await supabase
    .from('customers')
    .select('referred_by_id')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const sponsorId = (buyer?.referred_by_id as string | null) ?? null;
  if (!sponsorId) return null;

  const { data: sponsor } = await supabase
    .from('customers')
    .select('is_ambassador')
    .eq('id', sponsorId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  return sponsor?.is_ambassador ? sponsorId : null;
}
