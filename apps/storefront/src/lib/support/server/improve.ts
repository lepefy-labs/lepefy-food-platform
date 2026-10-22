import 'server-only';
import { assertAiRouteReady, runAi } from '@/lib/ai/core/aiGateway';
import { checkRateLimit } from '@/lib/ai/usageTracking';
import { SUPPORT_LIMITS } from '../domain';
import { cleanMessageBody, suggestionKeepsFacts } from '../rules';

/**
 * « Améliorer mon message »: optional rewording through the existing AI
 * gateway (policy support / structured_chat, migration 163). It never sends
 * anything: the shop sees the suggestion and chooses. Daily admin quota of
 * the tenant (check_ai_rate_limit), timeout of the route (≤ 12 s).
 */

export const SUPPORT_AI_CONSUMER = 'support';
export const SUPPORT_AI_CAPABILITY = 'structured_chat';
export const SUPPORT_AI_ENDPOINT = 'support-improve-message';

const SYSTEM = `Tu aides le commerçant d'une boutique en ligne à écrire un message clair à l'équipe technique de sa plateforme.
Reformule son message en français simple, poli et précis, en gardant la première personne.
Règles strictes :
- garde exactement le même sens et les mêmes faits ; n'ajoute aucun détail, aucune cause, aucune solution, aucune hypothèse ;
- garde tels quels les noms, nombres, références, dates, montants et noms de pages ;
- si une information manque, ne l'invente pas ;
- pas de formule d'introduction ni de signature, pas de mise en forme Markdown ;
- au plus 1 200 caractères.
Réponds uniquement avec l'objet JSON demandé.`;

export async function isImproveAvailable(): Promise<boolean> {
  try {
    await assertAiRouteReady(SUPPORT_AI_CONSUMER, SUPPORT_AI_CAPABILITY);
    return true;
  } catch {
    return false;
  }
}

export type ImproveResult = { ok: true; text: string } | { ok: false; status: number; error: string };

export async function improveSupportMessage(tenantId: string, raw: string): Promise<ImproveResult> {
  const text = cleanMessageBody(raw);
  if (text.length < SUPPORT_LIMITS.improveMinChars) return { ok: false, status: 400, error: 'Écrivez d’abord quelques mots.' };
  if (text.length > SUPPORT_LIMITS.improveMaxChars) return { ok: false, status: 400, error: 'Message trop long pour une suggestion.' };
  if (!(await checkRateLimit(tenantId, SUPPORT_AI_ENDPOINT, false))) {
    return { ok: false, status: 429, error: 'Suggestions épuisées pour aujourd’hui. Votre message peut être envoyé tel quel.' };
  }
  try {
    const response = await runAi<{ text: string }>({
      tenantId,
      endpoint: SUPPORT_AI_ENDPOINT,
      consumer: SUPPORT_AI_CONSUMER,
      capability: SUPPORT_AI_CAPABILITY,
      request: {
        system: SYSTEM,
        messages: [{ role: 'user', content: `Message du commerçant :\n"""\n${text}\n"""` }],
        responseSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        validate: (value) => {
          const candidate = cleanMessageBody((value as { text?: unknown } | null)?.text);
          if (!candidate || candidate.length > Math.max(1_500, text.length * 2)) throw new Error('invalid_suggestion');
          return { text: candidate };
        },
        temperature: 0.2,
        maxOutputTokens: 700,
      },
    });
    const suggestion = response.structured.text;
    if (!suggestionKeepsFacts(text, suggestion)) {
      return { ok: false, status: 422, error: 'Aucune suggestion fiable pour ce message. Vous pouvez l’envoyer tel quel.' };
    }
    return { ok: true, text: suggestion };
  } catch (error) {
    console.error('[support] improve unavailable:', error instanceof Error ? error.name : 'unknown');
    return { ok: false, status: 503, error: 'Suggestion indisponible pour le moment. Votre message peut être envoyé tel quel.' };
  }
}
