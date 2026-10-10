import { test, expect } from '@playwright/test';
import { ADMIN_DARK_CSS } from '../../src/app/admin/_components/adminDarkTheme';

const rules = ADMIN_DARK_CSS.split('\n').map((line) => line.trim()).filter((line) => line.startsWith(':where'));

test('every safety-net rule is scoped to the dark theme with low specificity', () => {
  expect(rules.length).toBeGreaterThan(20);
  for (const line of rules) {
    const selectors = line.slice(0, line.indexOf('{')).split(',');
    for (const selector of selectors) expect(selector.startsWith(':where(.dark) ')).toBe(true);
  }
});

test('legacy dark overrides only apply when <html> has the dark class', () => {
  expect(ADMIN_DARK_CSS).toContain(':root.dark {');
  // Admin tokens are owned by lib/admin/tokens.ts, never redefined here.
  expect(ADMIN_DARK_CSS.match(/:root\.dark \{([^}]*)\}/)?.[1]).not.toContain('--admin-');
  // The primary button background token is intentionally not remapped.
  expect(ADMIN_DARK_CSS).not.toContain('--color-primary-dark:');
});

test('arbitrary-value and opacity utilities are escaped like Tailwind emits them', () => {
  expect(ADMIN_DARK_CSS).toContain('.bg-white\\/95{');
  expect(ADMIN_DARK_CSS).toContain('.text-\\[var\\(--color-primary\\)\\]');
  expect(ADMIN_DARK_CSS).toContain('.border-\\[\\#D9D3FF\\]');
  expect(ADMIN_DARK_CSS).toContain('.hover\\:bg-gray-50:hover');
});
