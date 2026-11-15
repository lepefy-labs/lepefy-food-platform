import { notFound, redirect } from 'next/navigation';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { getGrowthProspect, listTouches, whatsappSentToday } from '@/lib/growth/server/repository';
import { GROWTH_FEATURES } from '@/lib/growth/engine';
import { CHANNEL_LABEL, OUTCOME_LABEL, STAGE_LABEL } from '@/lib/growth/contactPolicy';
import { GROWTH_ID } from '@/lib/growth/validation';
import type { GrowthEvidence } from '@/lib/growth/types';
import { formatDate } from '@/lib/admin/format';
import AdminPageHeader from '../../../../_components/ui/AdminPageHeader';
import Badge from '../../../../_components/ui/Badge';
import InlineAlert from '../../../../_components/ui/InlineAlert';
import { DescriptionItem, DescriptionList, Panel } from '../../../../_components/ui/Panel';
import { EmptyState } from '../../../../_components/ui/States';
import { ContactPanel, DoNotContactPanel, TouchForm } from './ProspectionDetailClient';

export const dynamic = 'force-dynamic';

const ENTRY_LABEL: Record<string, string> = {
  visit: 'Visite', written_channel: 'Canal écrit ouvert aux demandes professionnelles', introduction: 'Présentation par un tiers',
  event: 'Événement', inbound: 'Demande entrante', none: 'Aucune voie vérifiée',
};
const ACCESS_LABEL: Record<GrowthEvidence['access'], string> = { opened: 'ouverte', blocked: 'non accessible', search_only: 'résultat de recherche seulement' };

export default async function ProspectionDetailPage({ params }: { params: { id: string } }) {
  if (await requirePlatformOwner()) redirect('/admin');
  if (!GROWTH_ID.safeParse(params.id).success) notFound();
  let data;
  try {
    const prospect = await getGrowthProspect(params.id);
    if (!prospect) notFound();
    const [touches, sentToday] = await Promise.all([listTouches(prospect.id), whatsappSentToday()]);
    data = { prospect, touches, sentToday };
  } catch (error) {
    if ((error as { digest?: string })?.digest?.startsWith('NEXT_NOT_FOUND')) throw error;
    return <InlineAlert tone="warning" title="Fiche indisponible">Les tables de la migration 185 ne sont pas lisibles.</InlineAlert>;
  }
  const { prospect, touches, sentToday } = data;
  const d = prospect.dossier;
  const ev = prospect.evaluation;
  const evidenceById = new Map(d.evidence.map((e) => [e.id, e]));
  const cite = (ids: string[] | undefined) => (ids ?? []).filter((id) => evidenceById.has(id)).map((id) => (
    <a key={id} href={evidenceById.get(id)!.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-a-brand-fg underline">[{id}]</a>
  ));

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title={d.name}
        description={`${d.city}${d.region ? ` (${d.region})` : ''} · ${d.country}${d.address ? ` · ${d.address}` : ''}`}
        breadcrumb={[{ label: 'Console Lepefy', href: '/admin/platform' }, { label: 'Prospection', href: '/admin/platform/prospection' }, { label: d.name }]}
        meta={(
          <div className="flex flex-wrap gap-2">
            {d.priority?.level && <Badge tone={d.priority.level === 'A' ? 'urgent' : 'neutral'}>Priorité {d.priority.level}</Badge>}
            <Badge tone="info">{STAGE_LABEL[prospect.sales_stage]}</Badge>
            <Badge tone="neutral">Fit {prospect.fit_score}/100</Badge>
            <Badge tone="neutral">Confiance {ev.confidence}</Badge>
            {prospect.do_not_contact && <Badge tone="danger">Ne plus contacter</Badge>}
          </div>
        )}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Pourquoi ce commerce">
            <DescriptionList columns={1}>
              <DescriptionItem label="Fait vérifié">{d.verifiedFact.text}{cite(d.verifiedFact.evidence)}</DescriptionItem>
              <DescriptionItem label="Hypothèse à confirmer">{d.hypothesis.problem}</DescriptionItem>
              <DescriptionItem label="Question à poser">{d.hypothesis.question}</DescriptionItem>
              <DescriptionItem label="Ce que Lepefy montre">
                <ul className="list-disc pl-5">{d.lepefy.featureIds.map((f) => <li key={f}>{GROWTH_FEATURES[f]?.label ?? f}</li>)}</ul>
                <p className="mt-2">Démo : {d.lepefy.demoFlow}</p>
              </DescriptionItem>
              <DescriptionItem label="Motif de la priorité">{d.priority?.reason}</DescriptionItem>
            </DescriptionList>
          </Panel>

          <Panel title="Voie d’entrée">
            <DescriptionList columns={1}>
              <DescriptionItem label="Voie">{ENTRY_LABEL[ev.entry.kind] ?? ev.entry.kind}{ev.entry.verified ? ' · vérifiée' : ' · non vérifiée'}{cite(d.entry.evidence)}</DescriptionItem>
              {d.entry.detail && <DescriptionItem label="Détail">{d.entry.detail}</DescriptionItem>}
              {!ev.entry.verified && ev.entry.reasons.length > 0 && <DescriptionItem label="Pourquoi non vérifiée">{ev.entry.reasons.join(' ')}</DescriptionItem>}
              <DescriptionItem label="Prochaine action">{d.entry.nextAction}</DescriptionItem>
            </DescriptionList>
          </Panel>

          {(d.toVerify.length > 0 || ev.warnings.length > 0 || ev.fit.notes.length > 0) && (
            <Panel title="À vérifier avant le contact">
              <ul className="list-disc space-y-1 pl-5 text-sm text-a-text">
                {d.toVerify.map((t) => <li key={t}>{t}</li>)}
                {ev.fit.notes.map((t) => <li key={t}>{t}</li>)}
                {ev.warnings.map((t) => <li key={t}>{t}</li>)}
              </ul>
            </Panel>
          )}

          <Panel title="Sources" description="Seules les sources ouvertes confirment un fait." flush>
            <ul className="divide-y divide-a-border">
              {d.evidence.map((e) => (
                <li key={e.id} className="px-4 py-3 text-sm">
                  <p className="font-semibold text-a-text">[{e.id}] <a href={e.url} target="_blank" rel="noopener noreferrer" className="break-all text-a-brand-fg underline">{e.url}</a></p>
                  <p className="text-a-text-3">{ACCESS_LABEL[e.access]} le {e.checkedAt} · {e.kind}</p>
                  <p className="mt-1 text-a-text-2">{e.note}</p>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <ContactPanel prospect={prospect} touches={touches} whatsappSentToday={sentToday} />
          <TouchForm prospectId={prospect.id} closed={prospect.sales_stage === 'perso' || prospect.sales_stage === 'cliente'} />
          <Panel title="Historique des échanges" flush>
            {touches.length === 0 ? (
              <EmptyState title="Aucun échange" description="Chaque contact enregistré apparaît ici avec le message envoyé." className="m-4" />
            ) : (
              <ul className="divide-y divide-a-border">
                {touches.map((t) => (
                  <li key={t.id} className="px-4 py-3 text-sm">
                    <p className="font-semibold text-a-text">{OUTCOME_LABEL[t.outcome]} · {CHANNEL_LABEL[t.channel] ?? t.channel}</p>
                    <p className="text-a-text-3">{formatDate(t.occurred_at, 'datetime', 'Europe/Paris')}</p>
                    {t.reason && <p className="mt-1 text-a-text-2">Motif : {t.reason}</p>}
                    {t.note && <p className="mt-1 text-a-text-2">{t.note}</p>}
                    {t.message_text && <p className="mt-2 whitespace-pre-line rounded-md bg-a-surface-2 p-2 text-a-text-2">{t.message_text}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <DoNotContactPanel prospect={prospect} />
        </div>
      </div>
    </div>
  );
}
