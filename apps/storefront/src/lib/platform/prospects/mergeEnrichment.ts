import { mergeEvidence } from './assessment';
import type { Prospect } from './types';
const CONTACTS=['website_url','phone','public_email','instagram_url','facebook_url','tiktok_url','whatsapp_url'] as const;
const SALES=['status','notes','last_contact_at','next_action_at','do_not_contact','suppression_reason','suppressed_at','lost_reason'] as const;
export function mergeEnrichment(p:Prospect,incoming:Partial<Prospect>):Partial<Prospect> {
  const patch={...incoming},failed=Boolean(incoming.crawl_status && incoming.crawl_status!=='completed');
  for (const key of SALES) delete patch[key];
  // Existing public/manual contacts are authoritative. No provider overwrite.
  for (const key of CONTACTS) if (p[key]) delete patch[key];
  if (failed) {
    for (const key of Object.keys(patch) as (keyof Prospect)[]) {
      if (patch[key]==null && p[key]!=null) delete patch[key];
      if (key.startsWith('has_') && p[key]===true) delete patch[key];
    }
    if (p.website_checked_at) {
      delete patch.website_checked_at;delete patch.crawl_status;delete patch.crawl_http_status;
      delete patch.crawl_error;delete patch.website_title;delete patch.website_description;
    }
  }
  if (incoming.technologies) patch.technologies=[...new Set([...(p.technologies ?? []),...incoming.technologies])];
  if (incoming.evidence) patch.evidence=mergeEvidence(p.evidence,incoming.evidence);
  if (p.osm_metadata?.matched && incoming.osm_metadata && !incoming.osm_metadata.matched) delete patch.osm_metadata;
  return patch;
}
