'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { KnowledgeLibraryEntry } from '@lepefy/types';
import type { PageWindow } from '@/lib/admin/listParams';
import ConfirmDialog from '../../_components/ui/ConfirmDialog';
import Pagination from '../../_components/data/Pagination';
import { useAdminToast } from '../../_components/ui/Toaster';

const inputClass = 'min-h-11 rounded-lg border border-a-field bg-a-surface px-3 text-sm text-a-text focus:outline-2 focus:outline-a-focus';

export function KnowledgeLibraryPanel({ entries, areas, search, category, area, window, hrefForPage }: {
  entries: KnowledgeLibraryEntry[];
  areas: string[];
  search: string;
  category: string;
  area: string;
  window: PageWindow;
  hrefForPage: (page: number) => string;
}) {
  const router = useRouter();
  const toast = useAdminToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function adopt() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/knowledge-library', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selected, replaceExistingIds: entries.filter((entry) => selected.includes(entry.id) && entry.updateAvailable).map((entry) => entry.id), confirmed: true }),
      });
      const result = await response.json() as { added?: string[]; updated?: string[]; skipped?: { id: string; reason: string }[]; error?: string };
      if (!response.ok) { setError(result.error ?? 'Ajout impossible.'); return; }
      setMessage(`${result.added?.length ?? 0} ajoutée(s), ${result.updated?.length ?? 0} mise(s) à jour.${result.skipped?.length ? ` ${result.skipped.length} ignorée(s) : déjà présentes ou indisponibles.` : ''}`);
      toast.success('Bibliothèque mise à jour', { description: `${result.added?.length ?? 0} ajoutée(s), ${result.updated?.length ?? 0} mise(s) à jour.` });
      setSelected([]);
      setReview(false);
      router.refresh();
    } catch { setError('Erreur réseau. Réessayez.'); }
    finally { setBusy(false); }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-a-border bg-a-surface">
      <div className="border-b border-a-border p-4 sm:p-5">
        <h2 className="text-base font-semibold text-a-text">Bibliothèque de connaissances vérifiées</h2>
        <p className="mt-1 text-sm text-a-text-2">Examinez les informations, puis choisissez celles que Nala peut utiliser dans votre boutique. Rien n’est ajouté sans votre confirmation.</p>
        <form action="/admin/ai-lab" method="get" className="mt-4 flex flex-wrap gap-2">
          <input type="hidden" name="tab" value="library" />
          <label className="sr-only" htmlFor="library-search">Rechercher dans la bibliothèque</label>
          <input id="library-search" name="q" className={`${inputClass} min-w-44 flex-1`} defaultValue={search} placeholder="Rechercher…" />
          <label className="sr-only" htmlFor="library-area">Région</label>
          <select id="library-area" name="area" className={inputClass} defaultValue={area}>
            <option value="">Toutes les régions</option>{areas.map((code) => <option key={code} value={code}>Globales et {code === 'CM' ? 'Cameroun' : code}</option>)}
          </select>
          <label className="sr-only" htmlFor="library-category">Catégorie</label>
          <select id="library-category" name="category" className={inputClass} defaultValue={category}>
            <option value="">Toutes les catégories</option><option value="faq">Boutique / FAQ</option><option value="cultural_context">Contexte culturel</option><option value="recipe">Recette</option><option value="expression">Expression</option><option value="greeting">Salutation</option>
          </select>
          <button type="submit" className="min-h-11 rounded-lg border border-a-border bg-a-surface px-4 text-sm font-medium text-a-text">Filtrer</button>
        </form>
      </div>
      {error && <p role="alert" className="m-4 rounded-lg bg-tone-danger-bg p-3 text-sm text-tone-danger-fg">{error}</p>}
      {message && <p role="status" className="m-4 rounded-lg bg-tone-success-bg p-3 text-sm text-tone-success-fg">{message}</p>}
      <ul className="divide-y divide-a-border">
        {entries.map((entry) => (
          <li key={entry.id} className="p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <input type="checkbox" aria-label={`Sélectionner ${entry.title}`} checked={selected.includes(entry.id)} disabled={(entry.adopted && !entry.updateAvailable) || (!selected.includes(entry.id) && selected.length >= 8)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, entry.id] : current.filter((id) => id !== entry.id))} className="mt-1 h-5 w-5 accent-a-brand" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-a-text">{entry.title}</h3><span className="rounded-full bg-a-brand-soft px-2 py-1 text-xs text-a-brand-fg">{entry.updateAvailable ? `Nouvelle version (v${entry.adoptedVersion} → v${entry.version})` : entry.adopted ? 'Déjà ajoutée' : 'Vérifiée'}</span></div>
                <p className="mt-1 whitespace-pre-line text-sm leading-6 text-a-text-2">{entry.content}</p>
                <p className="mt-2 text-xs text-a-text-3">{entry.scope === 'global' ? 'Globale' : entry.cultural_area} · {entry.category} · Version {entry.version} · Source : {entry.provenance}</p>
              </div>
            </div>
          </li>
        ))}
        {entries.length === 0 && <li className="p-6 text-center text-sm text-a-text-2">Aucune connaissance disponible pour ce filtre. Essayez une autre recherche.</li>}
      </ul>
      <div className="border-t border-a-border p-4"><button type="button" className="min-h-11 rounded-lg bg-a-brand px-4 text-sm font-semibold text-a-on-brand disabled:opacity-40" disabled={selected.length === 0} onClick={() => setReview(true)}>Examiner {selected.length} sélection(s)</button></div>
      <Pagination window={window} noun="connaissances" hrefForPage={hrefForPage} />
      <ConfirmDialog open={review} title="Confirmer ces connaissances pour Nala ?" description="Les nouvelles entrées seront activées. Une mise à jour remplace le texte de votre copie, même si vous l’avez personnalisé; son état actif ou en pause sera conservé. L’ancienne version reste dans l’historique." confirmLabel="Confirmer" loading={busy} error={error} onCancel={() => { if (!busy) setReview(false); }} onConfirm={() => void adopt()}>
        <ul className="list-disc pl-5 text-sm text-a-text-2">{entries.filter((entry) => selected.includes(entry.id)).map((entry) => <li key={entry.id}>{entry.title} · v{entry.version}</li>)}</ul>
      </ConfirmDialog>
    </section>
  );
}
