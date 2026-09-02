// NAF rév. 2 (2008): review this isolated mapping for the 2027 NAF transition.
// These codes identify activities, never ethnicity, halal certification or independence.
export const FOOD_CODES: Record<string, string> = {
  '47.11B': 'Alimentation générale', '47.11C': 'Supérettes',
  '47.21Z': 'Fruits et légumes', '47.22Z': 'Boucheries',
  '47.23Z': 'Poissonneries', '47.24Z': 'Pain et pâtisserie',
  '47.29Z': 'Commerces alimentaires spécialisés', '56.21Z': 'Traiteurs',
};
export const REGIONS: Record<string, string> = {
  '11':'Île-de-France','24':'Centre-Val de Loire','27':'Bourgogne-Franche-Comté','28':'Normandie',
  '32':'Hauts-de-France','44':'Grand Est','52':'Pays de la Loire','53':'Bretagne',
  '75':'Nouvelle-Aquitaine','76':'Occitanie','84':'Auvergne-Rhône-Alpes','93':'Provence-Alpes-Côte d’Azur',
  '94':'Corse','01':'Guadeloupe','02':'Martinique','03':'Guyane','04':'La Réunion','06':'Mayotte',
};
export const CONFIG = {
  userAgent: 'LepefyProspects/1.0 (+https://lepefy.com; public business research)',
  websiteDays: 14, osmDays: 30, sireneDays: 90, retryMinutes: 60,
  requestTimeoutMs: 5000, maxBytes: 1_000_000, maxRedirects: 3, maxPages: 3,
  discoveryBatch: 20, maxDiscovery: 500, maxDiscoveryPages: 100, enrichmentBatch: 10, qualifiedScore: 65,
  pageSize: 25, weights: { food:20, website:5, instagram:5, facebook:3, whatsapp:7,
    noEcommerce:20, noOrdering:15, catering:10, events:10, delivery:5, multiple:10 },
  levels: { medium:40, high:65, priority:80 },
};
export const STATUS_LABELS: Record<string, string> = {
  discovered:'Découvert', enriched:'Enrichi', qualified:'Qualifié', contacted:'Contacté', replied:'Réponse',
  demo:'Démo', pilot:'Pilote', won:'Gagné', lost:'Perdu', ignored:'Ignoré',
  pending:'En attente', running:'En cours', completed:'Terminé', partial:'Partiel', blocked:'Bloqué', failed:'Échec',
  low:'Faible', medium:'Moyen', high:'Élevé', priority:'Prioritaire',
};
