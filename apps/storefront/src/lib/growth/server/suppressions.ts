import 'server-only';
import { growthDb } from './repository';
import type { GrowthProspectRow } from '../types';

/**
 * Keeps the suppression list in step with « do not contact »: every strong
 * identity key of the shop (domain, social handle, phone, VAT) is suppressed,
 * so the CLI never files it again under another name. Turning it off removes
 * only the keys this shop added.
 */
export async function syncSuppressions(prospect: Pick<GrowthProspectRow, 'id' | 'identity_keys'>, doNotContact: boolean, reason: string | null): Promise<void> {
  const db = growthDb();
  if (!doNotContact) {
    const res = await db.from('growth_suppressions').delete().eq('prospect_id', prospect.id);
    if (res.error) throw new Error('suppression_failed');
    return;
  }
  const keys = (prospect.identity_keys ?? []).filter((k) => /^(dom|fb|ig|tel|vat):/.test(k));
  if (!keys.length) return;
  const res = await db.from('growth_suppressions').upsert(
    keys.map((identity_key) => ({ identity_key, prospect_id: prospect.id, reason: (reason ?? 'Ne plus contacter').slice(0, 500) })),
    { onConflict: 'identity_key', ignoreDuplicates: true },
  );
  if (res.error) throw new Error('suppression_failed');
}
