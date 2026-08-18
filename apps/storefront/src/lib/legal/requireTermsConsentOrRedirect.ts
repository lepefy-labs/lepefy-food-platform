import { redirect } from 'next/navigation';
import { hasValidTermsConsent } from './hasValidTermsConsent';

// Ciclo 6 — appelé depuis chaque page /compte/** protégée (aucun layout
// partagé n'existe pour cette zone, voir Step 0 : chaque page fait déjà son
// propre `if (!customer) redirect('/compte/connexion')`, ce guard suit le
// même pattern plutôt que d'introduire un layout qui n'aurait de toute façon
// aucun moyen fiable de connaître le chemin courant côté Server Component
// sans middleware — absent de ce projet, cf. CLAUDE.md). `currentPath` est
// toujours une chaîne littérale connue de l'appelant, jamais une entrée
// utilisateur — aucune validation anti-open-redirect nécessaire ici (elle a
// lieu côté lecture du paramètre `return`, voir safeReturnPath.ts).
export async function requireTermsConsentOrRedirect(
  tenantId: string,
  customerId: string,
  currentPath: string,
): Promise<void> {
  const ok = await hasValidTermsConsent(tenantId, customerId);
  if (!ok) {
    redirect(`/compte/consentement?return=${encodeURIComponent(currentPath)}`);
  }
}
