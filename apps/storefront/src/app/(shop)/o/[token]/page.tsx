import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { IconBuildingStore, IconCircleCheck, IconPackage, IconTruck, IconAlertTriangle, IconDeviceMobile } from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { isWellFormedPortalToken } from '@/lib/orders/portal/orderPublicToken';
import { loadOrderPortal } from '@/lib/orders/portal/loadOrderPortal';
import type { CustomerOrderStage } from '@/lib/orders/orderStatus';
import PortalActions from './PortalActions';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Page tokenisée : jamais indexée, jamais de Referer vers le transporteur,
// aucun identifiant client dans le titre.
export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  return {
    title: `Votre commande — ${tenant.name}`,
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
    referrer: 'no-referrer',
  };
}

const STAGE_ICON: Record<CustomerOrderStage, typeof IconTruck> = {
  confirmed: IconCircleCheck,
  preparing: IconPackage,
  ready_for_pickup: IconBuildingStore,
  shipped: IconTruck,
  delivered: IconCircleCheck,
  cancelled: IconAlertTriangle,
};

const headingStyle = { fontFamily: 'var(--font-bricolage), var(--font-inter), system-ui, sans-serif' };

export default async function OrderPortalPage({ params }: { params: { token: string } }) {
  if (!isWellFormedPortalToken(params.token)) notFound();
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const vm = await loadOrderPortal(createServiceClient(), tenant, params.token);
  if (!vm) notFound();

  const Icon = STAGE_ICON[vm.stage];
  const cancelled = vm.stage === 'cancelled';
  const visibleItems = vm.items.slice(0, 6);
  const hiddenCount = vm.items.length - visibleItems.length;

  return (
    <div className="mx-auto max-w-lg px-4 pb-12 pt-5 sm:pt-8">
      <section aria-labelledby="portal-title" className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm">
        <p className="font-mono text-xs font-semibold text-gray-500">Commande #{vm.ref} · {vm.date}</p>
        <div className="mt-3 flex items-start gap-3">
          <span aria-hidden="true" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${cancelled ? 'bg-red-50 text-red-700' : 'bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]'}`}>
            <Icon size={22} />
          </span>
          <div className="min-w-0">
            <h1 id="portal-title" className="text-2xl font-bold tracking-tight text-gray-950" style={headingStyle}>{vm.headline}</h1>
            <span className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-bold ${cancelled ? 'bg-red-50 text-red-700' : 'bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]'}`}>{vm.stageLabel}</span>
          </div>
        </div>
        <p className="mt-3 text-sm leading-6 text-gray-600">{vm.description}</p>

        {vm.shipment && (vm.shipment.eta || vm.shipment.status || vm.shipment.carrier || vm.shipment.trackingCode) && (
          <dl className="mt-4 space-y-1.5 rounded-xl bg-gray-50 p-3 text-sm">
            {vm.shipment.eta && <div className="flex justify-between gap-3"><dt className="text-gray-500">Livraison estimée</dt><dd className="font-semibold text-gray-900">{vm.shipment.eta}</dd></div>}
            {vm.shipment.status && <div className="flex justify-between gap-3"><dt className="text-gray-500">Suivi</dt><dd className="text-right font-medium text-gray-900">{vm.shipment.status}{vm.shipment.lastUpdate ? ` · ${vm.shipment.lastUpdate}` : ''}</dd></div>}
            {vm.shipment.carrier && <div className="flex justify-between gap-3"><dt className="text-gray-500">Transporteur</dt><dd className="font-medium text-gray-900">{vm.shipment.carrier}</dd></div>}
            {vm.shipment.trackingCode && <div className="flex justify-between gap-3"><dt className="text-gray-500">N° de suivi</dt><dd className="break-all font-mono text-xs font-semibold text-gray-900">{vm.shipment.trackingCode}</dd></div>}
          </dl>
        )}

        {vm.pickup && (
          <div className="mt-4 rounded-xl bg-gray-50 p-3 text-sm">
            <p className="font-semibold text-gray-900">Retrait</p>
            <p className="mt-1 text-gray-700">{vm.pickup.address}</p>
            {vm.pickup.hours && <p className="mt-1 whitespace-pre-line text-gray-500">{vm.pickup.hours}</p>}
          </div>
        )}

        <PortalActions token={params.token} primary={vm.primary} secondary={vm.secondary} support={vm.support} />
      </section>

      {visibleItems.length > 0 && (
        <section aria-labelledby="portal-items" className="mt-4 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm">
          <h2 id="portal-items" className="text-sm font-semibold text-gray-900">Votre commande</h2>
          <ul className="mt-3 space-y-1.5 text-sm text-gray-700">
            {visibleItems.map((item, index) => <li key={`${item.name}-${index}`}><span className="font-semibold text-gray-900">{item.quantity} ×</span> {item.name}</li>)}
          </ul>
          {hiddenCount > 0 && <p className="mt-2 text-xs text-gray-500">+ {hiddenCount} autre{hiddenCount > 1 ? 's' : ''} article{hiddenCount > 1 ? 's' : ''}</p>}
        </section>
      )}

      {vm.appUrl && (
        <a href={vm.appUrl} className="mt-4 flex min-h-11 items-center gap-2 rounded-2xl border border-gray-200/80 bg-white px-5 py-3 text-sm text-gray-600 shadow-sm hover:bg-gray-50">
          <IconDeviceMobile size={18} aria-hidden="true" /> Retrouvez-nous aussi sur l’application {vm.tenant.name}
        </a>
      )}
    </div>
  );
}
