import { IconArrowRight, IconBrandWhatsapp, IconMail, IconMapPin } from '@tabler/icons-react';
import type { Tenant } from '@lepefy/types';

export function EventsFooter({ tenant }: { tenant: Tenant }) {
  const contactHref = tenant.legal_email
    ? `mailto:${tenant.legal_email}`
    : tenant.whatsapp_number
      ? `https://wa.me/${tenant.whatsapp_number.replace(/[^0-9]/g, '')}`
      : '/evenementiel#evenements';
  const shopUrl = process.env.NEXT_PUBLIC_APP_URL ?? '/';

  return (
    <footer id="contact" className="bg-[var(--color-primary-dark)] text-white">
      <div className="mx-auto max-w-[1180px] px-4 py-8 sm:px-6 sm:py-10">
        <div className="rounded-3xl border border-white/15 bg-white/[0.06] p-6 sm:flex sm:items-center sm:justify-between sm:gap-8 sm:p-8">
          <div className="max-w-xl">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-secondary)]">Chloe Food Events</p>
            <h2 className="font-display text-3xl font-semibold leading-tight sm:text-4xl">Un projet en tête ? Parlons-en.</h2>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/70">
              Une question sur un événement, un besoin traiteur ou une location de matériel ? Notre équipe vous accompagne.
            </p>
          </div>
          <a
            href={contactHref}
            className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-bold shadow-sm transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:mt-0"
            style={{ backgroundColor: 'var(--color-secondary)', color: 'var(--color-primary-dark)' }}
          >
            Nous contacter <IconArrowRight size={17} />
          </a>
        </div>

        <div className="grid gap-8 border-b border-white/10 py-8 md:grid-cols-[1.25fr_1fr_1fr]">
          <div>
            <p className="font-display text-xl font-semibold">{tenant.name}</p>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-white/60">Événements, traiteur et location de matériel dans un univers gourmand et soigné.</p>
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/45">Navigation</p>
            <div className="grid gap-1 text-sm">
              <a href="/evenementiel#evenements" className="min-h-9 py-2 text-white/75 hover:text-white">Événements</a>
              <a href="/evenementiel#traiteur" className="min-h-9 py-2 text-white/75 hover:text-white">Traiteur</a>
              <a href="/evenementiel#location" className="min-h-9 py-2 text-white/75 hover:text-white">Location de matériel</a>
              <a href={shopUrl} className="min-h-9 py-2 text-white/75 hover:text-white">Boutique en ligne</a>
            </div>
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/45">Contact</p>
            <div className="space-y-2 text-sm text-white/70">
              {tenant.legal_email && <a href={`mailto:${tenant.legal_email}`} className="flex items-start gap-2 hover:text-white"><IconMail size={16} className="mt-0.5 shrink-0" />{tenant.legal_email}</a>}
              {tenant.whatsapp_number && <a href={`https://wa.me/${tenant.whatsapp_number.replace(/[^0-9]/g, '')}`} className="flex items-start gap-2 hover:text-white"><IconBrandWhatsapp size={16} className="mt-0.5 shrink-0" />{tenant.whatsapp_number}</a>}
              {tenant.legal_address && <p className="flex items-start gap-2"><IconMapPin size={16} className="mt-0.5 shrink-0" />{tenant.legal_address}</p>}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-5 text-xs text-white/40 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} {tenant.legal_name ?? tenant.name}</span>
          <span>Powered by Lepefy</span>
        </div>
      </div>
    </footer>
  );
}
