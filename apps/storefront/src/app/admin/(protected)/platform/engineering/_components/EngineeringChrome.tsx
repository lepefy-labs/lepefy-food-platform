import type { ReactNode } from 'react';
import { IconSearch } from '@tabler/icons-react';
import { formatDate, formatNumber } from '@/lib/admin/format';
import type { ActiveRun, ActiveRunResult } from '@/lib/engineering/server/activeRun';
import AdminPageHeader from '../../../../_components/ui/AdminPageHeader';
import AdminTabs from '../../../../_components/ui/Tabs';
import Badge from '../../../../_components/ui/Badge';
import Button from '../../../../_components/ui/Button';
import { Input } from '../../../../_components/ui/Form';
import { EmptyState, ErrorState } from '../../../../_components/ui/States';

export const ENGINEERING_PATH = '/admin/platform/engineering';

const TABS = [
  { key: 'panoramica', label: 'Panoramica', href: ENGINEERING_PATH },
  { key: 'architettura', label: 'Architettura', href: `${ENGINEERING_PATH}/architettura` },
  { key: 'moduli', label: 'Moduli', href: `${ENGINEERING_PATH}/moduli` },
  { key: 'codice', label: 'Codice', href: `${ENGINEERING_PATH}/codice` },
  { key: 'ricerca', label: 'Ricerca', href: `${ENGINEERING_PATH}/ricerca` },
  { key: 'ai', label: 'AI', href: `${ENGINEERING_PATH}/ai` },
  { key: 'metriche', label: 'Metriche', href: `${ENGINEERING_PATH}/metriche` },
  { key: 'accessi', label: 'Accessi', href: `${ENGINEERING_PATH}/accessi` },
] as const;
export type EngineeringTab = (typeof TABS)[number]['key'];

export function EngineeringChrome({ active, title, description, breadcrumb = [], children }: {
  active: EngineeringTab;
  title: string;
  description?: string;
  breadcrumb?: Array<{ label: string; href?: string }>;
  children: ReactNode;
}) {
  return (
    <div className="space-y-5">
      <AdminPageHeader
        title={title}
        description={description}
        breadcrumb={[{ label: 'Piattaforma' }, { label: 'Engineering Hub', href: ENGINEERING_PATH }, ...breadcrumb]}
        tabs={<AdminTabs label="Sezioni dell’Engineering Hub" tabs={TABS.map((tab) => ({ href: tab.href, label: tab.label, active: tab.key === active }))} />}
      />
      {children}
    </div>
  );
}

/** Renders the empty / unavailable states of the index; returns the ready run otherwise. */
export function IndexGate({ result }: { result: ActiveRunResult }): { run: ActiveRun; fallback: null } | { run: null; fallback: ReactNode } {
  if (result.state === 'ready') return { run: result.run, fallback: null };
  if (result.state === 'empty') {
    return {
      run: null,
      fallback: <EmptyState title="Nessun indice attivo" description="Lo schema è pronto ma nessuno snapshot del repository è stato attivato. Il Hub non mostra numeri finché non esiste un indice completo." />,
    };
  }
  return {
    run: null,
    fallback: <ErrorState title="Indice non disponibile" description="Verifica che la migration 175 sia applicata. Il Hub non inventa dati quando non riesce a leggere l’indice." supportHint={false} />,
  };
}

export function IndexBanner({ run }: { run: ActiveRun }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-a-text-3">
      <Badge tone="info" dot>Indice attivo</Badge>
      <span>commit <code className="font-mono text-a-text-2">{run.commitSha.slice(0, 8)}</code> su <code className="font-mono text-a-text-2">{run.branch}</code></span>
      <span>{run.activatedAt ? `attivato il ${formatDate(run.activatedAt, 'datetime')}` : 'data di attivazione n.d.'}</span>
      <span>{formatNumber(run.counts.files ?? 0)} file · {formatNumber(run.counts.symbols ?? 0)} simboli</span>
    </p>
  );
}

export function SearchForm({ defaultValue = '', moduleKey = '', modules = [] }: { defaultValue?: string; moduleKey?: string; modules?: Array<{ moduleKey: string; title: string }> }) {
  return (
    <form method="get" action={`${ENGINEERING_PATH}/ricerca`} role="search" className="flex flex-wrap items-end gap-2">
      <div className="min-w-[14rem] flex-1">
        <label htmlFor="eng-q" className="sr-only">Cerca nel repository</label>
        <div className="relative">
          <IconSearch size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-a-text-3" />
          <Input id="eng-q" name="q" defaultValue={defaultValue} placeholder="Simbolo, file, tabella, RPC, documento…" className="pl-9" maxLength={120} />
        </div>
      </div>
      {modules.length > 0 && (
        <div>
          <label htmlFor="eng-module" className="sr-only">Modulo</label>
          <select id="eng-module" name="module" defaultValue={moduleKey} className="h-10 rounded-[10px] border border-a-border bg-a-surface px-3 text-sm text-a-text">
            <option value="">Tutti i moduli</option>
            {modules.map((entry) => <option key={entry.moduleKey} value={entry.moduleKey}>{entry.title}</option>)}
          </select>
        </div>
      )}
      <Button type="submit" variant="primary">Cerca</Button>
    </form>
  );
}
