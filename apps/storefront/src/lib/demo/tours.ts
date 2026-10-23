/**
 * Les cinq parcours de la démo (docs/DEMO_EXPERIENCE.md §4). Données seulement :
 * chaque étape pointe vers un vrai écran et l'explique en une phrase. Le
 * panneau DemoTour les affiche sans jamais masquer l'écran.
 *
 * Contrat avec les scénarios (scripts/demo/scenarios) : les services portent les
 * slugs DEMO_SERVICE_SLUGS ; le reste ne dépend d'aucune donnée précise.
 * `gap` : limite actuelle du produit, dite telle quelle au visiteur.
 */

export type DemoPathKey = 'shop' | 'events' | 'orders' | 'management' | 'nala';

export interface DemoTourStep {
  /** Page de l'étape ; null = rester sur la page courante. */
  href: string | null;
  title: string;
  body: string;
  gap?: string;
}

export interface DemoPath {
  key: DemoPathKey;
  title: string;
  summary: string;
  minutes: number;
  /** true = ouvre l'administration en visite lecture seule (compte éphémère). */
  admin: boolean;
  steps: DemoTourStep[];
}

export const DEMO_SERVICE_SLUGS = { catering: 'traiteur', rental: 'location-materiel' } as const;

export const DEMO_PATHS: readonly DemoPath[] = [
  {
    key: 'shop', title: 'Découvrir la boutique', summary: 'Commander des plats à emporter ou à livrer', minutes: 3, admin: false,
    steps: [
      { href: '/', title: 'Le catalogue', body: 'Les clients trouvent les plats par catégorie ou par la recherche. Les promotions et les nouveautés sont mises en avant en haut.' },
      { href: '/?promo=1', title: 'Promotions', body: 'Le commerçant programme une promotion : le prix barré et le badge apparaissent seuls, puis disparaissent à la date prévue.' },
      { href: null, title: 'Une fiche produit', body: 'Ouvrez un plat : photos, description, quantité minimale éventuelle et ajout au panier.' },
      { href: '/cart', title: 'Le panier', body: 'Le client voit son total, des suggestions utiles et peut continuer ses achats sans perdre son panier.' },
      { href: '/checkout', title: 'Retrait ou livraison', body: 'Le client choisit le retrait en boutique ou la livraison. Le paiement utilise la carte de test 4242 4242 4242 4242 : aucun débit réel.', gap: 'Pas encore de créneau horaire de retrait par commande ni de livraison locale par zone.' },
    ],
  },
  {
    key: 'events', title: 'Découvrir les événements', summary: 'Traiteur, devis, location de matériel, soirées', minutes: 3, admin: false,
    steps: [
      { href: '/evenementiel', title: 'L’espace événements', body: 'Une vitrine dédiée aux soirées, au service traiteur et à la location de matériel, avec sa propre adresse.' },
      { href: `/evenementiel/services/${DEMO_SERVICE_SLUGS.catering}`, title: 'Demande de devis traiteur', body: 'Le client décrit son projet (date, nombre d’invités, envies). La demande arrive dans l’administration.', gap: 'Le devis chiffré et l’acompte se préparent aujourd’hui hors plateforme.' },
      { href: `/evenementiel/services/${DEMO_SERVICE_SLUGS.rental}`, title: 'Location de matériel', body: 'Chaises, chauffe-plats, vaisselle : le client réserve et paie en ligne (paiement de test).' },
      { href: '/evenementiel', title: 'Soirées et billetterie', body: 'Ouvrez la prochaine soirée : les places sont vendues en ligne, la capacité est tenue à jour et un QR code est contrôlé à l’entrée.' },
    ],
  },
  {
    key: 'orders', title: 'Gérer les commandes', summary: 'Aujourd’hui, préparation, retraits', minutes: 4, admin: true,
    steps: [
      { href: '/admin', title: 'Aujourd’hui', body: 'Ce qui est à préparer, à remettre et à relancer aujourd’hui, en un écran.' },
      { href: '/admin/orders', title: 'Les commandes', body: 'Filtres par état, mode de réception et paiement. Chaque commande a sa fiche et ses documents à imprimer.' },
      { href: '/admin/evenementiel/devis', title: 'Les demandes de devis', body: 'Mariage, anniversaire, repas d’entreprise : chaque demande suit ses étapes jusqu’à l’acceptation.', gap: 'Pas encore de calendrier des prestations ni de devis chiffré.' },
      { href: '/admin/clients', title: 'Les clients', body: 'Historique d’achats, fidélité et coordonnées réunis sur une fiche.' },
    ],
  },
  {
    key: 'management', title: 'Découvrir la gestion commerciale', summary: 'Clients, achats, stock, trésorerie', minutes: 4, admin: true,
    steps: [
      { href: '/admin/gestion', title: 'Gestion du commerce', body: 'Fournisseurs, achats, stock et trésorerie au même endroit que les ventes.' },
      { href: '/admin/gestion/achats', title: 'Achats fournisseurs', body: 'Commandes, réceptions partielles et paiements : le reste à payer se calcule seul.' },
      { href: '/admin/gestion/stocks', title: 'Stock', body: 'Chaque réception et chaque vente est un mouvement : le stock de la boutique reste juste.' },
      { href: '/admin/gestion/tresorerie', title: 'Trésorerie', body: 'Les paiements aux fournisseurs, vérifiés ou à vérifier.' },
      { href: '/admin/catalogue', title: 'Catalogue', body: 'Prix, promotions, nouveautés et règles de vente par produit.' },
    ],
  },
  {
    key: 'nala', title: 'Découvrir Nala', summary: 'L’assistante qui conseille vos clients', minutes: 2, admin: false,
    steps: [
      { href: '/', title: 'Parlez à Nala', body: 'Ouvrez la bulle de discussion et demandez par exemple « Qu’est-ce que vous me conseillez pour 6 personnes ? ». Nala répond avec les vrais produits et peut les ajouter au panier.' },
      { href: null, title: 'Ce que Nala ne fait jamais', body: 'Les prix, le stock, la livraison et les paiements viennent toujours de la boutique, jamais de l’IA.' },
    ],
  },
];

export function demoPath(key: string): DemoPath | undefined {
  return DEMO_PATHS.find((path) => path.key === key);
}

/** État de la visite guidée, gardé dans sessionStorage (onglet courant uniquement). */
export const DEMO_TOUR_STORAGE_KEY = 'lepefy-demo-tour';

export interface DemoTourState { path: DemoPathKey; step: number; minimized?: boolean }

export function parseTourState(raw: string | null): DemoTourState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DemoTourState>;
    const path = typeof value.path === 'string' ? demoPath(value.path) : undefined;
    if (!path || typeof value.step !== 'number' || !Number.isInteger(value.step)) return null;
    if (value.step < 0 || value.step >= path.steps.length) return null;
    return { path: path.key, step: value.step, minimized: value.minimized === true };
  } catch {
    return null;
  }
}
