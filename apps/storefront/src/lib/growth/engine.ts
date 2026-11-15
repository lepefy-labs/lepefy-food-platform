/**
 * Typed facade over the growth engine copied from growth/src by
 * growth/scripts/sync-engine.mjs (tests/unit/growthProspecting.spec.ts fails
 * when the copy is stale). Pure: safe on the server and in the browser.
 */
import { evaluate as evaluateJs, lintMessage as lintJs, deriveSignals as deriveJs, CHANNELS as CHANNELS_JS } from './engine/qualify.mjs';
import { identityKeys as identityKeysJs } from './engine/identity.mjs';
import featuresFile from './engine/features.json';
import type { GrowthDossier, GrowthEvaluation } from './types';

export const GROWTH_FEATURES: Record<string, { label: string; fonte: string; demo: string }> = featuresFile.features;
export const GROWTH_KNOWN_LIMITS: string[] = featuresFile.limitiNoti;
export const MESSAGE_CHANNEL_LIMITS: Record<string, number> = CHANNELS_JS;

/** Segment the CLI runs target by default (growth/config/default.json). */
export const DEFAULT_TARGET_SEGMENT = 'boutique-alimentare-africana';

export function evaluateDossier(dossier: GrowthDossier, today: string, targetSegment = DEFAULT_TARGET_SEGMENT): GrowthEvaluation {
  return evaluateJs(dossier, { features: GROWTH_FEATURES, today, targetSegment }) as GrowthEvaluation;
}

/** Re-checks an edited message text against the dossier's declared claims, for a given channel. */
export function lintMessageText(dossier: GrowthDossier, text: string, channel: string): string[] {
  const edited = { ...dossier, message: { ...dossier.message, text, channel } };
  return lintJs(edited, deriveJs(dossier), GROWTH_FEATURES) as string[];
}

/** Strong identity keys only (domain, social handle, phone, VAT): never merge or suppress on a name. */
export function strongIdentityKeys(dossier: GrowthDossier): string[] {
  const keys = identityKeysJs(dossier) as { strong: string[] };
  return [...keys.strong].sort();
}
