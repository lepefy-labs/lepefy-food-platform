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
}

// Registro condiviso a livello di piattaforma: mappa una piattaforma alla sua
// resa visiva. Aggiungere una nuova piattaforma = aggiungere una riga qui +
// estendere la CHECK constraint SQL. Nessun tenant-specific value qui dentro.
export const SOCIAL_PLATFORM_REGISTRY: Record<SocialPlatform, SocialPlatformMeta> = {
  instagram: { label: 'Instagram', iconName: 'IconBrandInstagram' },
  facebook:  { label: 'Facebook',  iconName: 'IconBrandFacebook' },
  tiktok:    { label: 'TikTok',    iconName: 'IconBrandTiktok' },
  youtube:   { label: 'YouTube',   iconName: 'IconBrandYoutube' },
  linkedin:  { label: 'LinkedIn',  iconName: 'IconBrandLinkedin' },
  x:         { label: 'X',         iconName: 'IconBrandX' },
};

export interface TenantSocialLink {
  id: string;
  tenant_id: string;
  platform: SocialPlatform;
  url: string;
  sort_order: number;
  active: boolean;
}
