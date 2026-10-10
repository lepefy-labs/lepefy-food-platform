'use client';

import { useMemo, useState } from 'react';
import { IconCheck, IconPlayerPause, IconPlayerPlay, IconPencil, IconPlus, IconSparkles, IconTrash, IconX } from '@tabler/icons-react';
import ConfirmDialog from '../../_components/ui/ConfirmDialog';
import type {
  KnowledgeBaseCategory,
  KnowledgeBaseEntry,
  KnowledgeBaseSuggestion,
  KnowledgeSuggestionSignal,
} from '@lepefy/types';

const INPUT_CLS =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';
const LABEL_CLS = 'mb-1 block text-xs font-medium text-gray-500';
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

type Filter = 'all' | 'active' | 'paused';

function categoryLabel(category: KnowledgeBaseCategory): string {
  return CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? category;
}

function sourceLabel(source: string | null): string {
  if (!source || source === 'manual') return 'Saisie manuelle';
  if (source.startsWith('nala_suggestion:')) return 'Suggestion Nala validée';
  return source;
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? fallback;
}

type SuggestionDraft = KnowledgeBaseSuggestion & { draftCategory: KnowledgeBaseCategory; draftContent: string };

export function KnowledgeBaseClient({ initialEntries, initialSuggestions }: {
  initialEntries: KnowledgeBaseEntry[];
  initialSuggestions: KnowledgeBaseSuggestion[];
}) {
  const [entries, setEntries] = useState<KnowledgeBaseEntry[]>(initialEntries);
  const [suggestions, setSuggestions] = useState<SuggestionDraft[]>(() => initialSuggestions.map((suggestion) => ({
    ...suggestion, draftCategory: suggestion.category, draftContent: suggestion.proposedContent,
  })));
  const [category, setCategory] = useState<KnowledgeBaseCategory>('faq');
  const [content, setContent] = useState('');
  const [source, setSource] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; category: KnowledgeBaseCategory; content: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeBaseEntry | null>(null);

  const visibleEntries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('fr');
    return entries.filter((entry) => (filter === 'all' || (filter === 'active') === entry.active)
      && (!needle || entry.content.toLocaleLowerCase('fr').includes(needle) || categoryLabel(entry.category).toLocaleLowerCase('fr').includes(needle)));
  }, [entries, filter, query]);

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
      body: JSON.stringify({ category, content: content.trim(), source: source.trim() || undefined }),
    });
    if (!res.ok) { setMessage({ text: await errorOf(res, 'Ajout impossible.'), tone: 'error' }); return; }
    const { entry } = await res.json() as { entry: KnowledgeBaseEntry };
    setEntries((prev) => [entry, ...prev]);
    setContent('');
    setSource('');
    setMessage({ text: 'Connaissance ajoutée : Nala peut l’utiliser dès maintenant.', tone: 'ok' });
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
    setMessage({ text: 'Suggestion validée et ajoutée à la base.', tone: 'ok' });
  });

  const dismiss = (suggestion: SuggestionDraft) => run(`dismiss:${suggestion.key}`, async () => {
    const res = await fetch('/api/admin/knowledge-base', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dismissSuggestionKey: suggestion.key }),
    });
    if (!res.ok) { setMessage({ text: await errorOf(res, 'Impossible d’ignorer cette suggestion.'), tone: 'error' }); return; }
    setSuggestions((prev) => prev.filter((item) => item.key !== suggestion.key));
    setMessage({ text: 'Suggestion ignorée : elle ne sera plus proposée.', tone: 'ok' });
  });

  const patch = (id: string, body: Partial<Pick<KnowledgeBaseEntry, 'content' | 'category' | 'active'>>, done: string) => run(id, async () => {
    const res = await fetch(`/api/admin/knowledge-base/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { setMessage({ text: await errorOf(res, 'Enregistrement impossible.'), tone: 'error' }); return; }
    const { entry } = await res.json() as { entry: KnowledgeBaseEntry };
    setEntries((prev) => prev.map((item) => (item.id === id ? entry : item)));
    setEditing(null);
    setMessage({ text: done, tone: 'ok' });
  });

  const remove = (entry: KnowledgeBaseEntry) => run(entry.id, async () => {
    const res = await fetch(`/api/admin/knowledge-base/${entry.id}`, { method: 'DELETE' });
    if (!res.ok) { setMessage({ text: await errorOf(res, 'Suppression impossible.'), tone: 'error' }); return; }
    setEntries((prev) => prev.filter((item) => item.id !== entry.id));
    setDeleteTarget(null);
    setMessage({ text: 'Connaissance supprimée.', tone: 'ok' });
  });

  return (
    <div className="space-y-6">
      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-xs ${message.tone === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{message.text}</p>
      )}

      <section className="overflow-hidden rounded-xl border border-violet-200 bg-white">
        <div className="flex items-start gap-3 border-b border-violet-100 bg-violet-50/70 px-4 py-4 sm:px-5">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700"><IconSparkles size={18} stroke={1.7} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-gray-800">Suggestions à valider ({suggestions.length})</h2>
            <p className="mt-1 text-xs leading-5 text-gray-600">
              Questions de clients auxquelles Nala a mal répondu (livraison, boutique, recettes, événements). Corrigez la réponse proposée puis validez,
              ou ignorez-la. Les demandes de produits introuvables se traitent dans le catalogue.
            </p>
          </div>
        </div>

        {suggestions.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {suggestions.map((suggestion) => (
              <article key={suggestion.key} className="p-4 sm:p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-gray-100 px-2 py-1 font-medium text-gray-700">{INTENT_LABELS[suggestion.intent] ?? suggestion.intent}</span>
                  <span className="rounded-full bg-blue-50 px-2 py-1 font-medium text-blue-700">{suggestion.occurrenceCount} question{suggestion.occurrenceCount !== 1 ? 's' : ''}</span>
                  {suggestion.signals.map((signal) => <span key={signal} className="rounded-full bg-amber-50 px-2 py-1 font-medium text-amber-700">{SIGNAL_LABELS[signal]}</span>)}
                </div>
                <div className="mb-4 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
                  <p className="text-xs font-medium text-gray-400">Question du client</p>
                  <p className="mt-1 text-sm leading-5 text-gray-700">« {suggestion.questionPreview} »</p>
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
                    <div className="mt-1 text-right text-[11px] text-gray-400">{suggestion.draftContent.length}/{MAX_CONTENT}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={() => void dismiss(suggestion)} disabled={busyKey !== null}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 disabled:opacity-50">
                    <IconX size={16} /> Ignorer
                  </button>
                  <button type="button" onClick={() => void approve(suggestion)} disabled={busyKey !== null || !suggestion.draftContent.trim()}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                    <IconCheck size={17} stroke={1.7} /> {busyKey === suggestion.key ? 'Validation…' : 'Valider et ajouter'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="px-5 py-7 text-center">
            <p className="text-sm font-medium text-gray-700">Aucune suggestion pour le moment.</p>
            <p className="mt-1 text-xs text-gray-400">Elles apparaissent quand Nala manque d’informations sur la boutique, la livraison, une recette ou un événement.</p>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
        <h2 className="mb-1 text-sm font-semibold text-gray-700">Ajouter une connaissance</h2>
        <p className="mb-4 text-xs leading-5 text-gray-400">Une information par entrée, écrite comme vous la diriez à un client (« La boutique est fermée le 1er mai »).</p>
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
        <div className="mb-3 mt-1 text-right text-[11px] text-gray-400">{content.length}/{MAX_CONTENT}</div>
        <button type="button" onClick={() => void create()} disabled={busyKey !== null || !content.trim()}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          <IconPlus size={16} stroke={1.7} /> {busyKey === 'create' ? 'Ajout…' : 'Ajouter'}
        </button>
      </section>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-col gap-3 px-4 pb-3 pt-5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <h2 className="text-sm font-semibold text-gray-700">Connaissances ({entries.length})</h2>
          <div className="flex flex-wrap gap-2">
            <label htmlFor="kb-search" className="sr-only">Rechercher</label>
            <input id="kb-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher…" className="min-h-10 rounded-lg border border-gray-200 px-3 text-sm" />
            {(['all', 'active', 'paused'] as const).map((value) => (
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
                className={`min-h-10 rounded-lg px-3 text-xs font-medium ${filter === value ? 'bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)]' : 'border border-gray-200 text-gray-600'}`}>
                {value === 'all' ? 'Toutes' : value === 'active' ? 'Actives' : 'En pause'}
              </button>
            ))}
          </div>
        </div>

        <ul className="divide-y divide-gray-100">
          {visibleEntries.map((entry) => {
            const isEditing = editing?.id === entry.id;
            const isOpen = expanded.has(entry.id);
            return (
              <li key={entry.id} className={`px-4 py-4 sm:px-5 ${entry.active ? '' : 'bg-gray-50/70'}`}>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-gray-100 px-2 py-1 font-medium text-gray-700">{categoryLabel(entry.category)}</span>
                  {!entry.active && <span className="rounded-full bg-amber-50 px-2 py-1 font-medium text-amber-800">En pause — Nala ne l’utilise pas</span>}
                  <span className="text-gray-400">{sourceLabel(entry.source)} · {new Date(entry.created_at).toLocaleDateString('fr-FR')}</span>
                </div>
                {isEditing ? (
                  <div className="mt-3 space-y-2">
                    <select aria-label="Catégorie" value={editing.category} onChange={(event) => setEditing({ ...editing, category: event.target.value as KnowledgeBaseCategory })} className={INPUT_CLS}>
                      {CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    <textarea aria-label="Contenu" rows={4} maxLength={MAX_CONTENT} value={editing.content} onChange={(event) => setEditing({ ...editing, content: event.target.value })} className={INPUT_CLS} />
                    <div className="flex gap-2">
                      <button type="button" disabled={busyKey !== null || !editing.content.trim()} onClick={() => void patch(entry.id, { content: editing.content.trim(), category: editing.category }, 'Connaissance modifiée.')}
                        className="min-h-11 rounded-lg bg-[var(--color-primary)] px-4 text-sm font-medium text-white disabled:opacity-50">{busyKey === entry.id ? 'Enregistrement…' : 'Enregistrer'}</button>
                      <button type="button" onClick={() => setEditing(null)} className="min-h-11 rounded-lg border border-gray-200 px-4 text-sm text-gray-600">Annuler</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setExpanded((prev) => { const next = new Set(prev); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); return next; })}
                    aria-expanded={isOpen} className={`mt-2 block w-full whitespace-pre-line text-left text-sm leading-5 text-gray-700 ${isOpen ? '' : 'line-clamp-2'}`}>
                    {entry.content}
                  </button>
                )}
                {!isEditing && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    <button type="button" onClick={() => setEditing({ id: entry.id, category: entry.category, content: entry.content })}
                      className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs text-gray-600 hover:bg-gray-100"><IconPencil size={14} /> Modifier</button>
                    <button type="button" disabled={busyKey === entry.id} onClick={() => void patch(entry.id, { active: !entry.active }, entry.active ? 'Connaissance mise en pause.' : 'Connaissance réactivée.')}
                      className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50">
                      {entry.active ? <><IconPlayerPause size={14} /> Mettre en pause</> : <><IconPlayerPlay size={14} /> Réactiver</>}
                    </button>
                    <button type="button" onClick={() => setDeleteTarget(entry)}
                      className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs text-red-600 hover:bg-red-50"><IconTrash size={14} /> Supprimer…</button>
                  </div>
                )}
              </li>
            );
          })}
          {visibleEntries.length === 0 && (
            <li className="px-5 py-7 text-center text-sm text-gray-400">{entries.length === 0 ? 'Aucune connaissance pour le moment.' : 'Aucune connaissance ne correspond.'}</li>
          )}
        </ul>
      </section>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Supprimer cette connaissance ?"
        description="Nala ne pourra plus s’en servir et la suppression est définitive. Pour l’écarter temporairement, mettez-la plutôt en pause."
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
