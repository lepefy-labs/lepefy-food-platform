/**
 * Compatibilité migration 177 (`addresses.company_name`) : tant qu'elle n'est
 * pas appliquée, Postgres répond 42703 (colonne absente) ou PGRST204 (cache de
 * schéma) ; les appelants retombent alors sur l'ancien schéma, sans l'entreprise.
 */
export function isMissingCompanyColumn(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '42703' || error.code === 'PGRST204' || /company_name/i.test(error.message ?? '');
}
