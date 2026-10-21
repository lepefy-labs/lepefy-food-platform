import { readFileSync } from 'fs';
import { ADMIN_NAV } from '../../src/lib/admin/navigation';
import { join } from 'path';
import { expect, test } from '@playwright/test';
import type { ShippingTariffVersionRow } from '@lepefy/types';
import { CHLOEFOOD_TARIFF } from './fixtures/chloefoodTariff';
import {
  buildCountryTariffViews, buildEditedVersion, buildTariffHistory, countryFlag, countryLabel, diffTariffPrices,
  editsFromVersion, formatEuroInput, parseEuroAmount, type TariffPriceEdits,
} from '../../src/lib/shipping/tariff/tariffEdit';
import { priceFromTariff } from '../../src/lib/shipping/tariff/priceFromTariff';
import { parseTariffVersion } from '../../src/lib/shipping/tariff/tariffVersion';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';

const SRC = join(__dirname, '../../src');
const ttc = (r: ReturnType<typeof priceFromTariff>) => (r.available ? r.totalTtcCents : null);

function version(overrides: Partial<ShippingTariffVersionRow> = {}): ShippingTariffVersionRow {
  return {
    id: 'ver-it-1', tenant_id: 'tenant-chloe', country: 'IT', currency: 'EUR', version: 1, status: 'active', name: 'Grille',
    bands: CHLOEFOOD_TARIFF.bands, zone_surcharges: CHLOEFOOD_TARIFF.zoneSurcharges, non_deliverable_zones: ['IT_EXTRA_CUSTOMS'],
    max_parcel_weight_g: 15000, block_weight_g: 30000, block_price_cents: 1980, logistics_verified_max_weight_g: 50000,
    prices_include_vat: true, source_draft_id: null, notes: null, created_by: null, created_at: '2026-09-23T20:00:00Z', selected_at: null,
    retired_at: null, updated_at: '', activated_at: '2026-09-23T23:40:48Z', activated_by: 'admin-1', retired_by: null,
    ...overrides,
  };
}

const FR = (overrides: Partial<ShippingTariffVersionRow> = {}) => version({
  id: 'ver-fr-1', country: 'FR',
  bands: [
    { min_g_exclusive: 0, max_g_inclusive: 5000, price_cents: 1400 },
    { min_g_exclusive: 5000, max_g_inclusive: 10000, price_cents: 1800 },
    { min_g_exclusive: 10000, max_g_inclusive: 15000, price_cents: 2000 },
  ],
  zone_surcharges: [], non_deliverable_zones: [], block_weight_g: 15000, block_price_cents: 2000, logistics_verified_max_weight_g: 15000,
  ...overrides,
});

// ─── Saisie des montants (format français) ──────────────────────────────────

test.describe('saisie des montants', () => {
  test('virgule, point, entier, symbole et espaces → centimes entiers', () => {
    expect(parseEuroAmount('8,90')).toBe(890);
    expect(parseEuroAmount('8,9')).toBe(890);
    expect(parseEuroAmount('8.90')).toBe(890);
    expect(parseEuroAmount('8')).toBe(800);
    expect(parseEuroAmount(' 11,50 € ')).toBe(1150);
    expect(parseEuroAmount('1 234,05')).toBe(123405);
    expect(parseEuroAmount('0')).toBe(0);
    // 0,1 + 0,2 en flottant : jamais d'erreur d'arrondi
    expect(parseEuroAmount('0,29')).toBe(29);
  });

  test('vide, négatif, trois décimales, texte ou plafond dépassé → invalide', () => {
    for (const input of ['', ' ', '-1', '-1,00', '8,901', 'abc', '8,9,0', '1e3', '10000,01']) expect(parseEuroAmount(input), input).toBeNull();
    expect(parseEuroAmount('10000')).toBe(1_000_000);
  });

  test('affichage des champs au format français', () => {
    expect(formatEuroInput(890)).toBe('8,90');
    expect(formatEuroInput(123405)).toBe('1234,05');
    expect(parseEuroAmount(formatEuroInput(1980))).toBe(1980);
  });
});

// ─── Nouvelle version = base + prix ─────────────────────────────────────────

test.describe('construction de la version modifiée', () => {
  test('un seul montant : seul ce prix change, tous les autres paramètres sont recopiés', () => {
    const base = version();
    const edits = editsFromVersion(base);
    edits.bandPricesCents[0] = 890;
    const built = buildEditedVersion(base, edits);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.fields.bands.map((b) => b.price_cents)).toEqual([890, 1080, 1260, 1640, 1980]);
    expect(built.fields.bands.map((b) => [b.min_g_exclusive, b.max_g_inclusive])).toEqual(base.bands.map((b) => [b.min_g_exclusive, b.max_g_inclusive]));
    for (const key of ['country', 'currency', 'non_deliverable_zones', 'max_parcel_weight_g', 'block_weight_g', 'block_price_cents', 'logistics_verified_max_weight_g', 'prices_include_vat'] as const) {
      expect(built.fields[key], key).toEqual(base[key]);
    }
    expect(built.fields.zone_surcharges).toEqual(base.zone_surcharges);
    expect(diffTariffPrices(base, edits)).toEqual([
      { key: 'band-0', kind: 'band', label: '0 – 5 kg', hint: null, beforeCents: 840, afterCents: 890 },
    ]);
    // Le moteur du checkout prend bien le nouveau prix (aucun second moteur).
    const parsed = parseTariffVersion({ ...base, ...built.fields });
    expect(parsed.ok && ttc(priceFromTariff(parsed.tariff, { weightG: 4000, country: 'IT', zoneCode: null, vatRate: 0.22 }))).toBe(890);
  });

  test('plusieurs montants, bloc et suppléments de zone', () => {
    const base = version();
    const edits: TariffPriceEdits = {
      bandPricesCents: [890, 1080, 1320, 1640, 1980],
      blockPriceCents: 2100,
      surchargesCents: { IT_SICILY: 250, IT_SARDINIA: 200, IT_CALABRIA: 200 },
    };
    const built = buildEditedVersion(base, edits);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.fields.block_price_cents).toBe(2100);
    expect(built.fields.zone_surcharges.find((z) => z.zone_code === 'IT_SICILY')).toEqual({ zone_code: 'IT_SICILY', mode: 'per_parcel', amount_cents: 250 });
    const changes = diffTariffPrices(base, edits);
    expect(changes.map((c) => c.key)).toEqual(['band-0', 'band-2', 'block', 'zone-IT_SICILY']);
    expect(changes.find((c) => c.key === 'zone-IT_SICILY')).toMatchObject({ label: 'Sicile', hint: 'par colis', beforeCents: 200, afterCents: 250 });
    expect(changes.find((c) => c.key === 'block')).toMatchObject({ label: 'Par 30 kg en plus', beforeCents: 1980, afterCents: 2100 });
    // Sicile, 20 kg = 15 + 5 : 16,40 + 2 × 2,50
    const parsed = parseTariffVersion({ ...base, ...built.fields });
    expect(parsed.ok && ttc(priceFromTariff(parsed.tariff, { weightG: 20000, country: 'IT', zoneCode: 'IT_SICILY', vatRate: 0.22 }))).toBe(2140);
  });

  test('aucune modification → aucun écart à publier', () => {
    const base = version();
    expect(diffTariffPrices(base, editsFromVersion(base))).toEqual([]);
  });

  test('structure différente refusée (tranche ajoutée, zone ajoutée ou retirée, bloc ajouté ou retiré)', () => {
    const base = version();
    const ok = editsFromVersion(base);
    expect(buildEditedVersion(base, { ...ok, bandPricesCents: [...ok.bandPricesCents, 100] })).toEqual({ ok: false, errors: ['structure_changed'] });
    expect(buildEditedVersion(base, { ...ok, surchargesCents: { ...ok.surchargesCents, IT_VENICE_LAGOON: 100 } })).toEqual({ ok: false, errors: ['structure_changed'] });
    const { IT_SICILY: _drop, ...withoutSicily } = ok.surchargesCents;
    expect(buildEditedVersion(base, { ...ok, surchargesCents: withoutSicily })).toEqual({ ok: false, errors: ['structure_changed'] });
    expect(buildEditedVersion(base, { ...ok, blockPriceCents: null })).toEqual({ ok: false, errors: ['structure_changed'] });
    const noBlock = version({ block_weight_g: null, block_price_cents: null });
    expect(buildEditedVersion(noBlock, { ...editsFromVersion(noBlock), blockPriceCents: 500 })).toEqual({ ok: false, errors: ['structure_changed'] });
  });

  test('montants invalides refusés (négatif, décimal, non numérique, plafond)', () => {
    const base = version();
    for (const bad of [-1, 8.5, Number.NaN, 1_000_001, '890' as unknown as number]) {
      const edits = editsFromVersion(base);
      edits.bandPricesCents[1] = bad;
      expect(buildEditedVersion(base, edits), String(bad)).toEqual({ ok: false, errors: ['price_invalid'] });
    }
    const edits = editsFromVersion(base);
    edits.surchargesCents.IT_SICILY = -200;
    expect(buildEditedVersion(base, edits)).toEqual({ ok: false, errors: ['price_invalid'] });
  });
});

// ─── Vues pays et historique ────────────────────────────────────────────────

test.describe('cartes pays', () => {
  test('tenant avec forfait actif : actifs d’abord, simulation distincte, pays connus non configurés', () => {
    const views = buildCountryTariffViews([
      version(),
      version({ id: 'ver-it-0', version: 0, status: 'shadow' }),
      FR(),
      version({ id: 'ver-es-1', country: 'ES', status: 'shadow', activated_at: null }),
      version({ id: 'ver-de-1', country: 'DE', status: 'retired' }),
    ], ['IT', 'CH', 'fr', '*']);
    expect(views.map((v) => [v.country, v.status])).toEqual([
      ['FR', 'active'], ['IT', 'active'], ['ES', 'simulation'], ['CH', 'not_configured'],
    ]);
    // Une version shadow ne remplace jamais la version facturée du même pays.
    expect(views.find((v) => v.country === 'IT')!.version!.id).toBe('ver-it-1');
    expect(views.find((v) => v.country === 'CH')!.version).toBeNull();
  });

  test('tenant sans forfait actif : aucune valeur simulée présentée comme facturée', () => {
    const views = buildCountryTariffViews([version({ status: 'shadow', activated_at: null })], ['IT']);
    expect(views).toEqual([{ country: 'IT', status: 'simulation', version: expect.objectContaining({ status: 'shadow' }) }]);
    expect(buildCountryTariffViews([], [])).toEqual([]);
  });

  test('nom et drapeau du pays', () => {
    expect(countryLabel('IT')).toBe('Italie');
    expect(countryLabel('de')).toBe('Allemagne');
    expect(countryFlag('IT')).toBe('🇮🇹');
    expect(countryFlag('*')).toBe('');
  });
});

test.describe('historique', () => {
  test('versions facturées uniquement, plus récente d’abord, écart avec la version précédente', () => {
    const v1 = version({ status: 'retired', retired_at: '2026-10-18T12:00:00Z' });
    const v2 = version({
      id: 'ver-it-2', version: 2, activated_at: '2026-10-18T12:00:00Z',
      bands: CHLOEFOOD_TARIFF.bands.map((b, i) => (i === 0 ? { ...b, price_cents: 890 } : b)),
    });
    const lab = version({ id: 'ver-it-3', version: 3, status: 'validated', activated_at: null });
    const history = buildTariffHistory([v1, v2, lab, FR({ activated_at: '2026-09-24T18:51:15Z' })]);
    expect(history.map((h) => h.version.id)).toEqual(['ver-it-2', 'ver-fr-1', 'ver-it-1']);
    expect(history[0]).toMatchObject({ current: true, isFirst: false, changes: [{ label: '0 – 5 kg', beforeCents: 840, afterCents: 890 }] });
    expect(history[2]).toMatchObject({ current: false, isFirst: true, changes: null });
  });

  test('grille restructurée : pas de faux écart de prix', () => {
    const v1 = version({ status: 'retired' });
    const v2 = version({ id: 'ver-it-2', version: 2, activated_at: '2026-10-18T12:00:00Z', bands: [{ min_g_exclusive: 0, max_g_inclusive: 30000, price_cents: 990 }] });
    expect(buildTariffHistory([v1, v2])[0]).toMatchObject({ isFirst: false, changes: null });
  });
});

// ─── Permissions et séparation tenant / platform owner ──────────────────────

test.describe('séparation tenant / platform owner', () => {
  test('publication et opérations commerciales : capacités tenant', () => {
    expect(permissionForAdminApi('/api/admin/shipping-tariff-versions/publish', 'POST')).toBe('shipping.manage');
    expect(permissionForAdminApi('/api/admin/shipping-tariff-versions/publish', 'GET')).toBeNull();
    expect(permissionForAdminApi('/api/admin/shipping-tariff-versions/abc/activate', 'POST')).toBe('shipping.manage');
    expect(permissionForAdminApi('/api/admin/shipping-tariff-versions/retire', 'POST')).toBe('shipping.manage');
    expect(permissionForAdminApi('/api/admin/shipping-tariff-versions', 'GET')).toBe('shipping.view');
    expect(permissionForAdminApi('/api/admin/shipping-pricing-mode', 'PATCH')).toBe('shipping.manage');
  });

  test('laboratoire absent de la carte des capacités tenant', () => {
    for (const [method, path] of [
      ['POST', '/api/admin/shipping-tariff-versions'],
      ['POST', '/api/admin/shipping-tariff-versions/abc/select'],
      ['GET', '/api/admin/shipping-shadow-report'],
      ['GET', '/api/admin/shipping-tariff-drafts'],
      ['POST', '/api/admin/shipping-tariff-drafts'],
      ['PATCH', '/api/admin/shipping-tariff-drafts/abc'],
      ['POST', '/api/admin/shipping-tariff-drafts/abc/simulate'],
    ] as const) {
      expect(permissionForAdminApi(path, method), `${method} ${path}`).toBeNull();
    }
  });

  test('les routes du laboratoire exigent le platform owner côté serveur', () => {
    const api = join(SRC, 'app/api/admin');
    const allOwner = ['shipping-tariff-drafts/route.ts', 'shipping-tariff-drafts/[id]/route.ts', 'shipping-tariff-drafts/[id]/simulate/route.ts',
      'shipping-shadow-report/route.ts', 'shipping-tariff-versions/[id]/select/route.ts'];
    for (const file of allOwner) {
      const source = readFileSync(join(api, file), 'utf8');
      const handlers = source.match(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g) ?? [];
      expect(handlers.length, file).toBeGreaterThan(0);
      expect((source.match(/await requirePlatformOwner\(\)/g) ?? []).length, file).toBe(handlers.length);
      expect(source, file).not.toContain('requireAdmin');
    }
    const versions = readFileSync(join(api, 'shipping-tariff-versions/route.ts'), 'utf8');
    const post = versions.slice(versions.indexOf('export async function POST'));
    expect(post).toContain('await requirePlatformOwner()');
    expect(post).not.toContain('requireAdmin(');
    // Collecte shadow : platform owner ; retour au calcul transporteur depuis le forfait : tenant.
    const mode = readFileSync(join(api, 'shipping-pricing-mode/route.ts'), 'utf8');
    expect(mode).toMatch(/if \(current !== 'tariff'\) \{\s+const notOwner = await requirePlatformOwner\(\);/);
    const publish = readFileSync(join(api, 'shipping-tariff-versions/publish/route.ts'), 'utf8');
    expect(publish).toContain('await requireAdmin(tenant.id)');
    expect(publish).toContain("rpc('publish_shipping_tariff_version'");
  });

  test('pages : laboratoire et analyse tarifaire réservés, anciennes URL redirigées, onglets tenant épurés', () => {
    const admin = join(SRC, 'app/admin/(protected)');
    for (const page of ['platform/livraison/forfait-laboratoire/page.tsx', 'platform/livraison/analyse-tarifaire/page.tsx']) {
      expect(readFileSync(join(admin, page), 'utf8'), page).toContain("if (await requirePlatformOwner()) redirect('/admin')");
    }
    expect(readFileSync(join(admin, 'livraison/forfait-shadow/page.tsx'), 'utf8')).toContain("redirect('/admin/livraison/forfait')");
    expect(readFileSync(join(admin, 'livraison/analyse-tarifaire/page.tsx'), 'utf8')).toContain("redirect('/admin/platform/livraison/analyse-tarifaire')");
    // The Livraison sub-pages live in the navigation registry (sidebar + tab strip).
    const tabs = JSON.stringify(ADMIN_NAV.find((item) => item.id === 'shipping')?.children ?? []).replace(/"/g, "'");
    expect(tabs).not.toContain('analyse-tarifaire');
    expect(tabs).not.toContain('forfait-shadow');
    expect(tabs).toContain("'/admin/livraison/forfait'");
    // La page tenant n'embarque aucun outil du laboratoire.
    const client = readFileSync(join(admin, 'livraison/forfait/ForfaitClient.tsx'), 'utf8') + readFileSync(join(admin, 'livraison/forfait/TariffEditorDrawer.tsx'), 'utf8');
    for (const forbidden of ['shipping-shadow-report', 'shipping-tariff-drafts', '}/select', 'priceFromTariff', "mode: 'shadow'", 'shadowReport']) {
      expect(client, forbidden).not.toContain(forbidden);
    }
  });

  test('la RPC de publication est déclarée comme écriture auditée', () => {
    expect(readFileSync(join(SRC, 'lib/audit/requestContext.ts'), 'utf8')).toContain("'publish_shipping_tariff_version'");
  });
});
