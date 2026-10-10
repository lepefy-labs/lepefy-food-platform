import { assessProspect, completenessLabel, QUALITY_LABELS } from '@/lib/platform/prospects/assessment';
import { daysOverdue, followUpState, SALES_TIME_ZONE } from '@/lib/platform/prospects/salesPipeline';
import type { Prospect } from '@/lib/platform/prospects/types';
import { Badge } from './ui';
export function Fit({p}:{p:Prospect}) {
  const a=assessProspect(p);
  return <div><strong>{p.fit_score}/100</strong><p className="text-xs font-normal text-a-text-3">{QUALITY_LABELS[a.score_state]}</p></div>;
}
export function Completeness({p}:{p:Prospect}) {
  const a=assessProspect(p);
  return <div className="min-w-24"><strong>{a.data_completeness}%</strong>
    <progress className="block h-1.5 w-24 accent-violet-600" max={100} value={a.data_completeness} aria-label="Complétude des données" />
    <p className="mt-1 text-xs text-a-text-3">Données {completenessLabel(a.data_completeness).toLowerCase()}</p></div>;
}
export function Qualification({p}:{p:Prospect}) {
  return assessProspect(p).score_state==='enriched' ? <Badge value={p.qualification_level} />
    : <span className="inline-block rounded-full bg-tone-warning-bg px-2 py-1 text-xs font-medium text-tone-warning-fg">À enrichir</span>;
}
export function CollectionStatus({p}:{p:Prospect}) {
  return <span>{QUALITY_LABELS[assessProspect(p).enrichment_status]}</span>;
}
export function FollowUp({p}:{p:Prospect}) {
  if (!p.next_action_at) return <span className="text-xs text-a-text-3">—</span>;
  const state=followUpState(p.next_action_at), day=new Date(p.next_action_at).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',timeZone:SALES_TIME_ZONE});
  if (state==='overdue') { const late=daysOverdue(p.next_action_at); return <span className="rounded-full bg-tone-danger-bg px-2 py-1 text-xs font-medium text-tone-danger-fg">En retard · {late} j</span>; }
  if (state==='today') return <span className="rounded-full bg-tone-warning-bg px-2 py-1 text-xs font-medium text-tone-warning-fg">Aujourd’hui</span>;
  return <span className="text-xs text-a-text-2">{day}</span>;
}
