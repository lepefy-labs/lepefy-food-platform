import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import {
  buildNalaResponseMemorySignature,
  canPersistNalaResponseMemory,
  isNalaResponseMemoryContextFresh,
  scoreNalaResponseMemoryCandidate,
} from '../../src/lib/ai/nalaResponseMemory';
import type { NalaDecision } from '../../src/lib/ai/core/nalaDecision';

const productInfoDecision: NalaDecision = {
  intent: 'product_information',
  commerceMode: 'none',
  confidence: 0.9,
  subject: { type: 'product', name: 'Safou' },
  entities: { dish: null, product: 'Safou' },
  pendingAction: null,
};

function fingerprint(params: {
  tenantVersion: string;
  knowledgeRevision: string;
  productVersions: Record<string, string>;
  kbVersions: Record<string, string>;
}) {
  return createHash('sha256').update(JSON.stringify({
    tenantVersion: params.tenantVersion,
    knowledgeRevision: params.knowledgeRevision,
    productVersions: Object.fromEntries(Object.entries(params.productVersions).sort(([a], [b]) => a.localeCompare(b))),
    kbVersions: Object.fromEntries(Object.entries(params.kbVersions).sort(([a], [b]) => a.localeCompare(b))),
  })).digest('hex');
}

test('Response Memory canonicalizes close recipe paraphrases without an embedding', () => {
  const source = buildNalaResponseMemorySignature('Recette du ndolè');
  const query = buildNalaResponseMemorySignature('Comment préparer le ndolé ?');
  expect(source.family).toBe('recipe');
  expect(query.family).toBe('recipe');
  expect(source.terms).toEqual(['recipe', 'ndole']);
  expect(query.terms).toEqual(['recipe', 'ndole']);
  expect(scoreNalaResponseMemoryCandidate(query, {
    query_family: source.family,
    normalized_query: source.normalizedQuery,
    query_terms: source.terms,
    subject_key: 'ndole',
  })).toBe(1);
});

test('Response Memory refuses same subject with a different question family', () => {
  const recipe = buildNalaResponseMemorySignature('Comment préparer le safou ?');
  const storage = buildNalaResponseMemorySignature('Comment conserver le safou ?');
  expect(recipe.family).toBe('recipe');
  expect(storage.family).toBe('storage');
  expect(scoreNalaResponseMemoryCandidate(storage, {
    query_family: recipe.family,
    normalized_query: recipe.normalizedQuery,
    query_terms: recipe.terms,
    subject_key: 'safou',
  })).toBe(0);
});

test('Response Memory stores only safe context-independent commerce decisions', () => {
  expect(canPersistNalaResponseMemory({
    message: "C'est quoi le safou ?",
    reply: 'Le safou est un fruit africain.',
    decision: productInfoDecision,
    cartPlan: null,
    hadPendingAction: false,
    sourceProvider: 'gemini',
  })).toBe(true);

  expect(canPersistNalaResponseMemory({
    message: "C'est quoi le safou ?",
    reply: 'Il coûte 5 €.',
    decision: productInfoDecision,
    cartPlan: null,
    hadPendingAction: false,
    sourceProvider: 'gemini',
  })).toBe(false);

  expect(canPersistNalaResponseMemory({
    message: 'Où est ma commande ABCD1234 ?',
    reply: 'Votre commande arrive demain.',
    decision: { ...productInfoDecision, intent: 'order_help' },
    cartPlan: null,
    hadPendingAction: false,
    sourceProvider: 'gemini',
  })).toBe(false);

  expect(canPersistNalaResponseMemory({
    message: "C'est quoi le safou ?",
    reply: 'Le safou est un fruit africain.',
    decision: productInfoDecision,
    cartPlan: null,
    hadPendingAction: false,
    sourceProvider: 'lepefy',
  })).toBe(false);
});

test('Response Memory invalidates learned answers when authoritative context changes', () => {
  const tenantVersion = '2026-09-04T10:00:00.000Z';
  const knowledgeRevision = '2:2026-09-04T09:00:00.000Z';
  const productVersions = { '11111111-1111-4111-8111-111111111111': '2026-09-04T08:00:00.000Z' };
  const kbVersions = { '22222222-2222-4222-8222-222222222222': '2026-09-04T09:00:00.000Z' };
  const row = {
    tenant_version: tenantVersion,
    knowledge_revision: knowledgeRevision,
    context_product_versions: productVersions,
    context_kb_versions: kbVersions,
    context_fingerprint: fingerprint({ tenantVersion, knowledgeRevision, productVersions, kbVersions }),
  };
  const current = { tenantVersion, knowledgeRevision, productVersions, kbVersions };

  expect(isNalaResponseMemoryContextFresh(row, current)).toBe(true);
  expect(isNalaResponseMemoryContextFresh(row, {
    ...current,
    productVersions: { ...productVersions, '11111111-1111-4111-8111-111111111111': '2026-09-04T10:30:00.000Z' },
  })).toBe(false);
  expect(isNalaResponseMemoryContextFresh(row, {
    ...current,
    knowledgeRevision: '3:2026-09-04T11:00:00.000Z',
  })).toBe(false);
});
