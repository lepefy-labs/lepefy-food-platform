'use client';

import { useState } from 'react';
import { IconTrash, IconPlus } from '@tabler/icons-react';
import type { KnowledgeBaseEntry, KnowledgeBaseCategory } from '@lepefy/types';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

const CATEGORY_OPTIONS: { value: KnowledgeBaseCategory; label: string }[] = [
  { value: 'recipe', label: 'Recette' },
  { value: 'expression', label: 'Expression' },
  { value: 'greeting', label: 'Salutation' },
  { value: 'cultural_context', label: 'Contexte culturel' },
  { value: 'faq', label: 'FAQ' },
];

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

interface KnowledgeBaseClientProps {
  initialEntries: KnowledgeBaseEntry[];
}

export function KnowledgeBaseClient({ initialEntries }: KnowledgeBaseClientProps) {
  const [entries, setEntries] = useState<KnowledgeBaseEntry[]>(initialEntries);
  const [category, setCategory] = useState<KnowledgeBaseCategory>('recipe');
  const [content, setContent] = useState('');
  const [source, setSource] = useState('');
  const [isSaving, setIsSaving] = useState(false);
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

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/knowledge-base/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setEntries((prev) => prev.filter((e) => e.id !== id));
      showToast('Entrée supprimée', 'success');
    } catch {
      showToast('Erreur lors de la suppression', 'error');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`px-3 py-2 rounded-lg text-xs ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {toast.msg}
        </div>
      )}

      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Ajouter une entrée</h2>
        <p className="text-xs text-gray-400 mb-4">
          Contenu écrit à la main (recette, expression, contexte, FAQ) — jamais généré par l&apos;IA.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className={LABEL_CLS}>Catégorie</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as KnowledgeBaseCategory)}
              className={INPUT_CLS}
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Source (optionnel)</label>
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="ex. dalice"
              className={INPUT_CLS}
            />
          </div>
        </div>

        <div className="mb-3">
          <label className={LABEL_CLS}>Contenu</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            maxLength={2000}
            className={INPUT_CLS}
          />
        </div>

        <button
          onClick={handleCreate}
          disabled={isSaving || !content.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50"
        >
          <IconPlus size={14} stroke={1.5} />
          Ajouter
        </button>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <h2 className="text-sm font-semibold text-gray-700 px-5 pt-5 pb-3">Entrées existantes</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-t border-gray-100">
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
                <td className="px-5 py-2.5 text-gray-700">
                  {CATEGORY_OPTIONS.find((o) => o.value === entry.category)?.label ?? entry.category}
                </td>
                <td className="px-5 py-2.5 text-gray-600">{truncate(entry.content, 100)}</td>
                <td className="px-5 py-2.5 text-gray-400">{entry.source ?? '—'}</td>
                <td className="px-5 py-2.5 text-gray-400">
                  {new Date(entry.created_at).toLocaleDateString('fr-FR')}
                </td>
                <td className="px-5 py-2.5 text-right">
                  <button
                    onClick={() => handleDelete(entry.id)}
                    disabled={deletingId === entry.id}
                    aria-label="Supprimer"
                    className="text-gray-400 hover:text-red-600 disabled:opacity-50"
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
      </section>
    </div>
  );
}
