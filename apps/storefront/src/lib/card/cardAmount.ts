/**
 * Saisie du montant libre de /card. Champ texte + clavier décimal (jamais
 * `type="number"`, qui rejette « 12,50 » dans plusieurs navigateurs et laisse
 * le champ vide) : virgule et point acceptés, un seul séparateur, 2 décimales.
 * Les bornes (1–2 000) restent vérifiées par CardQuickPay et par l'API.
 * Pur, testé dans tests/unit/cardLanding.spec.ts.
 */
const MAX_INTEGER_DIGITS = 6;

export function sanitizeAmountInput(raw: string): string {
  let integer = '';
  let decimals: string | null = null;
  let separator = '';
  for (const char of raw) {
    if (/\d/.test(char)) {
      if (decimals === null) {
        if (integer.length < MAX_INTEGER_DIGITS) integer += char;
      } else if (decimals.length < 2) {
        decimals += char;
      }
    } else if ((char === ',' || char === '.') && decimals === null) {
      decimals = '';
      separator = char;
    }
    // Espaces, symboles monétaires et lettres sont ignorés.
  }
  if (decimals === null) return integer;
  return `${integer || '0'}${separator}${decimals}`;
}

export function parseCardAmount(text: string): number | null {
  if (!/\d/.test(text)) return null;
  const value = Number(sanitizeAmountInput(text).replace(',', '.'));
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}
