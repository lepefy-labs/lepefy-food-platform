/**
 * Registry of the storefront image slots an approved Studio image can be used
 * on (client-safe metadata; the server implementation of each entry lives in
 * `server/destinations.ts`, checked by a parity unit test).
 *
 * Adding a slot = one entry here + one implementation: label, permission of
 * the module that owns the slot, visible format, minimum width, admin page.
 * Excluded on purpose: logo, app icon, label background (identity / print
 * assets, not generated content).
 */

export const STUDIO_DESTINATION_KEYS = [
  'product', 'hero_slide', 'category', 'story', 'card_hero',
  'event_banner', 'service_cover', 'rental_item', 'event_gallery',
] as const;
export type StudioDestinationKey = (typeof STUDIO_DESTINATION_KEYS)[number];

export interface StudioDestinationDefinition {
  key: StudioDestinationKey;
  /** French label of the slot. */
  label: string;
  group: 'Boutique' | 'Contenu public' | 'Événementiel';
  /** Capability needed to publish there (the one of the module's own editor). */
  permission: string;
  /** Visible format on the storefront; null = the image keeps its proportions. */
  aspect: string | null;
  aspectLabel: string;
  /** Smallest acceptable width of the published copy (px). */
  minWidth: number;
  /** Longest edge of the published copy (px). */
  maxEdge: number;
  /** `add`: the image joins a gallery; `replace`: it takes the slot's place. */
  mode: 'add' | 'replace';
  /** The slot belongs to the shop itself (no target to pick). */
  singleton: boolean;
  /** Needs the events module of the tenant. */
  events?: boolean;
  /** An atmosphere image (created without photo) must be confirmed explicitly here. */
  confirmAmbiance: boolean;
  /** Word used in the target picker (« Choisir un produit »). */
  targetNoun: string;
  hint: string;
}

export const STUDIO_DESTINATIONS: readonly StudioDestinationDefinition[] = [
  {
    key: 'product', label: 'Produit', group: 'Boutique', permission: 'catalog.manage',
    aspect: '1:1', aspectLabel: 'Carré 1:1', minWidth: 600, maxEdge: 1600, mode: 'add', singleton: false,
    confirmAmbiance: true, targetNoun: 'produit',
    hint: 'Ajoutée à la galerie du produit (8 images au maximum).',
  },
  {
    key: 'hero_slide', label: 'Slide d’accueil', group: 'Boutique', permission: 'catalog.manage',
    aspect: '1:1', aspectLabel: 'Carré 1:1', minWidth: 600, maxEdge: 1600, mode: 'replace', singleton: false,
    confirmAmbiance: false, targetNoun: 'slide',
    hint: 'Remplace l’image de la slide.',
  },
  {
    key: 'category', label: 'Image de catégorie', group: 'Boutique', permission: 'catalog.manage',
    aspect: '4:5', aspectLabel: 'Portrait 4:5', minWidth: 400, maxEdge: 1200, mode: 'replace', singleton: false,
    confirmAmbiance: false, targetNoun: 'catégorie',
    hint: 'Remplace la vignette de la catégorie dans le catalogue.',
  },
  {
    key: 'story', label: 'Photo « Notre origine »', group: 'Contenu public', permission: 'tenant_settings.manage',
    aspect: '4:3', aspectLabel: 'Paysage 4:3', minWidth: 800, maxEdge: 1600, mode: 'replace', singleton: true,
    confirmAmbiance: false, targetNoun: 'page',
    hint: 'Remplace la photo de la section « Notre origine » de l’accueil.',
  },
  {
    key: 'card_hero', label: 'Photo de la carte (/card)', group: 'Contenu public', permission: 'tenant_settings.manage',
    aspect: '4:3', aspectLabel: 'Paysage 4:3', minWidth: 480, maxEdge: 1200, mode: 'replace', singleton: true,
    confirmAmbiance: false, targetNoun: 'carte',
    hint: 'Remplace la photo en tête de la carte de la boutique.',
  },
  {
    key: 'event_banner', label: 'Bannière d’événement', group: 'Événementiel', permission: 'events.manage',
    aspect: '16:9', aspectLabel: 'Paysage 16:9', minWidth: 960, maxEdge: 1600, mode: 'replace', singleton: false, events: true,
    confirmAmbiance: false, targetNoun: 'événement',
    hint: 'Remplace la bannière de l’événement.',
  },
  {
    key: 'service_cover', label: 'Photo d’un service', group: 'Événementiel', permission: 'event_content.manage',
    aspect: '4:3', aspectLabel: 'Paysage 4:3', minWidth: 800, maxEdge: 1600, mode: 'replace', singleton: false, events: true,
    confirmAmbiance: false, targetNoun: 'service',
    hint: 'Remplace la photo du service (traiteur, location…).',
  },
  {
    key: 'rental_item', label: 'Matériel en location', group: 'Événementiel', permission: 'event_content.manage',
    aspect: '1:1', aspectLabel: 'Carré 1:1', minWidth: 600, maxEdge: 1600, mode: 'replace', singleton: false, events: true,
    confirmAmbiance: true, targetNoun: 'article',
    hint: 'Remplace la photo de l’article de location.',
  },
  {
    key: 'event_gallery', label: 'Galerie Événementiel', group: 'Événementiel', permission: 'event_content.manage',
    aspect: null, aspectLabel: 'Format d’origine', minWidth: 800, maxEdge: 1600, mode: 'add', singleton: true, events: true,
    confirmAmbiance: false, targetNoun: 'galerie',
    hint: 'Ajoutée à la galerie photo de l’Événementiel.',
  },
];

export function studioDestination(key: string): StudioDestinationDefinition | null {
  return STUDIO_DESTINATIONS.find((destination) => destination.key === key) ?? null;
}

/** Admin page where the slot is managed (link from « Utilisations »). */
export function destinationManageHref(key: StudioDestinationKey, targetId: string): string {
  switch (key) {
    case 'product': return '/admin/catalogue/' + targetId;
    case 'hero_slide': return '/admin/accueil-slides';
    case 'category': return '/admin/catalogue/categories';
    case 'story':
    case 'card_hero': return '/admin/contenu';
    case 'event_banner': return '/admin/evenementiel/evenements/' + targetId;
    case 'service_cover': return '/admin/evenementiel/services/' + targetId;
    case 'rental_item': return '/admin/evenementiel/services';
    case 'event_gallery': return '/admin/evenementiel/galerie';
  }
}

/** Target id of a singleton slot (the shop itself). */
export const SINGLETON_TARGET = 'shop';
