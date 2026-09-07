import { CONFIG, FOOD_CODES } from './config';
import { assessProspect, hasObservation } from './assessment';
import type { Prospect, Qualification } from './types';
export function qualificationLevel(score: number, levels = CONFIG.levels): Qualification {
  return score >= levels.priority ? 'priority' : score >= levels.high ? 'high' : score >= levels.medium ? 'medium' : 'low';
}
export function scoreProspect(p: Partial<Prospect>, weights = CONFIG.weights) {
  const assessment=assessProspect(p);
  const reliable=p.crawl_status==='completed' && Boolean(p.website_checked_at);
  const score_breakdown: { rule: string; points: number }[] = [];
  const add = (condition: boolean, rule: string, points: number) => { if (condition) score_breakdown.push({ rule, points }); };
  add(Boolean(p.naf_ape_code && FOOD_CODES[p.naf_ape_code]), 'Activité alimentaire cible', weights.food);
  add(p.has_website === true, 'Site public', weights.website);
  add(p.has_instagram === true, 'Instagram professionnel lié', weights.instagram);
  add(p.has_facebook === true, 'Facebook professionnel lié', weights.facebook);
  add(Boolean(p.whatsapp_url), 'Canal WhatsApp public', weights.whatsapp);
  // Null means unknown. A blocked/incomplete crawl never earns absence points.
  add(reliable && p.has_ecommerce === false, 'Ecommerce non détecté sur les pages inspectées', weights.noEcommerce);
  add(reliable && p.has_online_ordering === false, 'Commande en ligne non détectée sur les pages inspectées', weights.noOrdering);
  add(p.has_catering === true, 'Traiteur', weights.catering);
  add(p.has_events === true, 'Événements', weights.events);
  add(p.has_delivery === true, 'Livraison', weights.delivery);
  add(p.has_multiple_locations === true, 'Plusieurs établissements actifs', weights.multiple);
  add(assessment.ordering_maturity==='request_based', 'Commandes nécessitant une confirmation manuelle', weights.requestOrdering);
  add(assessment.fragmented_digital_stack, 'Parcours digital réparti entre plusieurs services', weights.fragmented);
  add(hasObservation(p,'hosted_presence'), 'Présence hébergée sur un service tiers', weights.hosted);
  add(p.has_whatsapp_ordering===true, 'Commande explicite par WhatsApp', weights.whatsappOrdering);
  const fit_score = Math.max(0, Math.min(100, score_breakdown.reduce((sum, r) => sum + r.points, 0)));
  const detected_problems: string[] = [];
  const modules = new Set<string>();
  if (reliable && p.has_ecommerce === false) { detected_problems.push('Ecommerce non détecté sur les pages inspectées.'); modules.add('Boutique / Catalogue'); }
  if (reliable && p.has_online_ordering === false) { detected_problems.push('Commande en ligne non détectée sur les pages inspectées.'); modules.add('Orders'); }
  if (p.whatsapp_url) { detected_problems.push('WhatsApp proposé comme canal de contact public.'); modules.add('Digital Card'); }
  if (p.has_events || p.has_catering) modules.add('Événementiel');
  if (p.has_catering) modules.add('Orders');
  if (reliable && p.has_loyalty === false) modules.add('Loyalty');
  if (p.has_delivery) modules.add('Shipping');
  if (reliable && p.has_ecommerce === false && (p.has_instagram || p.has_facebook)) {
    detected_problems.push('Présence sociale identifiée ; ecommerce non détecté sur le site inspecté.');
  }
  if (assessment.ordering_maturity==='request_based') { detected_problems.push('Prise de commande sur demande, à confirmer.'); modules.add('Orders'); }
  if (assessment.fragmented_digital_stack) { detected_problems.push('Parcours public fragmenté entre plusieurs services.'); modules.add('Digital Card'); modules.add('Orders'); }
  return { fit_score, qualification_level: qualificationLevel(fit_score), score_breakdown,
    detected_problems, recommended_modules: [...modules],
    qualification_reason: score_breakdown.length ? score_breakdown.map(r => r.rule + ' (+' + r.points + ')').join(' · ') : 'Preuves insuffisantes.',
  };
}
