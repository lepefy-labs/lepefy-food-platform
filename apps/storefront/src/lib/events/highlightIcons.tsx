import { IconFlame, IconLeaf, IconHeart, IconSparkles } from '@tabler/icons-react';

// Registre fixe clé DB → icône Tabler pour la feature row hero événement
// (058, events.highlights) et le sélecteur admin correspondant. Volontairement
// pas de composant icône custom uploadable — set minimal pour cet événement,
// à étendre ici (jamais côté data) quand un futur événement en aura besoin.
// Toute clé absente du registre retombe sur IconSparkles, jamais une erreur
// runtime (voir commentaire de la colonne events.highlights, migration 058).
export const HIGHLIGHT_ICONS = {
  flame: IconFlame,
  leaf: IconLeaf,
  heart: IconHeart,
} as const;

export type HighlightIconKey = keyof typeof HIGHLIGHT_ICONS;

export const HIGHLIGHT_ICON_OPTIONS = (Object.keys(HIGHLIGHT_ICONS) as HighlightIconKey[]).map((key) => ({
  key,
  Icon: HIGHLIGHT_ICONS[key],
}));

export function getHighlightIcon(key: string) {
  return (HIGHLIGHT_ICONS as Record<string, typeof IconSparkles>)[key] ?? IconSparkles;
}
