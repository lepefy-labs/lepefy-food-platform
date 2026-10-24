'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconCheck, IconPlayerPause, IconPlayerPlay, IconPencil, IconPlus, IconSparkles, IconTrash, IconX } from '@tabler/icons-react';
import ConfirmDialog from '../../_components/ui/ConfirmDialog';
import type {
  KnowledgeBaseCategory,
  KnowledgeBaseEntry,
  KnowledgeBaseSuggestion,
  KnowledgeSuggestionSignal,
  KnowledgeLibraryEntry,
} from '@lepefy/types';
import { labelClasses } from '@/app/admin/_components/ui/Form';
import { KnowledgeLibraryPanel } from './KnowledgeLibraryPanel';
import { knowledgeIssue } from '@/lib/admin/knowledgeSafety';
import type { PageWindow } from '@/lib/admin/listParams';
import Pagination from '../../_components/data/Pagination';
import { useAdminToast } from '../../_components/ui/Toaster';

const INPUT_CLS =
  'w-full rounded-lg border border-a-field bg-a-surface px-3 py-2 text-sm text-a-text focus:border-transparent focus:outline-none focus:ring-2 focus:ring-a-focus';
const LABEL_CLS = labelClasses;
const MAX_CONTENT = 2000;

const CATEGORY_OPTIONS: { value: KnowledgeBaseCategory; label: string }[] = [
  { value: 'faq', label: 'Boutique / FAQ' },
  { value: 'recipe', label: 'Recette' },
  { value: 'cultural_context', label: 'Contexte culturel' },
  { value: 'expression', label: 'Expression' },
  { value: 'greeting', label: 'Salutation' },
];

const SIGNAL_LABELS: Record<KnowledgeSuggestionSignal, string> = {
  knowledge_missing: 'Nala n’avait pas l’information',
  retrieval_weak: 'Réponse peu sûre',
  retrieval_empty: 'Aucune information trouvée',
};

const INTENT_LABELS: Record<string, string> = {
  product_information: 'Info produit',
  recipe: 'Recette',
  delivery: 'Livraison',
  store_information: 'Boutique',
  event_information: 'Événements',
};

function categoryLabel(category: KnowledgeBaseCategory): string {
  return CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? category;
}

function sourceLabel(source: string | null): string {
  if (!source || source === 'manual') return 'Saisie manuelle';
  if (source.startsWith('library:')) return 'Bibliothèque vérifiée';
  if (source.startsWith('nala_suggestion:')) return 'Suggestion Nala validée';
  return source;
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? fallback;
}

type SuggestionDraft = KnowledgeBaseSuggestion & { draftCategory: KnowledgeBaseCategory; draftContent: string };

export function KnowledgeBaseClient({ initialEntries, initialSuggestions, activeTab, libraryEntries, libraryAreas, search, categoryFilter, statusFilter, areaFilter, window }: {
  initialEntries: KnowledgeBaseEntry[];
  initialSuggestions: KnowledgeBaseSuggestion[];
  activeTab: string;
  libraryEntries: KnowledgeLibraryEntry[];
  libraryAreas: string[];
  search: string;
  categoryFilter: string;
  statusFilter: string;
  areaFilter: string;
  window: PageWindow;
}) {
  const router = useRouter();
  const toast = useAdminToast();
  const hrefForPage = (page: number) => `/admin/ai-lab?${new URLSearchParams({ tab: activeTab, ...(search ? { q: search } : {}), ...(categoryFilter ? { category: categoryFilter } : {}), ...(statusFilter ? { status: statusFilter } : {}), ...(areaFilter ? { area: areaFilter } : {}), page: String(page) })}`;
  const [entries, setEntries] = useState<KnowledgeBaseEntry[]>(initialEntries);
  useEffect(() => { setEntries(initialEntries); }, [initialEntries]);
  const [suggestions, setSuggestions] = useState<SuggestionDraft[]>(() => initialSuggestions.map((suggestion) => ({
    ...suggestion, draftCategory: suggestion.category, draftContent: suggestion.proposedContent,
  })));
  useEffect(() => { setSuggestions(initialSuggestions.map((suggestion) => ({ ...suggestion, draftCategory: suggestion.category, draftContent: suggestion.proposedContent }))); }, [initialSuggestions]);
  const [category, setCategory] = useState<KnowledgeBaseCategory>('faq');
  const [content, setContent] = useState('');
  const [source, setSource] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; title: string; category: KnowledgeBaseCategory; content: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeBaseEntry | null>(null);
  const [title, setTitle] = useState('');
  const [history, setHistory] = useState<{ id: string; revisions: { revision: number; action: string; content: string; actor: string | null; recorded_at: string }[] } | null>(null);

  const visibleEntries = entries;

  async function run(key: string, action: () => Promise<void>) {
    setBusyKey(key);
    setMessage(null);
    try { await action(); }
    catch { setMessage({ text: 'Erreur réseau — réessayez.', tone: 'error' }); }
    finally { setBusyKey(null); }
  }

  const create = () => run('create', async () => {
    const res = await fetch('/api/admin/knowledge-base', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), category, content: content.trim(), source: source.trim() || undefined }),
    });
    if (!res.ok) { setMessage({ text: await errorOf(res, 'Ajout impossible.'), tone: 'error' }); return; }
    const { entry } = await res.json() as { entry: KnowledgeBaseEntry };
    setEntries((prev) => [entry, ...prev]);
    setContent('');
    setTitle('');
    setSource('');
    setMessage(null);
    toast.success('Connaissance ajoutée');
    router.refresh();
  });

  const approve = (suggestion: SuggestionDraft) => run(suggestion.key, async () => {
    const res = await fetch('/api/admin/knowledge-base', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: suggestion.draftCategory, content: suggestion.draftContent.trim(), suggestionKey: suggestion.key }),
    });
    if (!res.ok) { setMessage({ text: await errorOf(res, 'Validation impossible.'), tone: 'error' }); return; }
    const { entry } = await res.json() as { entry: KnowledgeBaseEntry };
    setEntries((prev) => prev.some((item) => item.id === entry.id) ? prev : [entry, ...prev]);
    setSuggestions((prev) => prev.filter((item) => item.key !== suggestion.key));
    setMessage(null);
    toast.success('Suggestion validée');
    router.refresh();
  });

  const dismiss = (suggestion: SuggestionDraft) => run(`dismiss:${suggestion.key}`, async () => {
    const res = await fetch('/api/admin/knowledge-base', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dismissSuggestionKey: suggestion.key }),
    });
    if (!res.ok) { setMessage({ text: await errorOf(res, 'Impossible d’ignorer cette suggestion.'), tone: 'error' }); return; }
    setSuggestions((prev) => prev.filter((item) => item.key !== suggestion.key));
    setMessage(null);
    toast.success('Suggestion ignorée');
    router.refresh();
  });

  const patch = (id: string, body: Partial<Pick<KnowledgeBaseEntry, 'title' | 'content' | 'category' | 'active'>>, done: string) => run(id, async () => {
    const res = await fetch(`/api/admin/knowledge-base/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { setMessage({ text: await errorOf(res, 'Enregistrement impossible.'), tone: 'error' }); return; }
    const { entry } = await res.json() as { entry: KnowledgeBaseEntry };
    setEntries((prev) => prev.map((item) => (item.id === id ? entry : item)));
    setEditing(null);
    setMessage(null);
    toast.success(done);
    router.refresh();
  });

  const remove = (entry: KnowledgeBaseEntry) => run(entry.id, async () => {
    const res = await fetch(`/api/admin/knowledge-base/${entry.id}`, { method: 'DELETE' });
    if (!res.ok) { setMessage({ text: await errorOf(res, 'Suppression impossible.'), tone: 'error' }); return; }
    setEntries((prev) => prev.filter((item) => item.id !== entry.id));
    setDeleteTarget(null);
    setMessage(null);
    toast.success('Connaissance supprimée');
    router.refresh();
  });

  async function showHistory(id: string) {
    if (history?.id === id) { setHistory(null); return; }
    const response = await fetch(`/api/admin/knowledge-base/${id}/revisions`);
    if (!response.ok) { setMessage({ text: 'Historique indisponible.', tone: 'error' }); return; }
    const data = await response.json() as { revisions: { revision: number; action: string; content: string; actor: string | null; recorded_at: string }[] };
    setHistory({ id, revisions: data.revisions });
  }

  return (
    <div className="space-y-6">
      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-xs ${message.tone === 'ok' ? 'bg-tone-success-bg text-tone-success-fg' : 'bg-tone-danger-bg text-tone-danger-fg'}`}>{message.text}</p>
      )}

      {(activeTab === 'suggestions' || activeTab === 'legacy') && <section className="overflow-hidden rounded-xl border border-a-border bg-a-surface">
        <div className="flex items-start gap-3 border-b border-a-border bg-a-brand-soft px-4 py-4 sm:px-5">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-a-brand-soft text-a-brand-fg"><IconSparkles size={18} stroke={1.7} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-a-text">Suggestions à valider ({suggestions.length})</h2>
            <p className="mt-1 text-xs leading-5 text-a-text-2">
              Questions de clients auxquelles Nala a mal répondu (livraison, boutique, recettes, événements). Corrigez la réponse proposée puis validez,
              ou ignorez-la. Les demandes de produits introuvables se traitent dans le catalogue.
            </p>
          </div>
        </div>

        {suggestions.length > 0 ? (
          <div className="divide-y divide-a-border">
            {suggestions.map((suggestion) => (
              <article key={suggestion.key} className="p-4 sm:p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-a-hover px-2 py-1 font-medium text-a-text-2">{INTENT_LABELS[suggestion.intent] ?? suggestion.intent}</span>
                  <span className="rounded-full bg-tone-info-bg px-2 py-1 font-medium text-tone-info-fg">{suggestion.occurrenceCount} question{suggestion.occurrenceCount !== 1 ? 's' : ''}</span>
                  {suggestion.signals.map((signal) => <span key={signal} className="rounded-full bg-tone-warning-bg px-2 py-1 font-medium text-tone-warning-fg">{SIGNAL_LABELS[signal]}</span>)}
                </div>
                <div className="mb-4 rounded-lg border border-a-border bg-a-surface-2 px-3 py-2.5">
                  <p className="text-xs font-medium text-a-text-3">Question du client</p>
                  <p className="mt-1 text-sm leading-5 text-a-text-2">« {suggestion.questionPreview} »</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
                  <div>
                    <label htmlFor={`cat-${suggestion.key}`} className={LABEL_CLS}>Catégorie</label>
                    <select id={`cat-${suggestion.key}`} value={suggestion.draftCategory} className={INPUT_CLS}
                      onChange={(event) => setSuggestions((prev) => prev.map((item) => item.key === suggestion.key ? { ...item, draftCategory: event.target.value as KnowledgeBaseCategory } : item))}>
                      {CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`content-${suggestion.key}`} className={LABEL_CLS}>Réponse à enregistrer (à vérifier et corriger)</label>
                    <textarea id={`content-${suggestion.key}`} value={suggestion.draftContent} rows={4} maxLength={MAX_CONTENT} className={INPUT_CLS}
                      onChange={(event) => setSuggestions((prev) => prev.map((item) => item.key === suggestion.key ? { ...item, draftContent: event.target.value } : item))} />
                    <div className="mt-1 text-right text-xs text-a-text-3">{suggestion.draftContent.length}/{MAX_CONTENT}</div>
                  </div>
                </div>
                {knowledgeIssue(suggestion.draftContent) && <p role="alert" className="mt-2 rounded-lg bg-tone-warning-bg px-3 py-2 text-sm text-tone-warning-fg">{knowledgeIssue(suggestion.draftContent)} Corrigez ce texte avant validation.</p>}
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={() => void dismiss(suggestion)} disabled={busyKey !== null}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-a-border px-4 py-2 text-sm font-medium text-a-text-2 disabled:opacity-50">
                    <IconX size={16} /> Ignorer
                  </button>
                  <button type="button" onClick={() => void approve(suggestion)} disabled={busyKey !== null || !!knowledgeIssue(suggestion.draftContent)}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-a-brand px-4 py-2 text-sm font-medium text-a-on-brand disabled:opacity-50">
                    <IconCheck size={17} stroke={1.7} /> {busyKey === suggestion.key ? 'Validation…' : 'Valider et ajouter'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="px-5 py-7 text-center">
            <p className="text-sm font-medium text-a-text-2">Aucune suggestion pour le moment.</p>
            <p className="mt-1 text-xs text-a-text-3">Elles apparaissent quand Nala manque d’informations sur la boutique, la livraison, une recette ou un événement.</p>
          </div>
        )}
      </section>}

      {activeTab === 'library' && <KnowledgeLibraryPanel entries={libraryEntries} areas={libraryAreas} search={search} category={categoryFilter} area={areaFilter} window={window} hrefForPage={hrefForPage} />}

      {(activeTab === 'add' || activeTab === 'legacy') && <section className="rounded-xl border border-a-border bg-a-surface p-4 sm:p-5">
        <h2 className="mb-1 text-sm font-semibold text-a-text-2">Ajouter une connaissance</h2>
        <p className="mb-4 text-xs leading-5 text-a-text-3">Une information par entrée, écrite comme vous la diriez à un client (« La boutique est fermée le 1er mai »).</p>
        {activeTab !== 'legacy' && <><label htmlFor="kb-title" className={LABEL_CLS}>Titre (facultatif)</label>
        <input id="kb-title" value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} className={`${INPUT_CLS} mb-3`} placeholder="Ex. Retrait en boutique" /></>}
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="kb-category" className={LABEL_CLS}>Catégorie</label>
            <select id="kb-category" value={category} onChange={(event) => setCategory(event.target.value as KnowledgeBaseCategory)} className={INPUT_CLS}>
              {CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="kb-source" className={LABEL_CLS}>Source (optionnel)</label>
            <input id="kb-source" type="text" maxLength={120} value={source} onChange={(event) => setSource(event.target.value)} placeholder="ex. équipe Chloé Food" className={INPUT_CLS} />
          </div>
        </div>
        <label htmlFor="kb-content" className={LABEL_CLS}>Contenu</label>
        <textarea id="kb-content" value={content} onChange={(event) => setContent(event.target.value)} rows={4} maxLength={MAX_CONTENT} className={INPUT_CLS} />
        {content && knowledgeIssue(content) && <p role="alert" className="mt-2 text-sm text-tone-warning-fg">{knowledgeIssue(content)}</p>}
        <div className="mb-3 mt-1 text-right text-xs text-a-text-3">{content.length}/{MAX_CONTENT}</div>
        <button type="button" onClick={() => void create()} disabled={busyKey !== null || !!knowledgeIssue(content)}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-a-brand px-4 py-2 text-sm font-medium text-a-on-brand disabled:opacity-50">
          <IconPlus size={16} stroke={1.7} /> {busyKey === 'create' ? 'Ajout…' : 'Ajouter'}
        </button>
      </section>}

      {(activeTab === 'mine' || activeTab === 'legacy') && <section className="overflow-hidden rounded-xl border border-a-border bg-a-surface">
        <div className="flex flex-col gap-3 px-4 pb-3 pt-5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <h2 className="text-sm font-semibold text-a-text-2">Connaissances ({entries.length})</h2>
          <form action="/admin/ai-lab" method="get" className="flex flex-wrap gap-2">
            <input type="hidden" name="tab" value="mine" />
            <label htmlFor="kb-search" className="sr-only">Rechercher</label>
            <input id="kb-search" name="q" type="search" defaultValue={search} placeholder="Rechercher…" className="min-h-11 rounded-lg border border-a-field bg-a-surface px-3 text-sm text-a-text" />
            <label htmlFor="kb-category-filter" className="sr-only">Catégorie</label>
            <select id="kb-category-filter" name="category" defaultValue={categoryFilter} className={INPUT_CLS}><option value="">Toutes les catégories</option>{CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            <label htmlFor="kb-status-filter" className="sr-only">État</label>
            <select id="kb-status-filter" name="status" defaultValue={statusFilter} className={INPUT_CLS}><option value="">Toutes</option><option value="active">Actives</option><option value="paused">En pause</option></select>
            <button type="submit" className="min-h-11 rounded-lg border border-a-border px-3 text-sm font-medium text-a-text">Filtrer</button>
          </form>
        </div>

        <ul className="divide-y divide-a-border">
          {visibleEntries.map((entry) => {
            const isEditing = editing?.id === entry.id;
            const isOpen = expanded.has(entry.id);
            return (
              <li key={entry.id} className={`px-4 py-4 sm:px-5 ${entry.active ? '' : 'bg-a-surface-2'}`}>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-a-hover px-2 py-1 font-medium text-a-text-2">{categoryLabel(entry.category)}</span>
                  {!entry.active && <span className="rounded-full bg-tone-warning-bg px-2 py-1 font-medium text-tone-warning-fg">En pause — Nala ne l’utilise pas</span>}
                  <span className="text-a-text-3">{sourceLabel(entry.source)} · v{entry.revision ?? 1} · {new Date(entry.created_at).toLocaleDateString('fr-FR')}</span>
                </div>
                {entry.title && <h3 className="mt-2 text-sm font-semibold text-a-text">{entry.title}</h3>}
                {isEditing ? (
                  <div className="mt-3 space-y-2">
                    {activeTab !== 'legacy' && <input aria-label="Titre" value={editing.title} maxLength={160} onChange={(event) => setEditing({ ...editing, title: event.target.value })} className={INPUT_CLS} placeholder="Titre (facultatif)" />}
                    <select aria-label="Catégorie" value={editing.category} onChange={(event) => setEditing({ ...editing, category: event.target.value as KnowledgeBaseCategory })} className={INPUT_CLS}>
                      {CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    <textarea aria-label="Contenu" rows={4} maxLength={MAX_CONTENT} value={editing.content} onChange={(event) => setEditing({ ...editing, content: event.target.value })} className={INPUT_CLS} />
                    <div className="flex gap-2">
                      <button type="button" disabled={busyKey !== null || !!knowledgeIssue(editing.content)} onClick={() => void patch(entry.id, { title: editing.title.trim(), content: editing.content.trim(), category: editing.category }, 'Connaissance modifiée.')}
                        className="min-h-11 rounded-lg bg-a-brand px-4 text-sm font-medium text-a-on-brand disabled:opacity-50">{busyKey === entry.id ? 'Enregistrement…' : 'Enregistrer'}</button>
                      <button type="button" onClick={() => setEditing(null)} className="min-h-11 rounded-lg border border-a-border px-4 text-sm text-a-text-2">Annuler</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setExpanded((prev) => { const next = new Set(prev); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); return next; })}
                    aria-expanded={isOpen} className={`mt-2 block w-full whitespace-pre-line text-left text-sm leading-5 text-a-text-2 ${isOpen ? '' : 'line-clamp-2'}`}>
                    {entry.content}
                  </button>
                )}
                {!isEditing && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    <button type="button" onClick={() => setEditing({ id: entry.id, title: entry.title ?? '', category: entry.category, content: entry.content })}
                      className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs text-a-text-2 hover:bg-a-hover"><IconPencil size={14} /> Modifier</button>
                    <button type="button" disabled={busyKey === entry.id} onClick={() => void patch(entry.id, { active: !entry.active }, entry.active ? 'Connaissance mise en pause.' : 'Connaissance réactivée.')}
                      className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs text-a-text-2 hover:bg-a-hover disabled:opacity-50">
                      {entry.active ? <><IconPlayerPause size={14} /> Mettre en pause</> : <><IconPlayerPlay size={14} /> Réactiver</>}
                    </button>
                    <button type="button" onClick={() => setDeleteTarget(entry)}
                      className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs text-tone-danger-fg hover:bg-tone-danger-bg"><IconTrash size={14} /> Supprimer…</button>
                    {activeTab !== 'legacy' && <button type="button" onClick={() => void showHistory(entry.id)} className="inline-flex min-h-10 items-center rounded-lg px-2 text-xs text-a-text-2 hover:bg-a-hover">Historique</button>}
                  </div>
                )}
                {history?.id === entry.id && <div className="mt-3 rounded-lg border border-a-border bg-a-surface-2 p-3"><h4 className="text-sm font-semibold text-a-text">Versions précédentes</h4><ul className="mt-2 space-y-2">{history.revisions.map((revision) => <li key={revision.revision} className="border-t border-a-border pt-2 text-sm text-a-text-2"><span className="font-medium">v{revision.revision} · {revision.action} · {new Date(revision.recorded_at).toLocaleDateString('fr-FR')}</span><p className="mt-1 whitespace-pre-line">{revision.content}</p></li>)}</ul></div>}
              </li>
            );
          })}
          {visibleEntries.length === 0 && (
            <li className="px-5 py-7 text-center text-sm text-a-text-3">{entries.length === 0 ? 'Aucune connaissance pour le moment.' : 'Aucune connaissance ne correspond.'}</li>
          )}
        </ul>
      {activeTab !== 'legacy' && <Pagination window={window} noun="connaissances" hrefForPage={hrefForPage} />}
      </section>}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Supprimer cette connaissance ?"
        description={activeTab === 'legacy' ? 'Nala ne pourra plus s’en servir et la suppression est définitive. Pour l’écarter temporairement, mettez-la plutôt en pause.' : 'Nala ne pourra plus s’en servir. Une trace des versions reste conservée pour l’historique. Pour l’écarter temporairement, mettez-la plutôt en pause.'}
        confirmLabel="Supprimer"
        cancelLabel="Conserver"
        destructive
        loading={deleteTarget !== null && busyKey === deleteTarget.id}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) void remove(deleteTarget); }}
      />
    </div>
  );
}
