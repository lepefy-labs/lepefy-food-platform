/**
 * Scénario privé pour le prospect Tata Pao (traiteur africain à Breuillet).
 * Même jeu de données que « traiteur-africain » ; seul l'habillage change.
 *
 * Règles (docs/DEMO_EXPERIENCE.md §5) : chargé uniquement sur une démo PRIVÉE
 * (lien signé) ; aucun logo, photo ni texte repris du site du prospect ; les
 * plats, prix et disponibilités sont des exemples, jamais présentés comme les
 * tarifs ou la carte vérifiés du commerce.
 */
import base from './traiteur-africain.mjs';

export const scenario = {
  ...base,
  key: 'tata-pao',
  requiresPrivate: true,
  tenant: {
    ...base.tenant,
    name: 'Tata Pao — démonstration',
    tagline: 'Traiteur africain et événements à Breuillet — démonstration privée Lepefy',
    story_text: 'Démonstration privée préparée par Lepefy. Les plats, les prix, les clients et les commandes sont fictifs : ils illustrent la plateforme et ne représentent ni la carte ni les tarifs de Tata Pao.',
  },
};

export default scenario;
