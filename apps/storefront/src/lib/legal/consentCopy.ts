// Ciclo 7 — texte du consentement marketing centralisé, jusqu'ici dupliqué
// dans OtpLoginForm.tsx (Ciclo 4), le checkout (Ciclo 5, aujourd'hui CheckoutFlow.tsx) et
// ConsentementClient.tsx (Ciclo 6). `tenantName` toujours dynamique, jamais
// codé en dur.
export function marketingConsentLabel(tenantName: string): string {
  return `Je souhaite recevoir les offres et actualités de ${tenantName} par email, SMS et WhatsApp.`;
}
