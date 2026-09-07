import { CONFIG } from './config';
import type { Evidence, Prospect } from './types';
export type CollectionDetails = { checked_at?:string; status?:string; retry_at?:string; website_url?:string; source?:string; place_id?:string; confidence?:number; reasons?:string[]; http_status?:number | null; error?:string | null };
export function collection(p:Partial<Prospect>,provider:string):CollectionDetails {
  return (p.evidence?.find(e=>e.signal==='collection:'+provider)?.details ?? {}) as CollectionDetails;
}
export function collectionEvidence(provider:string,details:CollectionDetails):Evidence {
  return {signal:'collection:'+provider,source:provider,value:details.status ?? 'checked',details};
}
export function mergeEvidence(previous:Evidence[]=[],incoming:Evidence[]=[]):Evidence[] {
  const map=new Map(previous.map(e=>[e.signal+'|'+e.source+'|'+(e.signal.startsWith('collection:') ? '' : e.value),e]));
  for (const e of incoming) map.set(e.signal+'|'+e.source+'|'+(e.signal.startsWith('collection:') ? '' : e.value),e);
  return [...map.values()];
}
export function fresh(date:string | null | undefined,days:number,now=Date.now()) {
  const time=Date.parse(date ?? ''); return Number.isFinite(time) && time<=now && time>now-days*86400000;
}
export function hasObservation(p:Partial<Prospect>,signal:string) { return Boolean(p.evidence?.some(e=>e.signal===signal)); }
export function assessProspect(p:Partial<Prospect>,now=Date.now()) {
  const website=collection(p,'website');
  const completed=Boolean(p.website_url && p.website_checked_at && p.crawl_status==='completed'
    && (!website.website_url || website.website_url===p.website_url));
  const current=completed && fresh(p.website_checked_at,CONFIG.websiteDays,now);
  const checks=[
    ['Identité',Boolean(p.business_name && (p.siret || p.legal_name)),10],
    ['Adresse',Boolean(p.address && p.postal_code && p.city),10],
    ['Coordonnées',p.latitude!=null && p.longitude!=null,5],
    ['Site résolu',Boolean(p.website_url),10],
    ['Téléphone',Boolean(p.phone),5],['Email professionnel',Boolean(p.public_email),5],
    ['Présence sociale vérifiée',completed || Boolean(p.instagram_url || p.facebook_url || p.tiktok_url || p.whatsapp_url),5],
    ...(['has_ecommerce','has_online_ordering','has_delivery','has_events','has_catering','has_loyalty','has_whatsapp_ordering'] as const)
      .map(s=>[s,(completed && p[s]!=null) || (p[s]===true && hasObservation(p,s)),5]),
    ['Analyse complète',completed,15],
  ] as [string,boolean,number][];
  const data_completeness=checks.reduce((n,[,known,weight])=>n+(known ? weight : 0),0);
  const score_state=current && data_completeness>=65 ? 'enriched' : 'provisional';
  const ordering_maturity=hasObservation(p,'ordering_integrated') ? 'integrated'
    : hasObservation(p,'ordering_transactional') ? 'transactional'
    : hasObservation(p,'ordering_request_based') || p.has_whatsapp_ordering===true ? 'request_based'
    : completed && p.has_online_ordering===false ? 'none' : 'unknown';
  const fragmented_digital_stack=hasObservation(p,'external_ordering')
    || (ordering_maturity==='request_based' && Boolean(p.website_url) && Boolean(p.whatsapp_url || hasObservation(p,'hosted_presence')));
  const digital_maturity=fragmented_digital_stack ? 'fragmented'
    : ordering_maturity==='integrated' && p.has_loyalty===true ? 'advanced'
    : ['transactional','integrated'].includes(ordering_maturity) ? 'transactional'
    : p.website_url || p.instagram_url || p.facebook_url || p.whatsapp_url ? 'basic' : 'unknown';
  const latest=website.status;
  const enrichment_status=!p.last_enriched_at ? 'not_started'
    : latest==='blocked' || latest==='failed' ? (data_completeness>25 ? 'partial' : latest)
    : completed && !current ? 'stale' : score_state==='enriched' ? 'complete' : 'partial';
  return {data_completeness,score_state,digital_maturity,ordering_maturity,fragmented_digital_stack,enrichment_status,
    completeness_breakdown:checks.map(([label,known,points])=>({label,known,points}))};
}
export const QUALITY_LABELS:Record<string,string> = {
  provisional:'Provisoire',enriched:'Enrichi',not_started:'À enrichir',partial:'Partiel',complete:'Complet',
  blocked:'Bloqué',failed:'Échec',stale:'À actualiser',unknown:'Non vérifié',none:'Non détecté',basic:'Basique',
  fragmented:'Fragmenté',transactional:'Transactionnel',integrated:'Intégré',advanced:'Avancé',request_based:'Sur demande',
};
export const PROVIDER_LABELS:Record<string,string>={matched:'Correspondance fiable',ambiguous:'Correspondance ambiguë',
  not_found:'Aucune correspondance fiable',disabled:'Désactivé',cooldown:'Délai de reprise',quota_exhausted:'Quota mensuel atteint',
  quota_unavailable:'Quota indisponible',failed:'Échec',blocked:'Bloqué',partial:'Partiel',completed:'Terminé',
  website_unverified:'Site non confirmé par analyse directe',insufficient_identity:'Identité insuffisante'};
export const completenessLabel=(n:number)=>n<25 ? 'Très faibles' : n<50 ? 'Faibles' : n<75 ? 'Moyennes' : n<100 ? 'Bonnes' : 'Complètes';
