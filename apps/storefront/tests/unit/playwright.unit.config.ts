import { defineConfig } from '@playwright/test';

// Test unitari eseguiti con il runner Playwright già presente nel repo
// (@playwright/test è una devDependency esistente) — nessuna nuova libreria di
// test introdotta, cf. regola finale 4. Nessun browser viene avviato: questi
// test non usano mai la fixture `page`, importano direttamente i moduli
// TypeScript e girano in Node.
//
//   pnpm --filter @lepefy/storefront test:unit
export default defineConfig({
  // tsconfig esplicito: senza, gli alias `@/*` non vengono risolti nei moduli
  // importati da src/ (Playwright cerca un tsconfig accanto al file di test).
  tsconfig:     '../../tsconfig.json',
  // testDir sulla radice del package (e non su tests/unit) : gli alias `@/*`
  // sono applicati solo ai file situati SOTTO testDir, e i moduli sotto test
  // vivono in src/.
  testDir:      '../../',
  testMatch:    'tests/unit/**/*.spec.ts',
  fullyParallel: false,
  // I moduli sotto test (store zustand, sync engine) sono singleton di modulo:
  // un solo worker garantisce un ordine deterministico e nessuna interferenza.
  workers:  1,
  retries:  0,
  reporter: [['list']],
});
