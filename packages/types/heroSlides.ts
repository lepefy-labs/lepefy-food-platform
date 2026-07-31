export type HeroSlideBackgroundVariant = 'primary' | 'secondary' | 'accent';

export interface TenantHeroSlide {
  id: string;
  tenant_id: string;
  position: number;
  badge_text: string | null;
  title: string;
  subtitle: string | null;
  cta_primary_label: string | null;
  cta_primary_url: string | null;
  cta_secondary_label: string | null;
  cta_secondary_url: string | null;
  background_variant: HeroSlideBackgroundVariant;
  active: boolean;
  created_at: string;
  updated_at: string;
}
