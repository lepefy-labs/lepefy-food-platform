'use client';

import { useState } from 'react';
import { IconCheck, IconPlus, IconSparkles, IconTrash } from '@tabler/icons-react';
import type {
  KnowledgeBaseCategory,
  KnowledgeBaseEntry,
  KnowledgeBaseSuggestion,
  KnowledgeSuggestionSignal,
} from '@lepefy/types';

const INPUT_CLS =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';
const LABEL_CLS = 'mb-0.5 block text-xs uppercase tracking-wide text-gray-400';

const CATEGORY_OPTIONS: { value: KnowledgeBaseCategory; label: string }[] = [
  { value: 'recipe', label: 'Recette' },
  { value: 'expression', label: 'Expression' },
  { value: 'greeting', label: 'Salutation' },
  { value: 'cultural_context', label: 'Contexte culturel' },
  { value: 'faq', label: 'FAQ' },
];

const SIGNAL_LABELS: Record<KnowledgeSuggestionSignal, string> = {
  knowledge_missing: 'Connaissance manquante',
  retrieval_weak: 'Recherche faible',
  retrieval_empty: 'Recherche vide',
};

const INTENT_LABELS: Record<string, string> = {
  product_information: 'Info produit',
  recipe: 'Recette',
  delivery: 'Livraison',
  store_information: 'Boutique',
  event_information: 'Événementiel',
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function categoryLabel(category: KnowledgeBaseCategory): string {
  return CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? category;
}

function sourceLabel(source: string | null): string {
  if (!source || source === 'manual') return 'Saisie manuelle';
  if (source.startsWith('nala_suggestion:')) return 'Suggestion Nala validée';
  return source;
}

type SuggestionDraft = KnowledgeBaseSuggestion & {
  draftCategory: KnowledgeBaseCategory;
  draftContent: string;
};

interface KnowledgeBaseClientProps {
  initialEntries: KnowledgeBaseEntry[];
  initialSuggestions: KnowledgeBaseSuggestion[];
}

export function KnowledgeBaseClient({ initialEntries, initialSuggestions }: KnowledgeBaseClientProps) {
  const [entries, setEntries] = useState<KnowledgeBaseEntry[]>(initialEntries);
  const [suggestions, setSuggestions] = useState<SuggestionDraft[]>(() => initialSuggestions.map((suggestion) => ({
    ...suggestion,
    draftCategory: suggestion.category,
    draftContent: suggestion.proposedContent,
  })));
  const [category, setCategory] = useState<KnowledgeBaseCategory>('recipe');
  const [content, setContent] = useState('');
  const [source, setSource] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [approvingKey, setApprovingKey] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

  async function handleCreate() {
    if (!content.trim()) return;
    setIsSaving(true);
    try {
      const res = await fetch('/api/admin/knowledge-base', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, content: content.trim(), source: source.trim() || undefined }),
      });
      if (!res.ok) throw new Error();
      const { entry } = await res.json() as { entry: KnowledgeBaseEntry };
      setEntries((prev) => [entry, ...prev]);
      setContent('');
      setSource('');
      showToast('Entrée ajoutée', 'success');
    } catch {
      showToast('Erreur lors de l\'ajout', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleApproveSuggestion(key: string) {
    const suggestion = suggestions.find((item) => item.key === key);
    if (!suggestion?.draftContent.trim()) return;

    setApprovingKey(key);
    try {
      const res = await fetch('/api/admin/knowledge-base', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: suggestion.draftCategory,
          content: suggestion.draftContent.trim(),
          suggestionKey: suggestion.key,
        }),
      });
      if (!res.ok) throw new Error();

      const { entry } = await res.json() as { entry: KnowledgeBaseEntry; alreadyExists?: boolean };
      setEntries((prev) => prev.some((item) => item.id === entry.id) ? prev : [entry, ...prev]);
      setSuggestions((prev) => prev.filter((item) => item.key !== key));
      showToast('Suggestion validée et ajoutée à la base', 'success');
    } catch {
      showToast('Impossible de valider cette suggestion', 'error');
    } finally {
      setApprovingKey(null);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/knowledge-base/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setEntries((prev) => prev.filter((entry) => entry.id !== id));
      showToast('Entrée supprimée', 'success');
    } catch {
      showToast('Erreur lors de la suppression', 'error');
    } finally {
      setDeletingId(null);
    }
  }

  function updateSuggestion(key: string, patch: Partial<Pick<SuggestionDraft, 'draftCategory' | 'draftContent'>>) {
    setSuggestions((prev) => prev.map((item) => item.key === key ? { ...item, ...patch } : item));
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div
          role="status"
          className={`rounded-lg px-3 py-2 text-xs ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
        >
          {toast.msg}
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-violet-200 bg-white">
        <div className="border-b border-violet-100 bg-violet-50/70 px-4 py-4 sm:px-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
              <IconSparkles size={18} stroke={1.7} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-gray-800">Suggestions à valider</h2>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-200">
                  {suggestions.length}
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-gray-600">
                Nala repère des réponses liées à une connaissance manquante ou difficile à retrouver. Aucun brouillon n&apos;est utilisé comme connaissance tant que vous ne l&apos;avez pas validé.
              </p>
            </div>
          </div>
        </div>

        {suggestions.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {suggestions.map((suggestion) => (
              <article key={suggestion.key} className="p-4 sm:p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-gray-100 px-2 py-1 font-medium text-gray-700">
                    {INTENT_LABELS[suggestion.intent] ?? suggestion.intent}
                  </span>
                  <span className="rounded-full bg-blue-50 px-2 py-1 font-medium text-blue-700">
                    {suggestion.occurrenceCount} signal{suggestion.occurrenceCount !== 1 ? 's' : ''}
                  </span>
                  {suggestion.signals.map((signal) => (
                    <span key={signal} className="rounded-full bg-amber-50 px-2 py-1 font-medium text-amber-700">
                      {SIGNAL_LABELS[signal]}
                    </span>
                  ))}
                </div>

                <div className="mb-4 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Question représentative</p>
                  <p className="mt-1 text-sm leading-5 text-gray-700">{suggestion.questionPreview}</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
                  <div>
                    <label className={LABEL_CLS}>Catégorie proposée</label>
                    <select
                      value={suggestion.draftCategory}
                      onChange={(event) => updateSuggestion(suggestion.key, {
                        draftCategory: event.target.value as KnowledgeBaseCategory,
                      })}
                      className={INPUT_CLS}
                    >
                      {CATEGORY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Contenu proposé, modifiable avant validation</label>
                    <textarea
                      value={suggestion.draftContent}
                      onChange={(event) => updateSuggestion(suggestion.key, { draftContent: event.target.value })}
                      rows={4}
                      maxLength={2000}
                      className={INPUT_CLS}
                    />
                    <div className="mt-1 text-right text-[11px] text-gray-400">
                      {suggestion.draftContent.length}/2000
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs leading-5 text-gray-500">
                    Valider transforme ce brouillon en connaissance tenant revue par un humain.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleApproveSuggestion(suggestion.key)}
                    disabled={approvingKey === suggestion.key || !suggestion.draftContent.trim()}
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    <IconCheck size={17} stroke={1.7} />
                    {approvingKey === suggestion.key ? 'Validation…' : 'Valider et ajouter'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="px-5 py-7 text-center">
            <p className="text-sm font-medium text-gray-700">Aucune suggestion exploitable pour le moment.</p>
            <p className="mt-1 text-xs text-gray-400">Les nouveaux signaux Nala apparaîtront ici lorsqu&apos;une validation humaine peut enrichir la base.</p>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
        <h2 className="mb-1 text-sm font-semibold text-gray-700">Ajouter manuellement</h2>
        <p className="mb-4 text-xs leading-5 text-gray-400">
          Ajoutez directement une connaissance validée. Les brouillons Nala ci-dessus peuvent toujours être modifiés avant validation.
        </p>

        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL_CLS}>Catégorie</label>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as KnowledgeBaseCategory)}
              className={INPUT_CLS}
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Source (optionnel)</label>
            <input
              type="text"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="ex. équipe Chloe Food"
              className={INPUT_CLS}
            />
          </div>
        </div>

        <div className="mb-3">
          <label className={LABEL_CLS}>Contenu</label>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={4}
            maxLength={2000}
            className={INPUT_CLS}
          />
        </div>

        <button
          type="button"
          onClick={handleCreate}
          disabled={isSaving || !content.trim()}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          <IconPlus size={16} stroke={1.7} />
          {isSaving ? 'Ajout…' : 'Ajouter'}
        </button>
      </section>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-5 sm:px-5">
          <h2 className="text-sm font-semibold text-gray-700">Connaissances validées</h2>
          <span className="text-xs text-gray-400">{entries.length} entrée{entries.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="divide-y divide-gray-100 md:hidden">
          {entries.map((entry) => (
            <div key={entry.id} className="px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-gray-100 px-2 py-1 font-medium text-gray-700">
                      {categoryLabel(entry.category)}
                    </span>
                    <span className="text-gray-400">{sourceLabel(entry.source)}</span>
                  </div>
                  <p className="mt-2 text-sm leading-5 text-gray-700">{truncate(entry.content, 180)}</p>
                  <p className="mt-2 text-xs text-gray-400">
                    {new Date(entry.created_at).toLocaleDateString('fr-FR')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(entry.id)}
                  disabled={deletingId === entry.id}
                  aria-label="Supprimer"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                >
                  <IconTrash size={17} stroke={1.6} />
                </button>
              </div>
            </div>
          ))}
          {entries.length === 0 && (
            <div className="px-5 py-7 text-center text-sm text-gray-400">Aucune entrée pour le moment.</div>
          )}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-t border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-5 py-2 font-medium">Catégorie</th>
                <th className="px-5 py-2 font-medium">Contenu</th>
                <th className="px-5 py-2 font-medium">Source</th>
                <th className="px-5 py-2 font-medium">Date</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t border-gray-100">
                  <td className="px-5 py-2.5 text-gray-700">{categoryLabel(entry.category)}</td>
                  <td className="px-5 py-2.5 text-gray-600">{truncate(entry.content, 100)}</td>
                  <td className="px-5 py-2.5 text-gray-400">{sourceLabel(entry.source)}</td>
                  <td className="px-5 py-2.5 text-gray-400">
                    {new Date(entry.created_at).toLocaleDateString('fr-FR')}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => handleDelete(entry.id)}
                      disabled={deletingId === entry.id}
                      aria-label="Supprimer"
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    >
                      <IconTrash size={16} stroke={1.5} />
                    </button>
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-center text-sm text-gray-400">
                    Aucune entrée pour le moment.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
