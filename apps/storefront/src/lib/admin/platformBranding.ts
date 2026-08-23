import { createServiceClient } from '@/lib/supabase/server';

export interface PlatformBranding {
  platformName: string;
  logoUrl: string | null;
  primary: string;
  primaryHover: string;
  primarySoft: string;
  primaryForeground: string;
  surface: string;
  surfaceSubtle: string;
  pageBackground: string;
  border: string;
}

export const DEFAULT_PLATFORM_BRANDING: PlatformBranding = {
  platformName: 'Lepefy Commerce',
  logoUrl: '/brand/lepefy-commerce.svg',
  primary: '#6D5AF6',
  primaryHover: '#5B49E8',
  primarySoft: '#F3F1FF',
  primaryForeground: '#4434C7',
  surface: '#FFFFFF',
  surfaceSubtle: '#FAFAFC',
  pageBackground: '#F7F8FA',
  border: '#E5E7EB',
};

type PlatformBrandingRow = {
  platform_name: string;
  logo_url: string | null;
  primary_color: string;
  primary_hover: string;
  primary_soft: string;
  primary_foreground: string;
  surface_color: string;
  surface_subtle: string;
  page_background: string;
  border_color: string;
};

export async function getPlatformBranding(): Promise<PlatformBranding> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('platform_branding')
      .select('platform_name, logo_url, primary_color, primary_hover, primary_soft, primary_foreground, surface_color, surface_subtle, page_background, border_color')
      .eq('id', 'default')
      .maybeSingle();

    if (error || !data) return DEFAULT_PLATFORM_BRANDING;

    const row = data as PlatformBrandingRow;
    const platformName = row.platform_name?.trim();

    return {
      // The first 073 seed used the generic "Lepefy" label. In this product,
      // treat that untouched seed value as the product brand while preserving
      // any explicit custom platform name configured later.
      platformName: !platformName || platformName === 'Lepefy'
        ? DEFAULT_PLATFORM_BRANDING.platformName
        : platformName,
      logoUrl: row.logo_url || DEFAULT_PLATFORM_BRANDING.logoUrl,
      primary: row.primary_color || DEFAULT_PLATFORM_BRANDING.primary,
      primaryHover: row.primary_hover || DEFAULT_PLATFORM_BRANDING.primaryHover,
      primarySoft: row.primary_soft || DEFAULT_PLATFORM_BRANDING.primarySoft,
      primaryForeground: row.primary_foreground || DEFAULT_PLATFORM_BRANDING.primaryForeground,
      surface: row.surface_color || DEFAULT_PLATFORM_BRANDING.surface,
      surfaceSubtle: row.surface_subtle || DEFAULT_PLATFORM_BRANDING.surfaceSubtle,
      pageBackground: row.page_background || DEFAULT_PLATFORM_BRANDING.pageBackground,
      border: row.border_color || DEFAULT_PLATFORM_BRANDING.border,
    };
  } catch {
    // Migration 073 may not yet be applied in every environment. Keep /admin
    // usable with deterministic platform defaults until the table exists.
    return DEFAULT_PLATFORM_BRANDING;
  }
}
