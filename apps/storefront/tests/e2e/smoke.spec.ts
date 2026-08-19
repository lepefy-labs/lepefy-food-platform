import { test, expect } from '@playwright/test';

test.describe('Smoke test harness', () => {
  test('homepage carica correttamente', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/.+/);
  });

  test('pagina checkout shop è raggiungibile', async ({ page }) => {
    await page.goto('/checkout');
    // Solo verifica che la pagina risponda, nessuna asserzione di contenuto
    // in questa fase — sarà negli spec funzionali della Fase 1
    await expect(page.locator('body')).toBeVisible();
  });
});
