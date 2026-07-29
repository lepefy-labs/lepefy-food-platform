import { createServiceClient } from '@/lib/supabase/server';
import type { ReferralFraudSignalType } from '@lepefy/types';

/**
 * Confronta un nuovo customer con il suo sponsor su un sottoinsieme di
 * segnali (IP/device a signup, telefono/indirizzo al primo ordine — vedi
 * chiamanti) e registra ogni corrispondenza in referral_fraud_signals per
 * visibilità admin. Non decide da sola un blocco: a signup una corrispondenza
 * rifiuta il solo link referral (vedi registerWithReferral); all'ordine è
 * solo accumulo di segnale, il gate automatico resta il conteggio conversioni
 * di processOrderPointsOnDelivery.
 */
export async function checkFraudSignals(params: {
  tenantId: string;
  newCustomerId: string;
  sponsorId: string;
  signals: Partial<Record<ReferralFraudSignalType, string | null | undefined>>;
  sponsorSignals: Partial<Record<ReferralFraudSignalType, string | null | undefined>>;
}): Promise<{ detected: boolean; types: ReferralFraudSignalType[] }> {
  const { tenantId, newCustomerId, sponsorId, signals, sponsorSignals } = params;
  const supabase = createServiceClient();

  const matchedTypes: ReferralFraudSignalType[] = [];

  for (const type of Object.keys(signals) as ReferralFraudSignalType[]) {
    const value = signals[type];
    const sponsorValue = sponsorSignals[type];
    if (value && sponsorValue && value === sponsorValue) {
      matchedTypes.push(type);
    }
  }

  if (matchedTypes.length > 0) {
    await supabase.from('referral_fraud_signals').insert(
      matchedTypes.map((signal_type) => ({
        tenant_id: tenantId,
        customer_id: newCustomerId,
        signal_type,
        matched_customer_id: sponsorId,
      })),
    );
  }

  return { detected: matchedTypes.length > 0, types: matchedTypes };
}
