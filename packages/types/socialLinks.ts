export type SocialPlatform =
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'youtube'
  | 'linkedin'
  | 'x';

export interface SocialPlatformMeta {
  label: string;
  iconName:
    | 'IconBrandInstagram'
    | 'IconBrandFacebook'
    | 'IconBrandTiktok'
    | 'IconBrandYoutube'
    | 'IconBrandLinkedin'
    | 'IconBrandX';
  badgeBackground: string; // valeur CSS background (solid ou gradient)
}

// Registro condiviso a livello di piattaforma: mappa una piattaforma alla sua
// resa visiva. Aggiungere una nuova piattaforma = aggiungere una riga qui +
// estendere la CHECK constraint SQL. Nessun tenant-specific value qui dentro.
export const SOCIAL_PLATFORM_REGISTRY: Record<SocialPlatform, SocialPlatformMeta> = {
  instagram: {
    label: 'Instagram',
    iconName: 'IconBrandInstagram',
    badgeBackground: 'radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285AEB 90%)',
  },
  facebook:  { label: 'Facebook',  iconName: 'IconBrandFacebook',  badgeBackground: '#1877F2' },
  tiktok:    { label: 'TikTok',    iconName: 'IconBrandTiktok',    badgeBackground: '#000000' },
  youtube:   { label: 'YouTube',   iconName: 'IconBrandYoutube',   badgeBackground: '#FF0000' },
  linkedin:  { label: 'LinkedIn',  iconName: 'IconBrandLinkedin',  badgeBackground: '#0A66C2' },
  x:         { label: 'X',         iconName: 'IconBrandX',         badgeBackground: '#000000' },
};

export interface TenantSocialLink {
  id: string;
  tenant_id: string;
  platform: SocialPlatform;
  url: string;
  sort_order: number;
  active: boolean;
}
