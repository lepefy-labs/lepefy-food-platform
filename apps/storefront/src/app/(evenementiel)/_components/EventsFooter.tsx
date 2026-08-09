import { IconArrowRight } from '@tabler/icons-react';
import type { Tenant } from '@lepefy/types';

// Footer dédié à la vetrina Événementiel — remplace le Footer boutique
// partagé (components/layout/Footer.tsx, "À propos / Suivez-nous"),
// volontairement absent de ce groupe de routes. Reprend .footer-cta du
// mockup validé : fond --color-primary-dark, CTA de contact, ligne
// d'informations tenant lue dynamiquement (jamais de raison sociale/adresse
// hardcodée). CTA de contact : email si renseigné, sinon WhatsApp, sinon
// retour au hub — toujours une destination fonctionnelle.
export function EventsFooter({ tenant }: { tenant: Tenant }) {
  const contactHref = tenant.legal_email
    ? `mailto:${tenant.legal_email}`
    : tenant.whatsapp_number
      ? `https://wa.me/${tenant.whatsapp_number.replace(/[^0-9]/g, '')}`
      : '/evenementiel#evenements';

  // URL absolue de la boutique — jamais hardcodée : NEXT_PUBLIC_APP_URL est
  // déjà la source de vérité utilisée ailleurs pour les liens absolus vers
  // le storefront (ex. api/card/qr-code). Ce lien traverse potentiellement
  // un changement de domaine (events.* → shop.*), d'où l'URL absolue.
  const shopUrl = process.env.NEXT_PUBLIC_APP_URL ?? '/';

  const noteParts = [
    tenant.legal_name ?? tenant.name,
    tenant.legal_address,
    'Powered by Lepefy',
  ].filter(Boolean);

  return (
    <footer style={{ backgroundColor: 'var(--color-primary-dark)' }} className="text-white text-center px-6 py-16 sm:py-24">
      <h2 className="font-display text-3xl sm:text-4xl font-bold mb-4">
        Une envie de <span style={{ color: 'var(--color-secondary)' }}>fête</span> ?<br />Parlons-en.
      </h2>
      <p className="text-white/75 mb-8 max-w-md mx-auto">
        Événement, réception ou simple envie de grillades entre amis — on s&apos;occupe du reste.
      </p>

      <div className="flex flex-wrap items-center justify-center gap-4">
        <a
          href={contactHref}
          className="text-sm font-semibold px-7 py-3.5 rounded-[10px] transition-transform hover:-translate-y-0.5"
          style={{ backgroundColor: 'var(--color-secondary)', color: 'var(--color-primary-dark)' }}
        >
          Nous contacter
        </a>
        <a
          href={shopUrl}
          className="inline-flex items-center gap-1.5 text-sm font-semibold px-7 py-3.5 rounded-[10px] border border-white/45 text-white transition-colors hover:border-[var(--color-secondary)] hover:text-[var(--color-secondary)]"
        >
          Découvrir notre boutique en ligne <IconArrowRight size={14} />
        </a>
      </div>

      <div className="mt-10 text-xs text-white/50">
        {noteParts.join(' · ')}
      </div>
    </footer>
  );
}
