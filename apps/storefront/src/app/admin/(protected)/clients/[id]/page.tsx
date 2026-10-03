import Link from 'next/link';
import { notFound } from 'next/navigation';
import { IconArrowLeft, IconBrandWhatsapp, IconCalendarEvent, IconGift, IconMail, IconMapPin, IconPlus, IconReceipt, IconTimeline } from '@tabler/icons-react';
import { getTenant } from '@/lib/tenant/getTenant';
import { getCustomerDetail, RFM_LABELS } from '@/lib/admin/crm';
import {
  campaignChannelLabel, campaignRecipientStatusLabel, consentSourceLabel, customerSourceLabel, pointTypeLabel, reservationStatusLabel,
} from '@/lib/admin/crmLabels';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { formatSince } from '@/lib/orders/adminOrderOperations';
import { buildWhatsAppShareUrl } from '@/lib/orders/assisted/assistedOrderPolicy';
import { createServiceClient } from '@/lib/supabase/server';
import StatusBadge from '../../../_components/ui/StatusBadge';
import { CustomerActions } from './CustomerActions';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

function money(v: number, c: string) { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: c }).format(v); }
function date(v: string | null) { return v ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v)) : 'Jamais'; }
function shortDate(v: string) { return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(v)); }
const orderNumber = (id: string) => `#${id.slice(0, 8).toUpperCase()}`;

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-[var(--admin-border)] bg-white p-4 shadow-sm dark:bg-gray-900 sm:p-5"><h2 className="mb-4 font-semibold">{title}</h2>{children}</section>;
}

interface TimelineItem { at: string; label: string; detail: React.ReactNode; href?: string; icon: React.ReactNode }

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function CustomerPage({ params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const [detail, access] = await Promise.all([getCustomerDetail(tenant.id, params.id), getCurrentAdminAccessContext(tenant.id)]);
  if (!detail) notFound();
  // UI hints only: every write route re-checks its own permission.
  const canManage = Boolean(access && canAdmin(access, 'customers.manage'));
  const canOrder = Boolean(access && canAdmin(access, 'orders.manage'));
  const p = detail.profile;
  const now = new Date();
  const db = createServiceClient();
  const [favoriteProduct, favoriteCategory] = await Promise.all([
    p.favorite_product_id ? db.from('products').select('id,name').eq('tenant_id', tenant.id).eq('id', p.favorite_product_id).maybeSingle() : Promise.resolve({ data: null }),
    p.favorite_category_id ? db.from('categories').select('id,name').eq('tenant_id', tenant.id).eq('id', p.favorite_category_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const whatsappUrl = p.phone ? buildWhatsAppShareUrl(p.phone, '') : null;

  const attendance: TimelineItem[] = detail.reservations.flatMap((reservation: any) => reservation.event_reservation_items.flatMap((item: any) => item.event_reservation_item_redemptions
    .filter((entry: any) => !entry.voided_at)
    .map((entry: any) => ({ at: entry.redeemed_at, label: 'Participation événement', detail: `${reservation.events?.title ?? 'Événement'} · ${entry.quantity_redeemed} entrée${entry.quantity_redeemed > 1 ? 's' : ''}`, href: `/admin/evenementiel/evenements/${reservation.event_id}`, icon: <IconCalendarEvent size={16} aria-hidden="true" /> }))));
  const timeline: TimelineItem[] = [
    ...detail.orders.map((x: any) => ({ at: x.created_at, label: `Commande ${orderNumber(x.id)}`, detail: <span className="inline-flex flex-wrap items-center gap-1.5">{money(Number(x.total), tenant.currency)} <StatusBadge status={x.status} /></span>, href: `/admin/orders/${x.id}`, icon: <IconReceipt size={16} aria-hidden="true" /> })),
    ...detail.purchases.map((x: any) => ({ at: x.created_at, label: 'Achat en boutique', detail: `${money(Number(x.amount), tenant.currency)} · ${x.points_awarded} pts`, icon: <IconGift size={16} aria-hidden="true" /> })),
    ...detail.points.map((x: any) => ({ at: x.created_at, label: x.amount >= 0 ? 'Points gagnés' : 'Points utilisés', detail: `${x.amount > 0 ? '+' : ''}${x.amount} pts · ${pointTypeLabel(x.transaction_type)}`, icon: <IconGift size={16} aria-hidden="true" /> })),
    ...detail.reservations.map((x: any) => ({ at: x.created_at, label: 'Réservation événement', detail: `${x.events?.title ?? 'Événement'} · ${money(Number(x.amount_paid), tenant.currency)} · ${reservationStatusLabel(x.status)}`, href: `/admin/evenementiel/evenements/${x.event_id}`, icon: <IconCalendarEvent size={16} aria-hidden="true" /> })),
    ...attendance,
    ...detail.consents.filter((x: any) => x.consent_type === 'marketing').map((x: any) => ({ at: x.created_at, label: x.granted ? 'Consentement marketing accordé' : 'Consentement marketing refusé', detail: `Source : ${consentSourceLabel(x.source)}`, icon: <IconMail size={16} aria-hidden="true" /> })),
    ...detail.events.filter((x: any) => ['customer_created', 'account_linked'].includes(x.event_type)).map((x: any) => ({ at: x.occurred_at, label: x.event_type === 'customer_created' ? 'Client créé' : 'Compte connecté', detail: `Source : ${customerSourceLabel(x.source)}`, icon: <IconTimeline size={16} aria-hidden="true" /> })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const secondaryAction = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--admin-border)] bg-white px-4 text-sm font-semibold hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-[var(--admin-primary)] dark:bg-gray-900 dark:hover:bg-gray-800';

  return <div className="mx-auto max-w-7xl space-y-5">
    <Link href="/admin/clients" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-gray-600"><IconArrowLeft size={18} aria-hidden="true" />Clients</Link>
    <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold">{p.full_name ?? p.email ?? p.phone ?? 'Client'}</h1><span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">{RFM_LABELS[p.rfm_segment]}</span></div>
        <p className="mt-1 text-sm text-gray-500">{p.email ?? 'E-mail absent'}{p.phone ? ` · ${p.phone}` : ''}</p>
        <p className="mt-1 text-xs text-gray-400">Client depuis le {shortDate(p.created_at)} · source : {customerSourceLabel(p.source)}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:justify-end">
        {canOrder && <Link href={`/admin/orders/new?customer=${p.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--admin-primary)] px-4 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--admin-primary)]"><IconPlus size={17} aria-hidden="true" />Nouvelle commande</Link>}
        {whatsappUrl && <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className={secondaryAction}><IconBrandWhatsapp size={17} aria-hidden="true" />WhatsApp<span className="sr-only"> (nouvel onglet)</span></a>}
        {p.email && <a href={`mailto:${p.email}`} className={secondaryAction}><IconMail size={17} aria-hidden="true" />E-mail</a>}
        {canManage && <CustomerActions customerId={p.id} profile={p} />}
      </div>
    </header>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{([['Dépensé', money(p.lifetime_value, tenant.currency)], ['Commandes', p.completed_orders_count.toLocaleString('fr-FR')], ['Panier moyen', money(p.average_order_value, tenant.currency)], ['Dernier achat', p.last_order_at ? formatSince(p.last_order_at, now) ?? date(p.last_order_at) : 'Jamais']] as const).map(([l, v]) => <article key={l} className="rounded-2xl border border-[var(--admin-border)] bg-white p-4 dark:bg-gray-900"><p className="text-xs text-gray-500">{l}</p><p className="mt-1 text-xl font-semibold">{v}</p></article>)}</div>
    <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <Card title="Activité"><ol className="space-y-1">{timeline.length === 0 ? <li className="py-8 text-center text-sm text-gray-400">Aucune activité enregistrée.</li> : timeline.slice(0, 100).map((item, i) => <li key={`${item.at}-${i}`} className="flex gap-3 border-l-2 border-violet-100 py-2 pl-4"><span className="mt-1 text-violet-600">{item.icon}</span><div className="min-w-0 flex-1">{item.href ? <Link href={item.href} className="font-medium hover:underline">{item.label}</Link> : <p className="font-medium">{item.label}</p>}<div className="text-xs text-gray-500">{item.detail}</div><p className="mt-1 text-[11px] text-gray-400"><time dateTime={item.at} title={date(item.at)}>{formatSince(item.at, now) ?? date(item.at)}</time></p></div></li>)}</ol></Card>
      <div className="space-y-5">
        <Card title="Fidélité"><p className="text-2xl font-semibold">{p.loyalty_points_balance.toLocaleString('fr-FR')} pts</p><p className="mt-1 text-sm text-gray-500">Carte {p.loyalty_card_number ?? 'non attribuée'} · Achats magasin {money(p.in_store_spend, tenant.currency)}</p></Card>
        <Card title="Marketing"><p className={`font-semibold ${p.marketing_consent ? 'text-emerald-700' : 'text-gray-500'}`}>{p.marketing_consent ? '✓ E-mail autorisé' : 'Marketing refusé ou non renseigné'}</p><p className="mt-2 text-xs text-gray-500">{p.marketing_consent_at ? `Décision du ${date(p.marketing_consent_at)} · Source : ${consentSourceLabel(p.marketing_consent_source)}` : 'Aucun consentement marketing positif courant.'}</p></Card>
        <Card title="Produits préférés">{favoriteProduct.data ? <Link href={`/admin/catalogue/${favoriteProduct.data.id}`} className="text-sm font-semibold hover:underline">{favoriteProduct.data.name}</Link> : <p className="text-sm">Pas encore assez d’achats</p>}<p className="mt-1 text-xs text-gray-500">Catégorie : {favoriteCategory.data?.name ?? '—'} · {p.products_count ?? 0} produits achetés</p></Card>
      </div>
    </div>
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Commandes">{detail.orders.length === 0 ? <p className="text-sm text-gray-400">Aucune commande.</p> : <ul className="divide-y divide-gray-100 dark:divide-gray-800">{detail.orders.map((o: any) => <li key={o.id}><Link href={`/admin/orders/${o.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2 text-sm hover:underline"><span className="flex flex-wrap items-center gap-2"><span className="font-mono font-semibold">{orderNumber(o.id)}</span><span className="text-gray-500">{shortDate(o.created_at)}</span><StatusBadge status={o.status} /></span><strong>{money(Number(o.total), tenant.currency)}</strong></Link></li>)}</ul>}</Card>
      <Card title="Adresses">{detail.addresses.length === 0 ? <p className="text-sm text-gray-400">Aucune adresse enregistrée.</p> : <div className="space-y-3">{detail.addresses.map((a: any) => <div key={a.id} className="flex gap-2 rounded-xl bg-gray-50 p-3 text-sm dark:bg-gray-800"><IconMapPin size={17} aria-hidden="true" className="shrink-0" /><span>{a.line1}{a.line2 ? `, ${a.line2}` : ''}<br />{a.postal_code} {a.city} · {a.country}{a.is_default ? <span className="text-gray-500"> · par défaut</span> : null}</span></div>)}</div>}</Card>
      <Card title="Événements">{detail.reservations.length === 0 ? <p className="text-sm text-gray-400">Aucune participation reliée.</p> : <ul>{detail.reservations.map((r: any) => <li key={r.id} className="py-2 text-sm">{r.events?.title ?? 'Événement'} · {shortDate(r.created_at)} · <span className="text-gray-500">{reservationStatusLabel(r.status)}</span></li>)}</ul>}</Card>
      <Card title="Notes et tags">{detail.notes.length === 0 ? <p className="text-sm text-gray-400">Aucune note.</p> : <div className="space-y-3">{detail.notes.map((n: any) => <article key={n.id} className="rounded-xl bg-amber-50 p-3 dark:bg-amber-950/20"><p className="whitespace-pre-wrap text-sm">{n.body}</p><p className="mt-2 text-[11px] text-gray-500">{n.admin_users?.first_name ?? n.admin_users?.email ?? 'Admin'} · <time dateTime={n.created_at} title={date(n.created_at)}>{formatSince(n.created_at, now)}</time></p></article>)}</div>}<div className="mt-4 flex flex-wrap gap-2">{detail.tags.map((t: any) => <span key={t.tag_id} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold dark:bg-gray-800">{t.customer_tags?.name}</span>)}</div></Card>
    </div>
    <Card title="Campagnes reçues">{detail.campaigns.length === 0 ? <p className="text-sm text-gray-400">Aucune campagne.</p> : <ul>{detail.campaigns.map((c: any) => <li key={c.id}><Link href={`/admin/clients/campagnes/${c.marketing_campaigns?.id}`} className="flex min-h-11 items-center justify-between border-b border-gray-100 py-2 text-sm dark:border-gray-800"><span>{c.marketing_campaigns?.name ?? 'Campagne'} · {campaignChannelLabel(c.marketing_campaigns?.channel)}</span><span className="text-gray-500">{campaignRecipientStatusLabel(c.status)}</span></Link></li>)}</ul>}</Card>
  </div>;
}
