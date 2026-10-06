import { z } from 'zod';

/**
 * Catalogue des règles déterministes WhatsApp (codes = CHECK SQL de
 * whatsapp_automation_rules). Le code ne contient aucun contenu propre à un
 * tenant : les données (horaires, adresse, livraison, catalogue, commandes)
 * viennent toujours du système Lepefy ; la configuration d'une règle ne porte
 * que des textes d'accueil optionnels ou des options d'affichage.
 * Ligne absente = valeurs par défaut ci-dessous.
 */

export const RULE_CODES = [
  'greeting', 'opening_hours', 'location', 'shipping', 'order_status',
  'tracking', 'catalog', 'product_availability', 'human_handoff',
] as const;
export type RuleCode = (typeof RULE_CODES)[number];

const optionalText = (max: number) => z.string().trim().max(max).optional().transform((value) => value || undefined);

export const RULE_CONFIG_SCHEMAS = {
  greeting: z.object({ message: optionalText(600) }).strict(),
  opening_hours: z.object({}).strict(),
  location: z.object({}).strict(),
  shipping: z.object({ extra_note: optionalText(400) }).strict(),
  order_status: z.object({}).strict(),
  tracking: z.object({}).strict(),
  catalog: z.object({
    path: z.string().trim().max(120).regex(/^\/[A-Za-z0-9/_-]*$/, 'Chemin relatif attendu (ex. /products).').optional(),
  }).strict(),
  product_availability: z.object({ include_link: z.boolean().optional() }).strict(),
  human_handoff: z.object({ message: optionalText(400) }).strict(),
} satisfies Record<RuleCode, z.ZodTypeAny>;

export type RuleConfig<C extends RuleCode> = z.infer<(typeof RULE_CONFIG_SCHEMAS)[C]>;

export interface RuleDefinition {
  code: RuleCode;
  label: string;
  description: string;
  defaultPriority: number;
}

export const RULE_DEFINITIONS: readonly RuleDefinition[] = [
  { code: 'human_handoff', label: 'Passage à un opérateur', description: 'Demande explicite, réclamation, paiement problématique ou commande non reçue : l’automatisation se met en pause et l’équipe reprend.', defaultPriority: 10 },
  { code: 'order_status', label: 'Statut de commande', description: 'Uniquement si le numéro WhatsApp correspond à un client connu ; données minimales (étape, référence).', defaultPriority: 20 },
  { code: 'tracking', label: 'Suivi de colis', description: 'Dernier état transporteur enregistré par Lepefy, sans appel au transporteur.', defaultPriority: 25 },
  { code: 'product_availability', label: 'Disponibilité produit', description: 'Stock réel du catalogue, seulement sur une correspondance sans ambiguïté.', defaultPriority: 30 },
  { code: 'opening_hours', label: 'Horaires', description: 'Horaires configurés dans Paramètres › Retrait.', defaultPriority: 40 },
  { code: 'location', label: 'Adresse', description: 'Adresse de retrait configurée dans Paramètres › Retrait.', defaultPriority: 45 },
  { code: 'shipping', label: 'Livraison', description: 'Mode de livraison réel du tenant ; aucun tarif inventé.', defaultPriority: 50 },
  { code: 'catalog', label: 'Catalogue', description: 'Lien vers la boutique en ligne du tenant.', defaultPriority: 60 },
  { code: 'greeting', label: 'Message d’accueil', description: 'Envoyé au premier message d’une nouvelle conversation.', defaultPriority: 90 },
];

export interface AutomationRuleRow {
  code: string;
  enabled: boolean;
  priority: number;
  configuration: unknown;
}

export interface ResolvedRule {
  code: RuleCode;
  enabled: boolean;
  priority: number;
  configuration: Record<string, unknown>;
  customized: boolean;
}

export function isRuleCode(value: unknown): value is RuleCode {
  return typeof value === 'string' && (RULE_CODES as readonly string[]).includes(value);
}

/** Valide une configuration ; null si invalide. */
export function parseRuleConfig(code: RuleCode, configuration: unknown): Record<string, unknown> | null {
  const parsed = RULE_CONFIG_SCHEMAS[code].safeParse(configuration ?? {});
  return parsed.success ? parsed.data as Record<string, unknown> : null;
}

/**
 * Fusionne les lignes du tenant avec les défauts. Une configuration devenue
 * invalide (ancienne version) est ignorée — la règle garde ses défauts.
 */
export function resolveRules(rows: AutomationRuleRow[]): ResolvedRule[] {
  const byCode = new Map(rows.filter((row) => isRuleCode(row.code)).map((row) => [row.code as RuleCode, row]));
  return RULE_DEFINITIONS.map((definition) => {
    const row = byCode.get(definition.code);
    return {
      code: definition.code,
      enabled: row ? row.enabled : true,
      priority: row ? row.priority : definition.defaultPriority,
      configuration: (row && parseRuleConfig(definition.code, row.configuration)) ?? {},
      customized: Boolean(row),
    };
  }).sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code));
}

export const rulesUpdateSchema = z.object({
  rules: z.array(z.object({
    code: z.enum(RULE_CODES),
    enabled: z.boolean(),
    priority: z.number().int().min(0).max(1000),
    configuration: z.record(z.unknown()).default({}),
  }).strict()).min(1).max(RULE_CODES.length),
}).strict();
