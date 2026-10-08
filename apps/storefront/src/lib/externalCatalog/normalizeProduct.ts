import { computeQuantityRuleState } from '../purchaseQuantityRules';
import { extractQuantityInfo } from './quantityParser';
import type {
  ExternalCatalogProviderId,
  ExternalProductReviewDecision,
  NormalizedExternalImage,
  NormalizedExternalProduct,
  QuantityExtraction,
  RawExternalProduct,
  ReviewReason,
} from './types';

/**
 * Normalizzazione provider-indipendente: dato sorgente → forma Lepefy, con
 * inferenze esplicitamente marcate. Nessun valore viene inventato: un campo
 * assente resta `null` e genera un motivo di revisione.
 */

/**
 * Scala del campo `price` di GREEN-API: millesimi della valuta (come il
 * `priceAmount1000` di WhatsApp). Verificato sul primo catalogo reale
 * (8/10/2026): "10000" = 10,00 EUR per "3 paquets de 500g". La documentazione
 * GREEN-API ("85000" = 850.00 EUR, cioè ÷100) è in contraddizione con i dati.
 */
export const GREEN_API_PRICE_MINOR_UNIT_DIVISOR = 1000;

export interface ParsedPrice {
  value: number | null;
  issue: 'missing' | 'invalid' | null;
}

export function parseMinorUnitPrice(raw: string | number | null | undefined, divisor = GREEN_API_PRICE_MINOR_UNIT_DIVISOR): ParsedPrice {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return { value: null, issue: 'missing' };
  }
  const text = typeof raw === 'number' ? String(raw) : raw.trim();
  // Solo interi: una stringa con separatori o simboli non è nel formato documentato.
  if (!/^\d{1,12}$/.test(text)) return { value: null, issue: 'invalid' };
  const minor = Number(text);
  if (!Number.isSafeInteger(minor) || minor <= 0) return { value: null, issue: 'invalid' };
  return { value: Math.round((minor / divisor) * 100) / 100, issue: null };
}

export function normalizeProductName(name: string | null): string | null {
  if (!name) return null;
  const n = name.normalize('NFC').replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();
  return n.length > 0 ? n : null;
}

function cleanText(text: string | null): string | null {
  if (text === null || text === undefined) return null;
  return text.trim().length > 0 ? text : null;
}

function normalizeImages(raw: RawExternalProduct): NormalizedExternalImage[] {
  const out: NormalizedExternalImage[] = [];
  const seen = new Set<string>();
  for (const img of raw.images) {
    const original = img.originalUrl?.trim() || null;
    const preview = img.previewUrl?.trim() || null;
    const url = original ?? preview;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      provider_image_id: img.providerImageId,
      url,
      variant: original ? 'original' : 'preview',
      original_url: original,
      preview_url: preview,
    });
  }
  return out;
}

export interface NormalizeContext {
  provider: ExternalCatalogProviderId;
  catalogId: string;
  rawFile: string;
  /** Estrattore alternativo (futuro AI); default deterministico. */
  extraction?: QuantityExtraction;
}

export function normalizeExternalProduct(raw: RawExternalProduct, ctx: NormalizeContext): NormalizedExternalProduct {
  const originalName = cleanText(raw.name);
  const originalDescription = cleanText(raw.description);
  const extraction = ctx.extraction ?? extractQuantityInfo({ name: originalName, description: originalDescription });

  const reasons: ReviewReason[] = [...extraction.reasons];
  const blocking = new Set<ReviewReason['code']>();

  if (!originalName) {
    reasons.push({ code: 'NAME_MISSING', message: 'Nome prodotto assente nella sorgente.' });
    blocking.add('NAME_MISSING');
  }
  if (!originalDescription) {
    reasons.push({ code: 'NO_DESCRIPTION', message: 'Descrizione assente: inferenza basata solo sul nome (se presente).' });
  }

  const price = parseMinorUnitPrice(raw.rawPrice);
  if (price.issue === 'missing') {
    reasons.push({ code: 'PRICE_MISSING', message: 'Prezzo non indicato dal catalogo.' });
    blocking.add('PRICE_MISSING');
  } else if (price.issue === 'invalid') {
    reasons.push({ code: 'PRICE_INVALID', message: `Prezzo non interpretabile ("${String(raw.rawPrice)}"): nessun valore impostato.` });
    blocking.add('PRICE_INVALID');
  }
  const currency = raw.currency && /^[A-Z]{3}$/.test(raw.currency.trim()) ? raw.currency.trim() : null;
  if (price.value !== null && !currency) {
    reasons.push({ code: 'CURRENCY_MISSING', message: 'Valuta assente o non valida: il prezzo non è utilizzabile senza conferma.' });
    blocking.add('CURRENCY_MISSING');
  }

  const images = normalizeImages(raw);
  if (images.length === 0) {
    reasons.push({ code: 'NO_IMAGE', message: 'Nessuna immagine fornita dal catalogo.' });
  }
  if (raw.isHidden === true) {
    reasons.push({ code: 'PRODUCT_HIDDEN', message: 'Prodotto nascosto nel catalogo sorgente.' });
  }
  const availability = raw.availability?.trim() || null;
  if (availability && !/^in[\s_]?stock$/i.test(availability)) {
    reasons.push({ code: 'NOT_IN_STOCK', message: `Disponibilità dichiarata: ${availability}.` });
  }

  const requiresReview = extraction.selling_model !== 'single_item' || blocking.size > 0 || extraction.confidence === 'low';

  return {
    source_provider: ctx.provider,
    source_catalog_id: ctx.catalogId,
    source_product_id: raw.providerProductId,
    source_url: raw.url,
    original_name: originalName,
    normalized_name: normalizeProductName(originalName),
    original_description: originalDescription,
    displayed_price: price.value,
    sale_price: parseMinorUnitPrice(raw.rawSalePrice).value,
    currency,
    images,
    product_availability: availability,
    suggested_min_quantity: extraction.suggested_min_quantity,
    suggested_quantity_step: extraction.suggested_quantity_step,
    unit_format: extraction.unit_format,
    package_count: extraction.package_count,
    package_total_weight: extraction.package_total,
    selling_model: extraction.selling_model,
    extraction_confidence: extraction.confidence,
    review_reasons: reasons,
    requires_review: requiresReview,
    inference: {
      matches: extraction.matches,
      source_field: extraction.source_field,
      extractor: extraction.extractor,
      min_is_explicit: extraction.min_is_explicit,
    },
    raw_data_reference: { file: ctx.rawFile, page: raw.rawRef.page, index: raw.rawRef.index },
  };
}

/**
 * Ponte verso le regole di quantità Lepefy (`products.min_order_quantity` /
 * `order_quantity_step`, migration 121): restituisce la regola SOLO da valori
 * confermati in revisione; un'inferenza non confermata produce il default 1/1.
 * Usa lo stesso motore (`computeQuantityRuleState`) per la normalizzazione,
 * così nessuna seconda logica commerciale viene introdotta.
 */
export function toLepefyQuantityRule(decision: ExternalProductReviewDecision | null | undefined): {
  min_order_quantity: number;
  order_quantity_step: number;
  from_confirmed_review: boolean;
} {
  const minimum = decision?.min_quantity_confirmed && decision.min_quantity ? decision.min_quantity : 1;
  const step = decision?.quantity_step_confirmed && decision.quantity_step ? decision.quantity_step : 1;
  const state = computeQuantityRuleState(minimum, minimum, step);
  return {
    min_order_quantity: state.minimumQuantity,
    order_quantity_step: state.step,
    from_confirmed_review: Boolean(decision?.min_quantity_confirmed || decision?.quantity_step_confirmed),
  };
}

/** Prime quantità valide secondo la regola Lepefy, per l'anteprima in revisione. */
export function previewValidQuantities(minimum: number, step: number, count = 4): number[] {
  const out: number[] = [];
  let q = computeQuantityRuleState(0, minimum, step).nextValidQuantity;
  const s = computeQuantityRuleState(q, minimum, step).step;
  for (let i = 0; i < count; i++) { out.push(q); q += s; }
  return out;
}
