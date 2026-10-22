import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  IconAlertTriangle, IconArrowLeft, IconArrowUpRight, IconBrandWhatsapp, IconBuildingStore, IconCalendarEvent, IconCheck,
  IconChevronDown, IconCircleCheck, IconHelpCircle, IconHistory, IconHome, IconMail, IconMapPin, IconPackage,
  IconPackageExport, IconReceipt, IconTruck, IconX,
} from '@tabler/icons-react';
import { TenantLogo } from '@/components/branding/TenantLogo';
import type { OrderTrackingView, TrackingTone } from '@/lib/orders/tracking/orderTrackingView';
import type { SupportChannel } from '@/lib/orders/portal/supportChannels';
import CopyButton from './CopyButton';

export interface TrackingSummary {
  items: { name: string; quantity: number; amount: string }[];
  lines: { label: string; value: string }[];
  total: string;
}

export interface TrackingAddress { lines: string[] }

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2';

const HERO_TONES: Record<TrackingTone, { icon: string; Icon: typeof IconTruck }> = {
  info: { icon: 'bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]', Icon: IconCircleCheck },
  progress: { icon: 'bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]', Icon: IconTruck },
  success: { icon: 'bg-emerald-50 text-emerald-700', Icon: IconHome },
  warning: { icon: 'bg-amber-50 text-amber-800', Icon: IconAlertTriangle },
  danger: { icon: 'bg-red-50 text-red-700', Icon: IconX },
};

const STEP_ICONS: Record<string, typeof IconTruck> = {
  confirmed: IconCircleCheck, preparing: IconPackage, shipped: IconTruck, ready_for_pickup: IconBuildingStore, delivered: IconHome,
};

function Disclosure({ icon, title, aside, children }: { icon: ReactNode; title: string; aside?: string | null; children: ReactNode }) {
  return (
    <details className="group rounded-2xl border border-gray-200 bg-white shadow-sm">
      <summary className={`flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold text-gray-900 [&::-webkit-details-marker]:hidden ${FOCUS}`}>
        <span aria-hidden="true" className="text-[var(--color-primary-dark)]">{icon}</span>
        <span className="min-w-0 flex-1">{title}</span>
        {aside && <span className="shrink-0 text-xs font-semibold text-gray-600">{aside}</span>}
        <IconChevronDown size={18} aria-hidden="true" className="shrink-0 text-gray-500 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="px-4 pb-4 pl-11 text-sm leading-6 text-gray-700">{children}</div>
    </details>
  );
}

export default function OrderTrackingEssentiel({ view, summary, address, support, tenantName }: {
  view: OrderTrackingView;
  summary: TrackingSummary;
  address: TrackingAddress | null;
  support: SupportChannel[];
  tenantName: string;
}) {
  const tone = HERO_TONES[view.hero.tone];
  const HeroIcon = view.hero.tone === 'progress' && view.fulfillment === 'pickup' ? IconPackage : tone.Icon;
  const reached = view.steps.filter((step) => step.state !== 'todo').length;
  const stepStateLabel = { done: 'terminée', current: 'en cours', todo: 'à venir' } as const;

  return (
    <div className="mx-auto w-full max-w-xl pb-10 md:pt-6">
      {/* Compact header: on mobile it replaces the shop header (isOrderTrackingPath). */}
      <div className="grid grid-cols-[2.75rem_1fr_2.75rem] items-center border-b border-gray-200 bg-white px-3 py-2 md:mx-4 md:rounded-2xl md:border">
        <Link href="/orders" prefetch={false} aria-label="Retour à mes commandes" className={`flex h-11 w-11 items-center justify-center rounded-xl text-gray-800 hover:bg-gray-100 ${FOCUS}`}>
          <IconArrowLeft size={20} aria-hidden="true" />
        </Link>
        <div className="flex justify-center">
          <span className="md:hidden"><TenantLogo variant="compact" className="h-10 w-28" /></span>
          <span className="hidden text-sm font-semibold text-gray-700 md:inline">Mes commandes</span>
        </div>
        <a href="#aide" aria-label="Aide" className={`flex h-11 w-11 items-center justify-center rounded-xl text-gray-800 hover:bg-gray-100 ${FOCUS}`}>
          <IconHelpCircle size={21} aria-hidden="true" />
        </a>
      </div>

      <div className="px-4 pt-4">
        <p className="mb-3 flex items-center justify-between text-xs font-semibold text-gray-600">
          <span>Suivi de commande</span>
          <span className="font-mono tracking-wide text-gray-800">#{view.ref}</span>
        </p>

        {/* 1. Current status, date, carrier action. */}
        <section aria-labelledby="tracking-status" className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm min-[360px]:p-5">
          <div className="mb-3 flex items-center gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone.icon}`}><HeroIcon size={20} aria-hidden="true" /></span>
            <span className="text-xs font-bold uppercase tracking-[0.11em] text-gray-600">{view.hero.kicker}</span>
          </div>
          <h1 id="tracking-status" className="text-[1.375rem] font-extrabold leading-tight tracking-tight text-gray-950 min-[360px]:text-2xl">{view.hero.title}</h1>
          <p className="mt-1.5 text-sm leading-6 text-gray-600">{view.hero.detail}</p>

          {view.dateBox && (
            <div className="mt-4 flex items-center gap-3 rounded-2xl bg-emerald-50 px-4 py-3.5">
              <IconCalendarEvent size={22} aria-hidden="true" className="shrink-0 text-emerald-700" />
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-emerald-800">{view.dateBox.label}</p>
                <p className={view.dateBox.muted ? 'text-sm font-semibold text-gray-700' : 'text-lg font-extrabold leading-snug first-letter:uppercase tracking-tight text-gray-950'}>
                  {view.dateBox.value}
                </p>
              </div>
            </div>
          )}
          {view.updatedAt && <p className="mt-3 text-xs text-gray-600">{view.updatedAt}</p>}

          {view.alert && (
            <div role="status" className="mt-4 flex items-start gap-2.5 rounded-xl bg-amber-50 px-3.5 py-3 text-sm leading-5 text-amber-900">
              <IconAlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
              <p><strong className="font-bold">{view.alert.title}.</strong> {view.alert.text}</p>
            </div>
          )}

          {view.shipment && (
            <div className="mt-1">
              <div className="flex items-center gap-3 pb-3 pt-4">
                <IconPackageExport size={20} aria-hidden="true" className="shrink-0 text-emerald-700" />
                <div className="min-w-0">
                  <p className={`text-sm font-bold ${view.shipment.carrierKnown ? 'text-gray-900' : 'text-gray-700'}`}>{view.shipment.carrier}</p>
                  <p className="text-xs text-gray-600">{view.shipment.caption}</p>
                </div>
              </div>
              {view.shipment.url && (
                <a href={view.shipment.url} target="_blank" rel="noopener noreferrer"
                  className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-bold text-white shadow-sm transition-opacity hover:opacity-90 ${FOCUS}`}>
                  {view.shipment.actionLabel} <IconArrowUpRight size={17} aria-hidden="true" /><span className="sr-only"> (nouvel onglet)</span>
                </a>
              )}
              {view.shipment.code && (
                <div className="mt-2.5 flex min-h-12 items-center justify-between gap-2 rounded-xl bg-gray-50 py-1.5 pl-3 pr-1.5">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-gray-600">Numéro de suivi</p>
                    <p className="break-all font-mono text-sm font-bold tracking-wide text-gray-900">{view.shipment.code}</p>
                  </div>
                  <CopyButton text={view.shipment.code} />
                </div>
              )}
              {view.shipment.hint && <p className="mt-2.5 text-xs leading-5 text-gray-600">{view.shipment.hint}</p>}
            </div>
          )}
          {view.shipmentPending && (
            <p className="mt-4 flex items-start gap-2 rounded-xl bg-gray-50 px-3.5 py-3 text-xs leading-5 text-gray-700">
              <IconTruck size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-gray-500" />{view.shipmentPending}
            </p>
          )}
        </section>

        {/* 2. Short progress. */}
        {!view.cancelled && (
          <section aria-labelledby="tracking-progress" className="mt-6">
            <div className="mb-3 flex items-center justify-between px-0.5">
              <h2 id="tracking-progress" className="text-base font-extrabold tracking-tight text-gray-950">Avancement</h2>
              <span className="text-xs text-gray-600">{reached} étape{reached > 1 ? 's' : ''} sur {view.steps.length}</span>
            </div>
            <ol className="grid grid-cols-4 rounded-3xl border border-gray-200 bg-white px-2 pb-4 pt-5 shadow-sm">
              {view.steps.map((step, index) => {
                const Icon = step.state === 'done' ? IconCheck : STEP_ICONS[step.key] ?? IconCircleCheck;
                const reachedStep = step.state !== 'todo';
                return (
                  <li key={step.key} className="relative min-w-0 text-center" aria-current={step.state === 'current' ? 'step' : undefined}>
                    {index < view.steps.length - 1 && (
                      <span aria-hidden="true" className={`absolute left-[calc(50%+16px)] top-[13px] h-0.5 w-[calc(100%-32px)] ${view.steps[index + 1]!.state !== 'todo' ? 'bg-[var(--color-primary)]' : 'bg-gray-200'}`} />
                    )}
                    <span aria-hidden="true" className={`relative z-10 inline-flex h-7 w-7 items-center justify-center rounded-full ${reachedStep ? 'bg-[var(--color-primary)] text-white' : 'border border-gray-300 bg-gray-50 text-gray-500'} ${step.state === 'current' ? 'ring-4 ring-[var(--color-primary-light)]' : ''}`}>
                      <Icon size={14} />
                    </span>
                    <p className={`mt-2 px-0.5 text-[11px] font-bold leading-tight ${reachedStep ? 'text-gray-900' : 'text-gray-500'}`}>
                      {step.label}<span className="sr-only"> : {stepStateLabel[step.state]}</span>
                    </p>
                    {step.date && <p className="mt-0.5 text-[10px] leading-tight text-gray-600">{step.date}</p>}
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {/* 3. Details, collapsed. */}
        <div className="mt-5 space-y-2.5">
          {view.events && (
            <Disclosure icon={<IconHistory size={18} />} title="Mises à jour du transporteur" aside={view.events.length ? String(view.events.length) : null}>
              {view.events.length ? (
                <ol className="space-y-3 border-l border-gray-200 pl-3.5">
                  {view.events.map((event, index) => (
                    <li key={`${event.date}-${index}`} className="relative">
                      <span aria-hidden="true" className={`absolute -left-[19px] top-1.5 h-2 w-2 rounded-full ${event.latest ? 'bg-[var(--color-primary)]' : 'bg-gray-300'}`} />
                      <p className={`text-sm ${event.latest ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}`}>{event.label}</p>
                      <p className="text-xs text-gray-600">{event.date}</p>
                    </li>
                  ))}
                </ol>
              ) : <p>{view.eventsEmpty}</p>}
            </Disclosure>
          )}

          <Disclosure icon={<IconReceipt size={18} />} title="Articles et total" aside={summary.total}>
            {summary.items.length > 0 && (
              <ul className="mb-3 space-y-1.5">
                {summary.items.map((item, index) => (
                  <li key={`${item.name}-${index}`} className="flex justify-between gap-3">
                    <span className="min-w-0"><span className="font-semibold text-gray-900">{item.quantity}×</span> {item.name}</span>
                    <span className="shrink-0 text-gray-900">{item.amount}</span>
                  </li>
                ))}
              </ul>
            )}
            <dl className="space-y-1 border-t border-gray-100 pt-2">
              {summary.lines.map((line) => (
                <div key={line.label} className="flex justify-between gap-3"><dt>{line.label}</dt><dd className="text-gray-900">{line.value}</dd></div>
              ))}
              <div className="flex justify-between gap-3 border-t border-gray-100 pt-2 font-extrabold text-gray-950"><dt>Total</dt><dd>{summary.total}</dd></div>
            </dl>
          </Disclosure>

          {view.fulfillment === 'delivery' ? (
            <Disclosure icon={<IconMapPin size={18} />} title="Adresse de livraison">
              {address
                ? <address className="not-italic">{address.lines.map((line, index) => <span key={index} className={`block ${index === 0 ? 'font-semibold text-gray-900' : ''}`}>{line}</span>)}</address>
                : <p>Adresse non renseignée.</p>}
            </Disclosure>
          ) : (
            <Disclosure icon={<IconBuildingStore size={18} />} title="Retrait en boutique">
              <p>Présentez votre numéro de commande <span className="font-mono font-semibold text-gray-900">#{view.ref}</span> en boutique.</p>
            </Disclosure>
          )}
        </div>

        {/* 4. Help. */}
        <section id="aide" aria-labelledby="tracking-help" className="mt-8 scroll-mt-4 text-center">
          <h2 id="tracking-help" className="text-sm font-bold text-gray-900">Une question sur votre commande ?</h2>
          {support.length > 0 ? (
            <>
              <p className="mt-1 text-xs leading-5 text-gray-600">Contactez {tenantName} en indiquant le numéro #{view.ref}.</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {support.map((channel) => (
                  <a key={channel.kind} href={channel.href} target={channel.kind === 'whatsapp' ? '_blank' : undefined} rel={channel.kind === 'whatsapp' ? 'noopener noreferrer' : undefined}
                    className={`inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-900 hover:bg-gray-50 ${FOCUS}`}>
                    {channel.kind === 'whatsapp' ? <IconBrandWhatsapp size={18} aria-hidden="true" className="text-emerald-700" /> : <IconMail size={18} aria-hidden="true" />}
                    {channel.label}
                  </a>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-1 text-xs leading-5 text-gray-600">Répondez à l’e-mail de confirmation pour contacter {tenantName}, en indiquant le numéro #{view.ref}.</p>
          )}
        </section>
      </div>
    </div>
  );
}
