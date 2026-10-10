import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Admin Design System V2 guard (stands in for lint, which this repo does not
 * run). Every admin file uses the shared kit and the a-* / tone-* tokens only
 * (docs: docs/ADMIN_DESIGN_SYSTEM.md). LEGACY lists the files still allowed to
 * reference the old palette; it only shrinks.
 */
const ADMIN_ROOT = join(__dirname, '../../src/app/admin');

const LEGACY = [
  // Dark safety net for the pre-token pages, removed with the --color-primary remap (U12).
  '_components/adminDarkTheme.ts',
];

const RULES: { name: string; pattern: RegExp }[] = [
  { name: 'text under 12px', pattern: /\btext-(?:\[(?:[0-9]|1[01])(?:\.\d+)?px\]|2xs)\b/ },
  { name: 'raw Tailwind palette colour (use a-* / tone-* tokens)', pattern: /\b(?:bg|text|border|ring|divide|outline|from|to|fill|stroke|placeholder)-(?:gray|slate|zinc|neutral|stone|violet|purple|indigo|blue|sky|cyan|teal|emerald|green|lime|yellow|amber|orange|red|rose|pink)-\d{2,3}\b/ },
  { name: 'dark: variant (tokens already switch theme)', pattern: /(?<![\w-])dark:(?=[\w[!-])/ },
  { name: 'legacy --color-primary token in admin', pattern: /var\(--color-primary/ },
  { name: 'hard-coded hex colour', pattern: /(?:bg|text|border|ring)-\[#[0-9a-fA-F]{3,8}\]/ },
];

/** Rules that already hold for every admin file. */
const GLOBAL_RULES: { name: string; pattern: RegExp; allow: string[] }[] = [
  { name: 'native confirm() (use ConfirmDialog / useConfirm)', pattern: /\b(?:window\.)?confirm\(['"`]/, allow: [] },
  // Overlays go through Dialog/Drawer (native <dialog>: focus trap, Escape,
  // top layer). The loyalty camera viewfinder is a full-screen camera view.
  { name: 'hand-made overlay (use Dialog / Drawer)', pattern: /\bfixed inset-0\b/, allow: ['loyalty/scan/CameraScanButton.tsx'] },
];

function filesUnder(path: string): string[] {
  const full = join(ADMIN_ROOT, path);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap((entry) => filesUnder(join(path, entry))).filter((file) => /\.(tsx?|css)$/.test(file));
}

const rel = (file: string) => relative(ADMIN_ROOT, file).split('\\').join('/');

test('admin files follow the design system rules', () => {
  const violations: string[] = [];
  for (const file of filesUnder('.').filter((file) => !LEGACY.includes(rel(file)))) {
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      for (const rule of RULES) {
        if (rule.pattern.test(line)) violations.push(`${rel(file)}:${index + 1} ${rule.name}: ${line.trim().slice(0, 120)}`);
      }
    });
  }
  expect(violations, violations.join('\n')).toEqual([]);
});

test('global admin rules hold everywhere', () => {
  const violations: string[] = [];
  for (const file of filesUnder('.')) {
    const path = rel(file);
    const lines = readFileSync(file, 'utf8').split('\n');
    for (const rule of GLOBAL_RULES) {
      if (rule.allow.includes(path)) continue;
      lines.forEach((line, index) => { if (rule.pattern.test(line)) violations.push(`${path}:${index + 1} ${rule.name}`); });
    }
  }
  expect(violations, violations.join('\n')).toEqual([]);
});
