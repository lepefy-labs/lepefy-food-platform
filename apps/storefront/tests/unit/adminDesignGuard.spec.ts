import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Admin Design System V2 guard (stands in for lint, which this repo does not
 * run). Every path in MIGRATED must use the shared kit and tokens only. A
 * module joins the list when it is migrated; the list grows until it covers
 * all of app/admin (docs: AGENTS.md › Admin Design System V2).
 */
const ADMIN_ROOT = join(__dirname, '../../src/app/admin');

const MIGRATED = [
  'layout.tsx',
  '_components/ui/Button.tsx',
  '_components/ui/Badge.tsx',
  '_components/ui/StatusBadge.tsx',
  '_components/ui/AdminStatCard.tsx',
  '_components/ui/AdminPageHeader.tsx',
];

const RULES: { name: string; pattern: RegExp }[] = [
  { name: 'text under 12px', pattern: /\btext-(?:\[(?:[0-9]|1[01])(?:\.\d+)?px\]|2xs)\b/ },
  { name: 'raw Tailwind palette colour (use a-* / tone-* tokens)', pattern: /\b(?:bg|text|border|ring|divide|outline|from|to|fill|stroke|placeholder)-(?:gray|slate|zinc|neutral|stone|violet|purple|indigo|blue|sky|cyan|teal|emerald|green|lime|yellow|amber|orange|red|rose|pink)-\d{2,3}\b/ },
  { name: 'dark: variant (tokens already switch theme)', pattern: /(?<![\w-])dark:/ },
  { name: 'native confirm() (use ConfirmDialog)', pattern: /\b(?:window\.)?confirm\(/ },
  { name: 'legacy --color-primary token in admin', pattern: /var\(--color-primary/ },
  { name: 'hard-coded hex colour', pattern: /(?:bg|text|border|ring)-\[#[0-9a-fA-F]{3,8}\]/ },
];

function filesUnder(path: string): string[] {
  const full = join(ADMIN_ROOT, path);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap((entry) => filesUnder(join(path, entry))).filter((file) => /\.(tsx?|css)$/.test(file));
}

test('migrated admin files follow the design system rules', () => {
  const violations: string[] = [];
  for (const file of MIGRATED.flatMap(filesUnder)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const rule of RULES) {
        if (rule.pattern.test(line)) violations.push(`${relative(ADMIN_ROOT, file)}:${index + 1} ${rule.name}: ${line.trim().slice(0, 120)}`);
      }
    });
  }
  expect(violations, violations.join('\n')).toEqual([]);
});
