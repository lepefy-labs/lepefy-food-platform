import { CONFIG, FOOD_CODES } from './config';
import type { Prospect, Qualification } from './types';
export function qualificationLevel(score: number, levels = CONFIG.levels): Qualification {
  return score >= levels.priority ? 'priority' : score >= levels.high ? 'high' : score >= levels.medium ? 'medium' : 'low';
}
export function scoreProspect(p: Partial<Prospect>, weights = CONFIG.weights) {
  const score_breakdown: { rule: string; points: number }[] = [];
  const add = (condition: boolean, rule: string, points: number) => { if (condition) score_breakdown.push({ rule, points }); };
  add(Boolean(p.naf_ape_code && FOOD_CODES[p.naf_ape_code]), 'Activité alimentaire cible', weights.food);
  add(p.has_website === true, 'Site public', weights.website);
  add(p.has_instagram === true, 'Instagram professionnel lié', weights.instagram);
  add(p.has_facebook === true, 'Facebook professionnel lié', weights.facebook);
  add(Boolean(p.whatsapp_url), 'Canal WhatsApp public', weights.whatsapp);
  // Null means unknown. A blocked/incomplete crawl never earns absence points.
  add(p.has_ecommerce === false, 'Ecommerce non détecté sur les pages inspectées', weights.noEcommerce);
  add(p.has_online_ordering === false, 'Commande en ligne non détectée sur les pages inspectées', weights.noOrdering);
  add(p.has_catering === true, 'Traiteur', weights.catering);
  add(p.has_events === true, 'Événements', weights.events);
  add(p.has_delivery === true, 'Livraison', weights.delivery);
  add(p.has_multiple_locations === true, 'Plusieurs établissements actifs', weights.multiple);
  const fit_score = Math.max(0, Math.min(100, score_breakdown.reduce((sum, r) => sum + r.points, 0)));
  const detected_problems: string[] = [];
  const modules = new Set<string>();
  if (p.has_ecommerce === false) { detected_problems.push('Ecommerce non détecté sur les pages inspectées.'); modules.add('Boutique / Catalogue'); }
  if (p.has_online_ordering === false) { detected_problems.push('Commande en ligne non détectée sur les pages inspectées.'); modules.add('Orders'); }
  if (p.whatsapp_url) { detected_problems.push('WhatsApp proposé comme canal de contact public.'); modules.add('Digital Card'); }
  if (p.has_events || p.has_catering) modules.add('Événementiel');
  if (p.has_catering) modules.add('Orders');
  if (p.has_loyalty === false) modules.add('Loyalty');
  if (p.has_delivery) modules.add('Shipping');
  if (p.has_ecommerce === false && (p.has_instagram || p.has_facebook)) {
    detected_problems.push('Présence sociale identifiée ; ecommerce non détecté sur le site inspecté.');
  }
  return { fit_score, qualification_level: qualificationLevel(fit_score), score_breakdown,
    detected_problems, recommended_modules: [...modules],
    qualification_reason: score_breakdown.length ? score_breakdown.map(r => r.rule + ' (+' + r.points + ')').join(' · ') : 'Preuves insuffisantes.',
  };
}
