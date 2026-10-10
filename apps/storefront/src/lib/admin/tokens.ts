import type { PlatformBranding } from './platformBranding';

/**
 * Admin Design System V2 — single source of the admin colour tokens.
 *
 * Three families that never mix:
 * - brand: Lepefy platform colour (primary actions, selection, focus). Light
 *   values come from `platform_branding`, dark values are designed here.
 * - tenant: the shop's own colours, identity only (logo chips, storefront
 *   previews) — never a status.
 * - tones: semantic operational states, identical for every tenant.
 *
 * Every value is emitted as a CSS custom property by `app/admin/layout.tsx`
 * (light on :root, dark on :root.dark) and exposed to Tailwind as `a-*` and
 * `tone-*` colours, so components never need `dark:` variants. Text/background
 * pairs are checked for WCAG AA in tests/unit/adminTokens.spec.ts.
 */

export const ADMIN_TONES = ['info', 'success', 'warning', 'urgent', 'danger', 'neutral'] as const;
export type AdminTone = (typeof ADMIN_TONES)[number];
export type AdminThemeMode = 'light' | 'dark';

export interface AdminToneValues { bg: string; fg: string; border: string; solid: string }

export interface AdminSurfaceValues {
  pageBg: string;
  surface: string;
  surfaceSubtle: string;
  border: string;
  borderStrong: string;
  text: string;
  text2: string;
  text3: string;
  hover: string;
  disabledBg: string;
  disabledFg: string;
  /** Inverted surface (dark in light theme, light in dark theme) and its text. */
  inverseBg: string;
  inverseFg: string;
}

export interface AdminBrandValues { primary: string; primaryHover: string; primarySoft: string; primaryFg: string; onPrimary: string }

export const ADMIN_TONE_VALUES: Record<AdminThemeMode, Record<AdminTone, AdminToneValues>> = {
  light: {
    info: { bg: '#EFF6FF', fg: '#1D4ED8', border: '#BFDBFE', solid: '#2563EB' },
    success: { bg: '#ECFDF5', fg: '#047857', border: '#A7F3D0', solid: '#059669' },
    warning: { bg: '#FFFBEB', fg: '#92400E', border: '#FDE68A', solid: '#D97706' },
    urgent: { bg: '#FFF7ED', fg: '#C2410C', border: '#FED7AA', solid: '#EA580C' },
    danger: { bg: '#FEF2F2', fg: '#B91C1C', border: '#FECACA', solid: '#DC2626' },
    neutral: { bg: '#F1F5F9', fg: '#334155', border: '#E2E8F0', solid: '#64748B' },
  },
  dark: {
    info: { bg: '#0F1E3A', fg: '#93C5FD', border: '#1E3A8A', solid: '#3B82F6' },
    success: { bg: '#052E24', fg: '#6EE7B7', border: '#065F46', solid: '#10B981' },
    warning: { bg: '#2D2006', fg: '#FCD34D', border: '#78350F', solid: '#F59E0B' },
    urgent: { bg: '#331509', fg: '#FDBA74', border: '#7C2D12', solid: '#F97316' },
    danger: { bg: '#3A0D0D', fg: '#FCA5A5', border: '#7F1D1D', solid: '#EF4444' },
    neutral: { bg: '#1E2533', fg: '#CBD5E1', border: '#334155', solid: '#94A3B8' },
  },
};

export const ADMIN_SURFACE_VALUES: Record<AdminThemeMode, AdminSurfaceValues> = {
  light: {
    pageBg: '#F7F8FA', surface: '#FFFFFF', surfaceSubtle: '#F8FAFC', border: '#E2E8F0', borderStrong: '#CBD5E1',
    text: '#172033', text2: '#475569', text3: '#5B6779', hover: '#F1F5F9', disabledBg: '#F1F5F9', disabledFg: '#5B6779',
    inverseBg: '#172033', inverseFg: '#FFFFFF',
  },
  dark: {
    pageBg: '#0B0F17', surface: '#111827', surfaceSubtle: '#161E2E', border: '#263042', borderStrong: '#334155',
    text: '#E5E9F0', text2: '#B4BCC8', text3: '#8E98A8', hover: '#1A2333', disabledBg: '#1A2333', disabledFg: '#8E98A8',
    inverseBg: '#E5E9F0', inverseFg: '#0B0F17',
  },
};

export const ADMIN_DARK_BRAND: AdminBrandValues = {
  primary: '#8B7CFF', primaryHover: '#9D90FF', primarySoft: '#221E45', primaryFg: '#C9C1FF', onPrimary: '#0B0F17',
};

export function adminLightBrand(platform: Pick<PlatformBranding, 'primary' | 'primaryHover' | 'primarySoft' | 'primaryForeground'>): AdminBrandValues {
  return { primary: platform.primary, primaryHover: platform.primaryHover, primarySoft: platform.primarySoft, primaryFg: platform.primaryForeground, onPrimary: '#FFFFFF' };
}

function declarations(surface: AdminSurfaceValues, brand: AdminBrandValues, tones: Record<AdminTone, AdminToneValues>): string {
  const lines = [
    `--admin-primary: ${brand.primary}`,
    `--admin-primary-hover: ${brand.primaryHover}`,
    `--admin-primary-soft: ${brand.primarySoft}`,
    `--admin-primary-fg: ${brand.primaryFg}`,
    `--admin-on-primary: ${brand.onPrimary}`,
    `--admin-focus: ${brand.primary}`,
    `--admin-selected: ${brand.primarySoft}`,
    `--admin-page-bg: ${surface.pageBg}`,
    `--admin-surface: ${surface.surface}`,
    `--admin-surface-subtle: ${surface.surfaceSubtle}`,
    `--admin-border: ${surface.border}`,
    `--admin-border-strong: ${surface.borderStrong}`,
    `--admin-text: ${surface.text}`,
    `--admin-text-2: ${surface.text2}`,
    `--admin-text-3: ${surface.text3}`,
    `--admin-hover: ${surface.hover}`,
    `--admin-disabled-bg: ${surface.disabledBg}`,
    `--admin-disabled-fg: ${surface.disabledFg}`,
    `--admin-inverse-bg: ${surface.inverseBg}`,
    `--admin-inverse-fg: ${surface.inverseFg}`,
  ];
  for (const tone of ADMIN_TONES) {
    const value = tones[tone];
    lines.push(`--admin-tone-${tone}-bg: ${value.bg}`, `--admin-tone-${tone}-fg: ${value.fg}`, `--admin-tone-${tone}-border: ${value.border}`, `--admin-tone-${tone}-solid: ${value.solid}`);
  }
  return lines.map((line) => `  ${line};`).join('\n');
}

type PlatformColors = Pick<PlatformBranding, 'primary' | 'primaryHover' | 'primarySoft' | 'primaryForeground'>
  & Partial<Pick<PlatformBranding, 'surface' | 'surfaceSubtle' | 'pageBackground' | 'border'>>;

/** CSS for the admin tokens: light on :root, dark on :root.dark. */
export function adminTokensCss(platform: PlatformColors): string {
  // platform_branding may override the light surfaces; text colours stay fixed
  // so the AA pairs checked in tests hold.
  const light: AdminSurfaceValues = {
    ...ADMIN_SURFACE_VALUES.light,
    ...(platform.pageBackground ? { pageBg: platform.pageBackground } : {}),
    ...(platform.surface ? { surface: platform.surface } : {}),
    ...(platform.surfaceSubtle ? { surfaceSubtle: platform.surfaceSubtle } : {}),
    ...(platform.border ? { border: platform.border } : {}),
  };
  return [
    `:root {\n${declarations(light, adminLightBrand(platform), ADMIN_TONE_VALUES.light)}\n}`,
    `:root.dark {\n  color-scheme: dark;\n${declarations(ADMIN_SURFACE_VALUES.dark, ADMIN_DARK_BRAND, ADMIN_TONE_VALUES.dark)}\n}`,
  ].join('\n');
}

/** WCAG 2.x contrast ratio between two #RRGGBB colours. */
export function contrastRatio(a: string, b: string): number {
  const linear = (hex: string, index: number) => {
    const c = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex: string) => 0.2126 * linear(hex, 1) + 0.7152 * linear(hex, 3) + 0.0722 * linear(hex, 5);
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
