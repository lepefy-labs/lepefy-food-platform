import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { evaluateDossier, lintMessageText, strongIdentityKeys } from '../../src/lib/growth/engine';
import {
  hasOptOut, internationalDigits, isLikelyMobile, stageAfterTouch, whatsappDecision, whatsappLink, withOptOut, WHATSAPP_DAILY_SOFT_LIMIT,
  type WhatsAppContext,
} from '../../src/lib/growth/contactPolicy';
import { inView, sortWorklist, viewCounts } from '../../src/lib/growth/worklist';
import { growthIngestAuthorized, ingestGrowthProspects, parseIngestBody } from '../../src/lib/growth/ingestProtocol';
import { TOUCH_OUTCOMES, type GrowthDossier, type GrowthProspectRow } from '../../src/lib/growth/types';
import { touchIssues, touchSchema } from '../../src/lib/growth/validation';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';
import { PLATFORM_NAV } from '../../src/app/admin/_components/platformNavConfig';

const REPO = resolve(__dirname, '../../../..');
const ROOT = resolve(REPO, 'apps/storefront');

/** Valid fictitious dossier (same shape as the growth CLI fixture). */
function dossier(over: Partial<GrowthDossier> = {}): GrowthDossier {
  return {
    name: 'Mama Koko Market', aliases: [], city: 'Lyon', region: 'Auvergne-Rhône-Alpes', country: 'FR',
    segment: 'boutique-alimentare-africana', address: '12 rue Exemple, Lyon',
    links: { website: 'https://mamakoko.example/' }, phones: ['06 12 34 56 78'],
    evidence: [
      { id: 'e1', url: 'https://mamakoko.example/', checkedAt: '2026-11-14', access: 'opened', kind: 'official_site', supports: ['specialtyFood', 'remoteSelling', 'chatOrders', 'active'], note: 'Accueil : commande sur WhatsApp, envoi en France' },
    ],
    signals: {},
    verifiedFact: { text: 'Le site invite à commander sur WhatsApp avec envoi en France.', evidence: ['e1'] },
    hypothesis: { problem: 'Les commandes en chat demandent des échanges manuels.', question: 'Comment recevez-vous aujourd’hui l’adresse et le paiement ?' },
    lepefy: { featureIds: ['catalogo_checkout', 'contatto_whatsapp'], demoFlow: 'Commande test depuis le catalogue.' },
    entry: { kind: 'visit', detail: 'Boutique ouverte', evidence: ['e1'], nextAction: 'Passer mardi matin.' },
    message: {
      language: 'fr', channel: 'visit_opening',
      text: 'Bonjour, j’ai vu sur votre site que vous prenez les commandes sur WhatsApp. Je travaille sur Lepefy : le client commande au catalogue et peut toujours vous écrire. Est-ce que je peux vous montrer une commande test en cinq minutes ?',
      claims: [{ text: 'commandes sur WhatsApp', evidence: ['e1'] }, { text: 'commande au catalogue', feature: 'catalogo_checkout' }, { text: 'peut vous écrire', feature: 'contatto_whatsapp' }],
    },
    priority: { level: 'A', reason: 'Vend à distance par chat.' }, confidence: 'alta', toVerify: [],
    ...over,
  };
}

test.describe('growth engine copy', () => {
  test('the storefront copy of the engine is in step with growth/src', () => {
    const res = spawnSync(process.execPath, [join(REPO, 'growth/scripts/sync-engine.mjs'), '--check'], { encoding: 'utf8' });
    expect(res.status, `${res.stderr} — run node growth/scripts/sync-engine.mjs`).toBe(0);
  });

  test('outcome types are the CLI ones', () => {
    const store = readFileSync(join(REPO, 'growth/src/store.mjs'), 'utf8');
    const list = /OUTCOME_TYPES = \[([^\]]+)\]/.exec(store)?.[1]?.split(',').map((s) => s.trim().replace(/'/g, ''));
    expect(list).toEqual([...TOUCH_OUTCOMES]);
  });

  test('the same engine qualifies the dossier and lints an edited message', () => {
    const ev = evaluateDossier(dossier(), '2026-11-15');
    expect(ev.errors).toEqual([]);
    expect(ev.status).toBe('pronta');
    const d = dossier();
    expect(lintMessageText(d, `${d.message.text} Vous allez doubler vos ventes ?`, 'whatsapp').some((e) => /punti interrogativi/.test(e))).toBe(true);
    expect(lintMessageText(d, withOptOut(d.message.text, 'fr'), 'whatsapp')).toEqual([]);
    expect(strongIdentityKeys(d)).toEqual(['dom:mamakoko.example', 'tel:0612345678']);
    expect(strongIdentityKeys(dossier({ phones: ['+33 6 12 34 56 78'] }))).toEqual(strongIdentityKeys(d));
  });
});

test.describe('contact policy', () => {
  const ctx = (over: Partial<WhatsAppContext> = {}): WhatsAppContext => ({
    country: 'FR', doNotContact: false, stage: 'da_contattare', touches: 0, whatsappTouches: 0, whatsappSentToday: 0, chatOrdersConfirmed: false, ...over,
  });

  test('opt-out sentence is added once, in the message language', () => {
    const once = withOptOut('Bonjour ?', 'fr');
    expect(hasOptOut(once)).toBe(true);
    expect(withOptOut(once, 'fr')).toBe(once);
    expect(withOptOut('Buongiorno?', 'it')).toMatch(/non vi scriverò più/);
  });

  test('phone numbers become wa.me digits; fixed lines have no WhatsApp', () => {
    expect(internationalDigits('06 05 75 07 42', 'FR')).toBe('33605750742');
    expect(internationalDigits('+33 9 82 76 74 14', 'FR')).toBe('33982767414');
    expect(internationalDigits('0039 333 1112223', 'IT')).toBe('393331112223');
    expect(internationalDigits('333 1112223', 'IT')).toBe('393331112223');
    expect(internationalDigits('123', 'FR')).toBeNull();
    expect(isLikelyMobile('33605750742')).toBe(true);
    expect(isLikelyMobile('33982767414')).toBe(false);
    expect(whatsappLink('33605750742', 'Bonjour à vous ?')).toBe('https://wa.me/33605750742?text=Bonjour%20%C3%A0%20vous%20%3F');
  });

  test('WhatsApp: cold message in France only, never after a refusal or a do-not-contact', () => {
    expect(whatsappDecision(ctx()).allowed).toBe(true);
    expect(whatsappDecision(ctx({ country: 'IT' })).allowed).toBe(false);
    expect(whatsappDecision(ctx({ country: 'IT', touches: 1 })).allowed).toBe(true);
    expect(whatsappDecision(ctx({ doNotContact: true })).allowed).toBe(false);
    expect(whatsappDecision(ctx({ stage: 'perso' })).allowed).toBe(false);
    expect(whatsappDecision(ctx({ stage: 'cliente' })).allowed).toBe(false);
    const warned = whatsappDecision(ctx({ chatOrdersConfirmed: true, whatsappTouches: 2, whatsappSentToday: WHATSAPP_DAILY_SOFT_LIMIT }));
    expect(warned.allowed).toBe(true);
    expect(warned.warnings).toHaveLength(3);
  });

  test('stage follows the outcome and never goes backwards', () => {
    expect(stageAfterTouch('da_contattare', 'contattato')).toBe('contattato');
    expect(stageAfterTouch('demo', 'contattato')).toBe('demo');
    expect(stageAfterTouch('contattato', 'risposta')).toBe('in_conversazione');
    expect(stageAfterTouch('demo', 'risposta')).toBe('demo');
    expect(stageAfterTouch('in_conversazione', 'rifiuto')).toBe('perso');
    expect(stageAfterTouch('perso', 'nessuna_risposta')).toBe('perso');
    expect(stageAfterTouch('perso', 'risposta')).toBe('in_conversazione');
    expect(stageAfterTouch('demo', 'tenant_pagante')).toBe('cliente');
    expect(stageAfterTouch('cliente', 'rifiuto')).toBe('cliente');
  });

  test('a refusal needs a reason; « do not contact » goes with a refusal', () => {
    const parse = (body: unknown) => touchSchema.parse(body);
    expect(touchIssues(parse({ channel: 'visita', outcome: 'rifiuto' }))).toEqual(['Indiquez le motif du refus.']);
    expect(touchIssues(parse({ channel: 'visita', outcome: 'contattato', doNotContact: true }))).toHaveLength(1);
    expect(touchIssues(parse({ channel: 'visita', outcome: 'rifiuto', reason: 'Pas le temps', doNotContact: true }))).toEqual([]);
  });
});

test.describe('worklist', () => {
  const row = (over: Partial<GrowthProspectRow>): GrowthProspectRow => ({
    status: 'pronta', separate_segment: false, sales_stage: 'da_contattare', next_action_at: null, do_not_contact: false,
    priority: 'B', fit_score: 60, name: 'X', ...over,
  } as GrowthProspectRow);
  const now = new Date('2026-11-15T10:00:00Z');

  test('today = ready shops never contacted + due follow-ups; excluded shops only in their view', () => {
    const rows = [
      row({ name: 'Prête' }),
      row({ name: 'Relance due', sales_stage: 'contattato', next_action_at: '2026-11-14T08:00:00Z' }),
      row({ name: 'Relance future', sales_stage: 'contattato', next_action_at: '2026-11-20T08:00:00Z' }),
      row({ name: 'Exclue', do_not_contact: true }),
      row({ name: 'Autre segment', separate_segment: true }),
      row({ name: 'À cultiver', status: 'da_coltivare' }),
    ];
    expect(rows.filter((r) => inView(r, 'aujourdhui', now)).map((r) => r.name)).toEqual(['Prête', 'Relance due']);
    expect(rows.filter((r) => inView(r, 'exclues', now)).map((r) => r.name)).toEqual(['Exclue']);
    expect(viewCounts(rows, now)).toEqual({ aujourdhui: 2, 'en-cours': 2, 'a-cultiver': 1, toutes: 6, exclues: 1 });
    expect(sortWorklist([row({ name: 'B', priority: 'B' }), row({ name: 'A', priority: 'A' }), rows[1]!], now).map((r) => r.name)).toEqual(['Relance due', 'A', 'B']);
  });
});

test.describe('import', () => {
  test('token: unset or short disables, wrong denies', () => {
    const previous = process.env.GROWTH_INGEST_TOKEN;
    try {
      delete process.env.GROWTH_INGEST_TOKEN;
      expect(growthIngestAuthorized('Bearer x')).toBe('disabled');
      process.env.GROWTH_INGEST_TOKEN = 'a'.repeat(40);
      expect(growthIngestAuthorized('Bearer b')).toBe('denied');
      expect(growthIngestAuthorized(null)).toBe('denied');
      expect(growthIngestAuthorized(`Bearer ${'a'.repeat(40)}`)).toBe('ok');
    } finally {
      if (previous === undefined) delete process.env.GROWTH_INGEST_TOKEN; else process.env.GROWTH_INGEST_TOKEN = previous;
    }
  });

  test('shape check: version, ids, dates, duplicates', () => {
    const p = { id: 'mama-koko--lyon', dossier: dossier(), runs: ['r1'], firstSeen: '2026-11-14', lastSeen: '2026-11-15' };
    expect(parseIngestBody({ version: 1, prospects: [p] }).prospects).toHaveLength(1);
    expect(() => parseIngestBody({ version: 2, prospects: [p] })).toThrow('invalid_body');
    expect(() => parseIngestBody({ version: 1, prospects: [p, p] })).toThrow('invalid_prospect');
    expect(() => parseIngestBody({ version: 1, prospects: [{ ...p, id: 'Bad Id' }] })).toThrow('invalid_prospect');
    expect(() => parseIngestBody({ version: 1, prospects: [{ ...p, firstSeen: 'hier' }] })).toThrow('invalid_prospect');
  });

  test('re-validates every dossier, never writes sales fields, honours the suppression list', async () => {
    const upserts: Record<string, unknown>[][] = [];
    const db = {
      from(table: string) {
        if (table === 'growth_suppressions') return { select: async () => ({ data: [{ identity_key: 'tel:0699999999' }], error: null }) };
        return { upsert: async (rows: Record<string, unknown>[]) => { upserts.push(rows); return { error: null }; } };
      },
    };
    const ok = { id: 'mama-koko--lyon', dossier: dossier(), runs: ['r1'], firstSeen: '2026-11-14', lastSeen: '2026-11-15' };
    const bad = { ...ok, id: 'sans-source--lyon', dossier: dossier({ evidence: [] }) };
    const suppressed = { ...ok, id: 'autre-nom--lyon', dossier: dossier({ name: 'Autre nom', links: {}, phones: ['06 99 99 99 99'] }) };
    const result = await ingestGrowthProspects({ version: 1, prospects: [ok, bad, suppressed] }, db, '2026-11-15');
    expect(result.imported).toBe(2);
    expect(result.rejected.map((r) => r.id)).toEqual(['sans-source--lyon']);
    expect(result.suppressed).toEqual(['autre-nom--lyon']);
    expect(result.suppressionKeys).toEqual(['tel:0699999999']);
    const all = upserts.flat();
    for (const r of all) for (const key of ['sales_stage', 'next_action_at', 'last_contact_at', 'message_draft']) expect(r).not.toHaveProperty(key);
    expect(all.find((r) => r.id === 'mama-koko--lyon')).not.toHaveProperty('do_not_contact');
    expect(all.find((r) => r.id === 'autre-nom--lyon')).toMatchObject({ do_not_contact: true });
    expect(all.find((r) => r.id === 'mama-koko--lyon')).toMatchObject({ status: 'pronta', fit_score: 70, country: 'FR' });
  });
});

test.describe('access', () => {
  const routes = ['src/app/api/admin/platform/prospection/[id]/route.ts', 'src/app/api/admin/platform/prospection/[id]/touches/route.ts'];

  test('admin APIs and pages are platform-owner only and absent from the tenant permission map', () => {
    for (const file of [...routes, 'src/app/admin/(protected)/platform/prospection/page.tsx', 'src/app/admin/(protected)/platform/prospection/[id]/page.tsx']) {
      expect(readFileSync(join(ROOT, file), 'utf8'), file).toMatch(/requirePlatformOwner\(\)/);
    }
    expect(permissionForAdminApi('/api/admin/platform/prospection/x', 'PATCH')).toBeNull();
    expect(permissionForAdminApi('/api/admin/platform/prospection/x/touches', 'POST')).toBeNull();
    const development = PLATFORM_NAV.find((g) => g.id === 'development');
    expect(development?.children?.some((c) => c.href === '/admin/platform/prospection')).toBe(true);
  });

  test('the import route takes only its bearer token, and growth data stays out of git', () => {
    const route = readFileSync(join(ROOT, 'src/app/api/internal/growth/ingest/route.ts'), 'utf8');
    expect(route).toMatch(/growthIngestAuthorized/);
    expect(route).not.toMatch(/requirePlatformOwner|SUPABASE_SERVICE_ROLE_KEY/);
    expect(readFileSync(join(REPO, '.gitignore'), 'utf8')).toMatch(/^growth\/data\/$/m);
  });
});
