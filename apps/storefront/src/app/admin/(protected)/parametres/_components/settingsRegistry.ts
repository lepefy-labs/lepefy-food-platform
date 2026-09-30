import {
  IconBell,
  IconBuildingStore,
  IconClockPlay,
  IconCreditCard,
  IconFlask,
  IconMapPin,
  IconPalette,
  IconPlugConnected,
  IconScale,
  IconWorld,
  type Icon,
} from '@tabler/icons-react';

/**
 * Single registry of the Settings Hub: hub cards, internal sub-navigation and
 * client-side search all read from here. Adding a settings destination means
 * adding one section (and its searchable entries) — never a new monolithic page.
 */
export type SettingsSectionKey =
  | 'boutique'
  | 'retrait'
  | 'apparence'
  | 'presence'
  | 'notifications'
  | 'automatisations'
  | 'paiements'
  | 'integrations'
  | 'legal'
  | 'fonctionnalites';

export type SettingsAccent = 'blue' | 'emerald' | 'fuchsia' | 'sky' | 'red' | 'amber' | 'orange' | 'violet' | 'teal';

export interface SettingsEntry {
  title: string;
  description: string;
  href: string;
  keywords?: string[];
}

export interface SettingsSection {
  key: SettingsSectionKey;
  title: string;
  navLabel: string;
  description: string;
  href: string;
  icon: Icon;
  accent: SettingsAccent;
  keywords: string[];
  entries: SettingsEntry[];
}

export interface SettingsGroup {
  key: string;
  label: string;
  sections: SettingsSection[];
}

const BASE = '/admin/parametres';

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    key: 'boutique',
    label: 'Boutique',
    sections: [
      {
        key: 'boutique',
        title: 'Profil de la boutique',
        navLabel: 'Profil',
        description: 'Nom public, slogan, contacts et URL.',
        href: `${BASE}/boutique`,
        icon: IconBuildingStore,
        accent: 'blue',
        keywords: ['profil', 'boutique', 'nom', 'contact'],
        entries: [
          { title: 'Slogan', description: 'Phrase d’accroche affichée sur la boutique.', href: `${BASE}/boutique#profil`, keywords: ['tagline', 'accroche'] },
          { title: 'URL de la boutique', description: 'URL canonique utilisée dans les emails et liens de suivi.', href: `${BASE}/boutique#profil`, keywords: ['url', 'domaine', 'site', 'lien'] },
          { title: 'WhatsApp', description: 'Numéro de contact WhatsApp de la boutique.', href: `${BASE}/boutique#profil`, keywords: ['whatsapp', 'téléphone', 'contact', 'numéro'] },
        ],
      },
      {
        key: 'retrait',
        title: 'Retrait & horaires',
        navLabel: 'Retrait & horaires',
        description: 'Points de retrait, adresse, accès et horaires.',
        href: `${BASE}/retrait`,
        icon: IconMapPin,
        accent: 'emerald',
        keywords: ['retrait', 'click & collect', 'click and collect', 'point de retrait', 'magasin'],
        entries: [
          { title: 'Adresse de retrait', description: 'Adresse du point de retrait click & collect.', href: `${BASE}/retrait#point-principal`, keywords: ['adresse', 'click & collect'] },
          { title: 'Lien Google Maps', description: 'Itinéraire vers le point de retrait.', href: `${BASE}/retrait#point-principal`, keywords: ['google', 'maps', 'itinéraire', 'plan', 'accès'] },
          { title: 'Horaires de retrait', description: 'Horaires affichés en français et en italien.', href: `${BASE}/retrait#point-principal`, keywords: ['horaires', 'heures', 'ouverture', 'orari'] },
        ],
      },
      {
        key: 'apparence',
        title: 'Identité visuelle',
        navLabel: 'Identité visuelle',
        description: 'Logo, application et identité de marque.',
        href: `${BASE}/apparence`,
        icon: IconPalette,
        accent: 'fuchsia',
        keywords: ['apparence', 'logo', 'marque', 'couleurs', 'branding', 'identité'],
        entries: [
          { title: 'Logo et couleurs', description: 'Logo et couleurs de marque de la boutique.', href: `${BASE}/apparence#marque`, keywords: ['logo', 'couleur', 'branding'] },
          { title: 'Icône de l’application', description: 'Icône PWA et Android de la boutique installée.', href: `${BASE}/apparence#icone-application`, keywords: ['application', 'app', 'icône', 'pwa', 'android', 'téléphone'] },
        ],
      },
      {
        key: 'presence',
        title: 'Présence en ligne',
        navLabel: 'Présence en ligne',
        description: 'Réseaux sociaux et visibilité publique.',
        href: `${BASE}/presence`,
        icon: IconWorld,
        accent: 'sky',
        keywords: ['présence', 'web', 'visibilité'],
        entries: [
          { title: 'Réseaux sociaux', description: 'Instagram, Facebook, TikTok… affichés sur la carte digitale.', href: `${BASE}/presence#reseaux-sociaux`, keywords: ['social', 'instagram', 'facebook', 'tiktok', 'youtube', 'linkedin'] },
          { title: 'Avis Google', description: 'Lien « laisser un avis » de votre fiche Google.', href: `${BASE}/presence#avis-google`, keywords: ['google', 'avis', 'review', 'business'] },
        ],
      },
    ],
  },
  {
    key: 'communication',
    label: 'Communication',
    sections: [
      {
        key: 'notifications',
        title: 'Notifications',
        navLabel: 'Notifications',
        description: 'Destinataires et types de notifications.',
        href: `${BASE}/notifications`,
        icon: IconBell,
        accent: 'red',
        keywords: ['notification', 'alerte', 'email', 'destinataire'],
        entries: [
          { title: 'Destinataires des notifications', description: 'Qui reçoit les alertes internes par email.', href: `${BASE}/notifications#destinataires`, keywords: ['email', 'destinataire', 'équipe'] },
          { title: 'Ajouter un destinataire', description: 'Nouvelle adresse et types de notifications.', href: `${BASE}/notifications#ajouter`, keywords: ['ajouter', 'email'] },
        ],
      },
      {
        key: 'automatisations',
        title: 'Rapports & automatisations',
        navLabel: 'Automatisations',
        description: 'Rapports programmés et règles automatiques.',
        href: `${BASE}/automatisations`,
        icon: IconClockPlay,
        accent: 'amber',
        keywords: ['automatisation', 'rapport', 'programmé', 'scheduler'],
        entries: [
          { title: 'Rapport quotidien', description: 'Résumé des commandes à traiter, chaque matin à 08:00.', href: `${BASE}/automatisations#rapport-quotidien`, keywords: ['digest', 'rapport', 'quotidien', '08h', 'fuseau', 'timezone', 'seuils'] },
        ],
      },
    ],
  },
  {
    key: 'commerce',
    label: 'Commerce',
    sections: [
      {
        key: 'paiements',
        title: 'Paiements',
        navLabel: 'Paiements',
        description: 'Moyens de paiement et services où ils sont proposés.',
        href: `${BASE}/paiements`,
        icon: IconCreditCard,
        accent: 'orange',
        keywords: ['paiement', 'payer', 'encaissement'],
        entries: [
          { title: 'Méthodes de paiement', description: 'Carte, virement, liens externes, espèces…', href: `${BASE}/paiements#moyens-de-paiement`, keywords: ['carte', 'virement', 'iban', 'paypal', 'espèces', 'lien'] },
          { title: 'Apple Pay', description: 'Activation et enregistrement du domaine pour la carte digitale.', href: `${BASE}/paiements#moyens-de-paiement`, keywords: ['apple', 'wallet', 'domaine'] },
        ],
      },
      {
        key: 'integrations',
        title: 'Intégrations',
        navLabel: 'Intégrations',
        description: 'Services externes connectés à votre boutique.',
        href: `${BASE}/integrations`,
        icon: IconPlugConnected,
        accent: 'violet',
        keywords: ['intégration', 'connecteur', 'api', 'service externe'],
        entries: [
          { title: 'Stripe', description: 'Paiements en ligne par carte.', href: `${BASE}/integrations#stripe`, keywords: ['stripe', 'carte', 'paiement'] },
          { title: 'Packlink', description: 'Devis et suivi des expéditions.', href: `${BASE}/integrations#packlink`, keywords: ['packlink', 'livraison', 'expédition', 'transporteur'] },
          { title: 'n8n', description: 'Automatisations et envoi des notifications.', href: `${BASE}/integrations#n8n`, keywords: ['n8n', 'webhook', 'automatisation'] },
        ],
      },
    ],
  },
  {
    key: 'organisation',
    label: 'Organisation',
    sections: [
      {
        key: 'legal',
        title: 'Informations légales',
        navLabel: 'Informations légales',
        description: 'Raison sociale, adresse et email légaux.',
        href: `${BASE}/legal`,
        icon: IconScale,
        accent: 'teal',
        keywords: ['légal', 'juridique', 'raison sociale', 'société', 'étiquettes'],
        entries: [
          { title: 'Raison sociale', description: 'Nom légal imprimé sur les étiquettes produits.', href: `${BASE}/legal#informations-legales`, keywords: ['société', 'entreprise'] },
          { title: 'Adresse et email légaux', description: 'Coordonnées légales de l’entreprise.', href: `${BASE}/legal#informations-legales`, keywords: ['adresse', 'email', 'siège'] },
        ],
      },
      {
        key: 'fonctionnalites',
        title: 'Fonctionnalités en test',
        navLabel: 'Fonctionnalités',
        description: 'Activer ou désactiver les nouveautés en cours de déploiement.',
        href: `${BASE}/fonctionnalites`,
        icon: IconFlask,
        accent: 'sky',
        keywords: ['fonctionnalité', 'flag', 'feature flag', 'bêta', 'test', 'nouveauté'],
        entries: [
          { title: 'Nouveautés en déploiement', description: 'Fonctionnalités désactivées par défaut, activables pour votre boutique.', href: `${BASE}/fonctionnalites#fonctionnalites`, keywords: ['flag', 'bêta', 'activer'] },
        ],
      },
    ],
  },
];

export const SETTINGS_SECTIONS: SettingsSection[] = SETTINGS_GROUPS.flatMap((group) => group.sections);

export function getSettingsSection(key: SettingsSectionKey): { section: SettingsSection; group: SettingsGroup } {
  for (const group of SETTINGS_GROUPS) {
    const section = group.sections.find((candidate) => candidate.key === key);
    if (section) return { section, group };
  }
  throw new Error(`Unknown settings section: ${key}`);
}

/** Admin destinations that left Paramètres but stay findable from its search. */
export const RELATED_DESTINATIONS = [
  { title: 'Contenu public', description: 'Histoire de la boutique, photo et contenus éditoriaux.', href: '/admin/contenu', category: 'Contenu', keywords: ['contenu', 'histoire', 'origine', 'story', 'photo', 'pays desservis', 'éditorial'] },
  { title: 'Outils du tenant', description: 'QR boutique, QR carte, affiches et liens partageables.', href: '/admin/outils', category: 'Outils', keywords: ['qr', 'qr code', 'affiche', 'poster', 'pdf', 'png', 'svg', 'partage', 'lien'] },
] as const;

export type SettingsStatusTone = 'ok' | 'neutral' | 'warning';
export interface SettingsStatus { label: string; tone: SettingsStatusTone }
export type SettingsStatusMap = Partial<Record<SettingsSectionKey, SettingsStatus>>;
