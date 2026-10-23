/**
 * Formulaire « Demander ma propre boutique » (pur, partagé client/serveur).
 * Données minimales : nom du commerce, ville, un moyen de contact, message
 * facultatif, modules d'intérêt. Consentement explicite obligatoire.
 */

export const DEMO_INTERESTS = ['shop', 'events', 'orders', 'management', 'nala'] as const;
export type DemoInterest = (typeof DEMO_INTERESTS)[number];

export const DEMO_INTEREST_LABELS: Record<DemoInterest, string> = {
  shop: 'Boutique en ligne',
  events: 'Événements et traiteur',
  orders: 'Gestion des commandes',
  management: 'Achats, stock et trésorerie',
  nala: 'Assistante Nala',
};

export interface DemoRequestInput {
  businessName: string;
  city: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  interests: DemoInterest[];
}

export type DemoRequestValidation =
  | { ok: true; value: DemoRequestInput }
  | { ok: false; field: 'businessName' | 'contact' | 'email' | 'phone' | 'consent' | 'message'; error: string };

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;

export function validateDemoRequest(body: Record<string, unknown> | null): DemoRequestValidation {
  const input = body ?? {};
  const businessName = text(input.businessName, 160);
  if (!businessName || businessName.length < 2) return { ok: false, field: 'businessName', error: 'Indiquez le nom de votre commerce.' };
  const email = text(input.email, 254);
  const phone = text(input.phone, 40);
  if (!email && !phone) return { ok: false, field: 'contact', error: 'Indiquez un e-mail ou un téléphone pour qu’on puisse vous répondre.' };
  if (email && !EMAIL.test(email)) return { ok: false, field: 'email', error: 'Cet e-mail ne semble pas valide. Vérifiez-le.' };
  if (phone && phone.replace(/\D/g, '').length < 6) return { ok: false, field: 'phone', error: 'Ce numéro est trop court. Vérifiez-le.' };
  const rawMessage = typeof input.message === 'string' ? input.message.trim() : '';
  if (rawMessage.length > 1000) return { ok: false, field: 'message', error: 'Le message est trop long (1 000 caractères au plus).' };
  if (input.consent !== true) return { ok: false, field: 'consent', error: 'Cochez la case pour nous autoriser à vous recontacter.' };
  const interests = Array.isArray(input.interests)
    ? Array.from(new Set(input.interests.filter((value): value is DemoInterest => (DEMO_INTERESTS as readonly unknown[]).includes(value))))
    : [];
  return {
    ok: true,
    value: { businessName, city: text(input.city, 120), email, phone, message: rawMessage || null, interests },
  };
}
