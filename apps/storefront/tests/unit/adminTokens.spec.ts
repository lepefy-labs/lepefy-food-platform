import { test, expect } from '@playwright/test';
import {
  ADMIN_DARK_BRAND, ADMIN_SURFACE_VALUES, ADMIN_TONES, ADMIN_TONE_VALUES, adminLightBrand, adminTokensCss, contrastRatio,
} from '../../src/lib/admin/tokens';
import { DEFAULT_PLATFORM_BRANDING } from '../../src/lib/admin/platformBranding';

const AA = 4.5;

test('contrast ratio matches the WCAG reference values', () => {
  expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  expect(contrastRatio('#9CA3AF', '#FFFFFF')).toBeCloseTo(2.54, 2);
});

for (const mode of ['light', 'dark'] as const) {
  test(`${mode}: every tone label is AA on its own background and on the page surface`, () => {
    const surface = ADMIN_SURFACE_VALUES[mode].surface;
    for (const tone of ADMIN_TONES) {
      const value = ADMIN_TONE_VALUES[mode][tone];
      expect(contrastRatio(value.fg, value.bg), `${mode} ${tone} fg/bg`).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(value.fg, surface), `${mode} ${tone} fg/surface`).toBeGreaterThanOrEqual(AA);
    }
  });

  test(`${mode}: text, secondary text and metadata are AA on surfaces`, () => {
    const s = ADMIN_SURFACE_VALUES[mode];
    for (const [name, fg] of [['text', s.text], ['text-2', s.text2], ['text-3', s.text3], ['disabled', s.disabledFg]] as const) {
      for (const bg of [s.surface, s.surfaceSubtle, s.pageBg]) {
        expect(contrastRatio(fg, bg), `${mode} ${name} on ${bg}`).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  test(`${mode}: inverse surface text is AA`, () => {
    const s = ADMIN_SURFACE_VALUES[mode];
    expect(contrastRatio(s.inverseFg, s.inverseBg)).toBeGreaterThanOrEqual(AA);
  });

  test(`${mode}: brand label colours are AA`, () => {
    const brand = mode === 'light' ? adminLightBrand(DEFAULT_PLATFORM_BRANDING) : ADMIN_DARK_BRAND;
    const s = ADMIN_SURFACE_VALUES[mode];
    expect(contrastRatio(brand.primaryFg, brand.primarySoft)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(brand.primaryFg, s.surface)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(brand.onPrimary, brand.primary)).toBeGreaterThanOrEqual(AA);
  });
}

test('light tokens on :root, dark tokens on :root.dark, every tone emitted', () => {
  const css = adminTokensCss(DEFAULT_PLATFORM_BRANDING);
  const [light, dark] = css.split(':root.dark');
  for (const tone of ADMIN_TONES) {
    for (const part of ['bg', 'fg', 'border', 'solid']) {
      expect(light).toContain(`--admin-tone-${tone}-${part}:`);
      expect(dark).toContain(`--admin-tone-${tone}-${part}:`);
    }
  }
  expect(light).toContain(`--admin-primary: ${DEFAULT_PLATFORM_BRANDING.primary}`);
  expect(dark).toContain('color-scheme: dark');
  expect(css).not.toContain('<');
});

test('platform_branding may override light surfaces only', () => {
  const css = adminTokensCss({ ...DEFAULT_PLATFORM_BRANDING, pageBackground: '#FAFAFA' });
  const [light, dark] = css.split(':root.dark');
  expect(light).toContain('--admin-page-bg: #FAFAFA');
  expect(dark).toContain(`--admin-page-bg: ${ADMIN_SURFACE_VALUES.dark.pageBg}`);
});
