import { createServiceClient } from '@/lib/supabase/server';
import { getLatestLegalDocument } from './getLatestLegalDocument';
import { insertConsentRows } from './insertConsentRows';

// Enregistre les deux lignes de consentement au signup (Ciclo 4) : 'terms'
// (toujours accordé — condition du submit côté client, revérifiée par
// l'appelant) et 'marketing' (toujours écrit, même à false, pour distinguer
// "jamais demandé" de "refusé"). Best-effort : ne doit jamais faire
// échouer un signup déjà réussi — l'appelant catch et logue.
export async function registerSignupConsent(params: {
  tenantId: string;
  customerId: string;
  marketingOptIn: boolean;
}): Promise<void> {
  const { tenantId, customerId, marketingOptIn } = params;

  const terms = await getLatestLegalDocument(tenantId, 'terms');

  await insertConsentRows(createServiceClient(), [
    {
      tenant_id: tenantId,
      user_id: customerId,
      consent_type: 'terms',
      granted: true,
      doc_version: terms?.version ?? null,
      source: 'signup',
    },
    {
      tenant_id: tenantId,
      user_id: customerId,
      consent_type: 'marketing',
      granted: marketingOptIn,
      doc_version: null,
      source: 'signup',
    },
  ]);
}
