import { IconCalendarEvent, IconArrowRight } from '@tabler/icons-react';
import { createPublicClient } from '@/lib/supabase/public';
import { formatDate } from '@/lib/utils/format';
import type { Tenant } from '@lepefy/types';

// Bannière cross-promo homepage → hub /evenementiel. Ne se rend QUE si
// tenant.events_enabled === true (flag 052) — jamais de valeur hardcodée
// pour un tenant en particulier. Pointe vers l'hub, pas un événement
// spécifique : reste stable même sans événement imminent tant que les
// services (traiteur/location) sont actifs.
//
// Lien en <a> natif (pas next/link) : NEXT_PUBLIC_EVENTS_SUBDOMAIN peut
// pointer vers un domaine différent de celui de la boutique (voir
// next.config.mjs rewrites) — un changement de domaine doit toujours
// être un lien absolu, jamais une navigation client Next.
export async function EventBanner({ tenant }: { tenant: Tenant }) {
  if (!tenant.events_enabled) return null;

  const supabase = createPublicClient();
  const { data: nextEvent } = await supabase
    .from('events')
    .select('title, date_start')
    .eq('tenant_id', tenant.id)
    .eq('status', 'published')
    .gte('date_start', new Date().toISOString())
    .order('date_start', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!nextEvent && !tenant.services_enabled) return null;

  const eventsSubdomain = process.env.NEXT_PUBLIC_EVENTS_SUBDOMAIN;
  const href = eventsSubdomain ? `https://${eventsSubdomain}` : '/evenementiel';

  return (
    <a
      href={href}
      className="mx-4 mt-4 flex items-center gap-3 rounded-2xl px-4 py-3.5 text-white transition-opacity hover:opacity-95"
      style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))' }}
    >
      <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center shrink-0">
        <IconCalendarEvent size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Événementiel</p>
        <p className="text-sm font-semibold truncate">
          {nextEvent
            ? `${nextEvent.title} — ${formatDate(nextEvent.date_start)}`
            : 'Traiteur & location de matériel pour vos événements'}
        </p>
      </div>
      <IconArrowRight size={16} className="shrink-0" />
    </a>
  );
}
