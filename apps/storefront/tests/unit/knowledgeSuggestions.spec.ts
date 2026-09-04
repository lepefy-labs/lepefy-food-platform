import { test, expect } from '@playwright/test';
import {
  buildKnowledgeBaseSuggestions,
  knowledgeSuggestionSource,
  type KnowledgeSuggestionInteractionRow,
} from '../../src/lib/admin/knowledgeSuggestions';

function row(overrides: Partial<KnowledgeSuggestionInteractionRow> = {}): KnowledgeSuggestionInteractionRow {
  return {
    id: crypto.randomUUID(),
    message_text: 'Comment préparer le ndolè ?',
    reply_text: 'Le ndolè se prépare avec des feuilles amères, des arachides et un accompagnement selon la recette.',
    intent: 'recipe',
    knowledge_status: 'missing',
    retrieval_quality: 'empty',
    requested_product_text: null,
    semantic_enrichment_status: 'completed',
    outcome: 'answered',
    created_at: '2026-09-04T00:00:00.000Z',
    ...overrides,
  };
}

test('knowledge suggestions stay review-only and map stable intents to a category', () => {
  const suggestions = buildKnowledgeBaseSuggestions({ rows: [row()] });

  expect(suggestions).toHaveLength(1);
  expect(suggestions[0]).toMatchObject({
    intent: 'recipe',
    category: 'recipe',
    occurrenceCount: 1,
    questionPreview: 'Comment préparer le ndolè ?',
  });
  expect(suggestions[0]?.signals).toEqual(['knowledge_missing', 'retrieval_empty']);
});

test('same derived topic is grouped and an already-approved source suppresses the proposal', () => {
  const rows = [
    row({
      intent: 'product_information',
      message_text: 'Comment utiliser le manioc ?',
      reply_text: 'Le manioc peut être préparé de plusieurs façons selon le produit.',
      requested_product_text: 'manioc',
      created_at: '2026-09-04T00:00:00.000Z',
    }),
    row({
      intent: 'product_information',
      message_text: 'Que peut-on faire avec du manioc ?',
      reply_text: 'Le manioc peut être préparé de plusieurs façons selon le produit.',
      requested_product_text: 'Manioc',
      retrieval_quality: 'weak',
      created_at: '2026-09-03T00:00:00.000Z',
    }),
  ];

  const [suggestion] = buildKnowledgeBaseSuggestions({ rows });
  expect(suggestion?.occurrenceCount).toBe(2);
  expect(suggestion?.category).toBe('faq');

  const suppressed = buildKnowledgeBaseSuggestions({
    rows,
    existingSources: suggestion ? [knowledgeSuggestionSource(suggestion.key)] : [],
  });
  expect(suppressed).toEqual([]);
});

test('sensitive support intents and rows containing personal identifiers never become review drafts', () => {
  const suggestions = buildKnowledgeBaseSuggestions({
    rows: [
      row({
        intent: 'order_help',
        message_text: 'Où est ma commande 123456 ?',
        reply_text: 'Votre commande est en cours.',
      }),
      row({
        intent: 'store_information',
        message_text: 'Pouvez-vous me répondre à client@example.com ?',
        reply_text: 'La boutique est ouverte aujourd’hui.',
      }),
      row({
        intent: 'delivery',
        message_text: 'Livrez-vous à Lyon ?',
        reply_text: 'Appelez le +33 6 12 34 56 78 pour organiser la livraison.',
      }),
    ],
  });

  expect(suggestions).toEqual([]);
});

test('rows without a real knowledge/retrieval gap are ignored', () => {
  const suggestions = buildKnowledgeBaseSuggestions({
    rows: [row({ knowledge_status: 'sufficient', retrieval_quality: 'strong' })],
  });

  expect(suggestions).toEqual([]);
});
