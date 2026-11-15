import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { ingestGrowthProspects, type GrowthIngestResult } from '../ingestProtocol';

export { GROWTH_INGEST_LIMITS, GrowthIngestError, growthIngestAuthorized } from '../ingestProtocol';

export function handleGrowthIngest(body: unknown): Promise<GrowthIngestResult> {
  return ingestGrowthProspects(body, createServiceClient());
}
