import { assessProspect, completenessLabel, QUALITY_LABELS } from '@/lib/platform/prospects/assessment';
import type { Prospect } from '@/lib/platform/prospects/types';
import { Badge } from './ui';
export function Fit({p}:{p:Prospect}) {
  const a=assessProspect(p);
  return <div><strong>{p.fit_score}/100</strong><p className="text-xs font-normal text-gray-500">{QUALITY_LABELS[a.score_state]}</p></div>;
}
export function Completeness({p}:{p:Prospect}) {
  const a=assessProspect(p);
  return <div className="min-w-24"><strong>{a.data_completeness}%</strong>
    <progress className="block h-1.5 w-24 accent-violet-600" max={100} value={a.data_completeness} aria-label="Complétude des données" />
    <p className="mt-1 text-xs text-gray-500">Données {completenessLabel(a.data_completeness).toLowerCase()}</p></div>;
}
export function Qualification({p}:{p:Prospect}) {
  return assessProspect(p).score_state==='enriched' ? <Badge value={p.qualification_level} />
    : <span className="inline-block rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">À enrichir</span>;
}
export function CollectionStatus({p}:{p:Prospect}) {
  return <span>{QUALITY_LABELS[assessProspect(p).enrichment_status]}</span>;
}
