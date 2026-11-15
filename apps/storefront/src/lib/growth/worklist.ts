import type { GrowthProspectRow } from './types';

/** Views of /admin/platform/prospection (URL ?vue=). */
export const WORKLIST_VIEWS = ['aujourdhui', 'en-cours', 'a-cultiver', 'toutes', 'exclues'] as const;
export type WorklistView = typeof WORKLIST_VIEWS[number];

export const WORKLIST_VIEW_LABEL: Record<WorklistView, string> = {
  aujourdhui: 'Aujourd’hui',
  'en-cours': 'En cours',
  'a-cultiver': 'À cultiver',
  toutes: 'Toutes les fiches',
  exclues: 'Ne plus contacter',
};

export function parseView(value: string | undefined): WorklistView {
  return (WORKLIST_VIEWS as readonly string[]).includes(value ?? '') ? value as WorklistView : 'aujourdhui';
}

type Row = Pick<GrowthProspectRow, 'status' | 'separate_segment' | 'sales_stage' | 'next_action_at' | 'do_not_contact' | 'priority' | 'fit_score' | 'name'>;

const OPEN = new Set(['contattato', 'in_conversazione', 'demo']);

/** A follow-up is due when its date is today or past. */
export function followUpDue(row: Pick<Row, 'next_action_at'>, now: Date = new Date()): boolean {
  return !!row.next_action_at && new Date(row.next_action_at).getTime() <= endOfDay(now).getTime();
}

function endOfDay(now: Date): Date {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function inView(row: Row, view: WorklistView, now: Date = new Date()): boolean {
  if (view === 'exclues') return row.do_not_contact;
  if (view === 'toutes') return true;
  if (row.do_not_contact) return false;
  switch (view) {
    // Ready shops never contacted, plus follow-ups due today or overdue.
    case 'aujourdhui': return (row.status === 'pronta' && !row.separate_segment && row.sales_stage === 'da_contattare') || (OPEN.has(row.sales_stage) && followUpDue(row, now));
    case 'en-cours': return OPEN.has(row.sales_stage);
    case 'a-cultiver': return row.status === 'da_coltivare' && row.sales_stage === 'da_contattare';
  }
}

const PRIORITY_RANK: Record<string, number> = { A: 0, B: 1, C: 2 };

/** Due follow-ups first, then priority, then fit. */
export function sortWorklist<T extends Row>(rows: T[], now: Date = new Date()): T[] {
  return [...rows].sort((a, b) =>
    Number(followUpDue(b, now)) - Number(followUpDue(a, now))
    || (PRIORITY_RANK[a.priority ?? ''] ?? 3) - (PRIORITY_RANK[b.priority ?? ''] ?? 3)
    || b.fit_score - a.fit_score
    || a.name.localeCompare(b.name, 'fr'));
}

export function viewCounts(rows: Row[], now: Date = new Date()): Record<WorklistView, number> {
  const out = Object.fromEntries(WORKLIST_VIEWS.map((v) => [v, 0])) as Record<WorklistView, number>;
  for (const row of rows) for (const v of WORKLIST_VIEWS) if (inView(row, v, now)) out[v] += 1;
  return out;
}
