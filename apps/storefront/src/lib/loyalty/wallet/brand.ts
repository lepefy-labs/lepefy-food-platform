import { contrastRatio } from '@/lib/utils/color';

export interface LoyaltyBrand {
  name: string;
  logoUrl: string | null;
  background: string;
  accent: string;
  textAccent: string;
  foreground: string;
}

export function getLoyaltyBrand(tenant: {
  slug: string; name: string; logo_url: string | null; primary_color: string; secondary_color: string;
}): LoyaltyBrand {
  const background = tenant.slug === 'chloefood' ? '#195B9E' : tenant.primary_color;
  const accent = tenant.slug === 'chloefood' ? '#F8D817' : tenant.secondary_color;
  const foreground = contrastRatio(background, '#ffffff') >= 4.5 ? '#ffffff' : '#1a1a1a';
  return {
    name: tenant.name,
    logoUrl: tenant.logo_url,
    background,
    accent,
    textAccent: contrastRatio(background, accent) >= 3 ? accent : foreground,
    foreground,
  };
}
