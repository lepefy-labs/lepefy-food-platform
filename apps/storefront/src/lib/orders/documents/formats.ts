/**
 * Formats d'impression des documents de commande (liste de préparation, bon de
 * colis). Registre unique : aucun composant ne compare des chaînes 'a5'/'a4'
 * en dur. Ajouter un format (letter, a6, thermal_80…) = une entrée ici, puis
 * son layout dans les renderers et la valeur dans le CHECK de la migration 145.
 */
export const ORDER_DOCUMENT_FORMAT_IDS = ['a5', 'a4'] as const;
export type OrderDocumentFormat = typeof ORDER_DOCUMENT_FORMAT_IDS[number];

export interface OrderDocumentFormatSpec {
  id: OrderDocumentFormat;
  label: string;
  widthMm: number;
  heightMm: number;
  /** Valeur de `@page { size: … }`. */
  cssPageSize: string;
  description: string;
  recommended: boolean;
  /** Marges (mm) envoyées à Gotenberg ; le bas laisse la place au pied de page. */
  marginsMm: { top: number; right: number; bottom: number; left: number };
}

export const ORDER_DOCUMENT_FORMATS: Record<OrderDocumentFormat, OrderDocumentFormatSpec> = {
  a5: {
    id: 'a5',
    label: 'A5',
    widthMm: 148,
    heightMm: 210,
    cssPageSize: 'A5 portrait',
    description: 'Format compact pour la préparation quotidienne.',
    recommended: true,
    marginsMm: { top: 9, right: 9, bottom: 13, left: 9 },
  },
  a4: {
    id: 'a4',
    label: 'A4',
    widthMm: 210,
    heightMm: 297,
    cssPageSize: 'A4 portrait',
    description: 'Plus d’espace pour les commandes longues et les notes.',
    recommended: false,
    marginsMm: { top: 12, right: 14, bottom: 15, left: 14 },
  },
};

export const DEFAULT_ORDER_DOCUMENT_FORMAT: OrderDocumentFormat = 'a5';

export function isOrderDocumentFormat(value: unknown): value is OrderDocumentFormat {
  return typeof value === 'string' && (ORDER_DOCUMENT_FORMAT_IDS as readonly string[]).includes(value);
}

/** Libellé de sélecteur : « A5 — recommandé ». */
export function orderDocumentFormatOptionLabel(format: OrderDocumentFormat): string {
  const spec = ORDER_DOCUMENT_FORMATS[format];
  return spec.recommended ? `${spec.label} — recommandé` : spec.label;
}

/**
 * Contrat des routes : paramètre absent/vide → défaut fourni (préférence
 * tenant) ; paramètre présent mais inconnu → `null` (la route répond 400,
 * jamais de repli silencieux sur un autre format).
 */
export function resolveRequestedFormat(raw: string | null | undefined, fallback: OrderDocumentFormat): OrderDocumentFormat | null {
  if (raw == null || raw.trim() === '') return fallback;
  const value = raw.trim().toLowerCase();
  return isOrderDocumentFormat(value) ? value : null;
}

/**
 * Plafond d'un lot (PDF groupé) : la sélection de la liste est déjà bornée à
 * une page de 50 commandes, et les routes PDF ont un budget Vercel de 30 s.
 */
export const MAX_BULK_ORDER_DOCUMENTS = 50;
