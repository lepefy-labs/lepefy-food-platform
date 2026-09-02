export const STATUSES = ['discovered','enriched','qualified','contacted','replied','demo','pilot','won','lost','ignored'] as const;
export type SalesStatus = typeof STATUSES[number];
export type CrawlStatus = 'pending' | 'running' | 'completed' | 'partial' | 'blocked' | 'failed';
export type Qualification = 'low' | 'medium' | 'high' | 'priority';
export const SIGNALS = ['has_website','has_ecommerce','has_online_ordering','has_whatsapp_ordering',
  'has_delivery','has_events','has_catering','has_loyalty','has_instagram','has_facebook',
  'has_tiktok','has_multiple_locations'] as const;
export type Signal = typeof SIGNALS[number];
export type Evidence = { signal: string; source: string; value: string };
export type Identity = {
  business_name: string; legal_name?: string | null; siren?: string | null; siret?: string | null;
  naf_ape_code?: string | null; business_category?: string | null; country: string;
  region?: string | null; department?: string | null; city?: string | null;
  postal_code?: string | null; address?: string | null; latitude?: number | null; longitude?: number | null;
  website_url?: string | null; phone?: string | null; public_email?: string | null;
  instagram_url?: string | null; facebook_url?: string | null; tiktok_url?: string | null; whatsapp_url?: string | null;
  has_multiple_locations?: boolean | null;
  discovery_source: string; source_external_id?: string | null;
};
export type Prospect = Identity & Partial<Record<Signal, boolean | null>> & {
  id: string; domain: string | null; identity_key: string | null;
  status: SalesStatus; fit_score: number; qualification_level: Qualification;
  qualification_reason: string | null; detected_problems: string[]; recommended_modules: string[];
  score_breakdown: { rule: string; points: number }[]; evidence: Evidence[]; technologies: string[];
  website_title: string | null; website_description: string | null;
  crawl_status: CrawlStatus; crawl_http_status: number | null; crawl_error: string | null;
  discovered_at: string; last_enriched_at: string | null; website_checked_at: string | null;
  osm_checked_at: string | null; osm_metadata: Record<string, unknown>;
  last_contact_at: string | null; next_action_at: string | null; notes: string | null; lost_reason: string | null;
  do_not_contact: boolean; suppression_reason: string | null; suppressed_at: string | null;
  created_at: string; updated_at: string;
};
export type DiscoveryFilters = {
  country: 'FR'; region: string; department: string; city: string; codes: string[];
  activeOnly: boolean; limit: number;
};
export type DiscoveryPage = { candidates: Identity[]; nextPage: number | null };
export interface DiscoveryProvider { discover(filters: DiscoveryFilters, page: number): Promise<DiscoveryPage> }
export type Run = {
  id: string; kind: 'discovery' | 'enrichment'; status: 'pending' | 'running' | 'completed' | 'partial' | 'blocked' | 'failed';
  config: Record<string, unknown>; cursor: { page?: number; pending?: Identity[]; exhausted?: boolean; index?: number };
  processed: number; inserted: number; duplicates: number; succeeded: number; blocked: number; failed: number;
  error: string | null; next_attempt_at: string | null; created_at: string; updated_at: string;
};
