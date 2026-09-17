'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconAlertTriangle, IconCheck, IconEyeOff, IconRosetteDiscountCheck, IconStar, IconX } from '@tabler/icons-react';

export interface AdminReviewRow {
  id: string;
  order_id: string;
  rating: number;
  body: string | null;
  reviewer_display_name: string | null;
  status: 'pending_moderation' | 'published' | 'rejected' | 'hidden';
  moderation_flags: string[];
  moderation_reason_code: string | null;
  submitted_at: string;
  published_at: string | null;
  orderNumber: string;
  orderDate: string | null;
  orderTotal: number | null;
}

const reasonOptions = [
  ['spam','Spam'], ['personal_data','Données personnelles'], ['abuse','Abus / insultes'],
  ['threats','Menaces'], ['hate','Haine'], ['illegal','Contenu illicite'],
  ['irrelevant','Hors sujet'], ['duplicate','Doublon'], ['other','Autre'],
] as const;

export default function ReviewAdminClient({
  initialReviews, enabled, publicDisplay, minPublicCount, blacklistTerms, canModerate, canManage,
}: {
  initialReviews: AdminReviewRow[];
  enabled: boolean;
  publicDisplay: boolean;
  minPublicCount: number;
  blacklistTerms: string[];
  canModerate: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [localEnabled, setLocalEnabled] = useState(enabled);
  const [localPublic, setLocalPublic] = useState(publicDisplay);
  const [localMin, setLocalMin] = useState(minPublicCount);
  const [terms, setTerms] = useState(blacklistTerms.join('\n'));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string,string>>({});
  const [error, setError] = useState<string | null>(null);

  async function saveSettings() {
    setSaving(true); setError(null);
    const blacklist = terms.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
    const response = await fetch('/api/admin/reviews/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: localEnabled, publicDisplay: localPublic, minPublicCount: localMin, blacklistTerms: blacklist }) });
    const payload = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) { setError(payload.error ?? 'Enregistrement impossible.'); return; }
    router.refresh();
  }

  async function moderate(review: AdminReviewRow, action: 'publish'|'reject'|'hide'|'restore') {
    setBusyId(review.id); setError(null);
    const reasonCode = (action === 'reject' || action === 'hide') ? (reasonById[review.id] || null) : null;
    if ((action === 'reject' || action === 'hide') && !reasonCode) { setError('Choisissez un motif de modération.'); setBusyId(null); return; }
    const response = await fetch(`/api/admin/reviews/${review.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, reasonCode, reasonText: null }) });
    const payload = await response.json().catch(() => ({}));
    setBusyId(null);
    if (!response.ok) { setError(payload.error ?? 'Action impossible.'); return; }
    router.refresh();
  }

  return <div className="space-y-6">
    {canManage && <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-xl"><h2 className="font-semibold text-gray-950 dark:text-white">Configuration</h2><p className="mt-1 text-sm leading-6 text-gray-500">Collecte après commande payée et terminée. Premier envoi à +24 h, rappel à +7 jours, lien valable 30 jours. L’IA de modération reste désactivée en V1.</p></div>
        <button onClick={saveSettings} disabled={saving} className="min-h-11 rounded-xl bg-[var(--admin-primary)] px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <label className="flex items-center gap-3 rounded-xl bg-gray-50 p-4 dark:bg-gray-800"><input type="checkbox" checked={localEnabled} onChange={(e) => setLocalEnabled(e.target.checked)} className="h-5 w-5" /><span className="text-sm font-medium">Collecte active</span></label>
        <label className="flex items-center gap-3 rounded-xl bg-gray-50 p-4 dark:bg-gray-800"><input type="checkbox" checked={localPublic} onChange={(e) => setLocalPublic(e.target.checked)} className="h-5 w-5" /><span className="text-sm font-medium">Affichage public</span></label>
        <label className="rounded-xl bg-gray-50 p-4 text-sm dark:bg-gray-800"><span className="font-medium">Seuil note publique</span><input type="number" min={1} max={50} value={localMin} onChange={(e) => setLocalMin(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 dark:border-gray-700 dark:bg-gray-900" /></label>
      </div>
      <label className="mt-4 block text-sm"><span className="font-medium text-gray-900 dark:text-gray-100">Liste de vigilance</span><span className="ml-2 text-xs text-gray-400">un terme par ligne, signalement uniquement</span><textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={4} className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 dark:border-gray-700 dark:bg-gray-950" placeholder="numéro de téléphone\nnom sensible\nterme à vérifier" /></label>
    </section>}

    {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}

    <section className="space-y-3">
      {initialReviews.length === 0 ? <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500">Aucun avis à modérer ou publier.</div> : initialReviews.map((review) => {
        const flagged = review.moderation_flags.length > 0;
        return <article key={review.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><div className="flex items-center gap-2"><strong className="text-gray-950 dark:text-white">{review.reviewer_display_name || 'Client vérifié'}</strong><span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><IconRosetteDiscountCheck size={14}/> vérifié</span></div><p className="mt-1 text-xs text-gray-400">{review.orderNumber}{review.orderDate ? ` · ${new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium'}).format(new Date(review.orderDate))}` : ''}</p></div>
            <div className="text-right"><span className="inline-flex">{[1,2,3,4,5].map((value) => <IconStar key={value} size={17} fill={value <= review.rating ? 'currentColor':'none'} className={value <= review.rating ? 'text-amber-500':'text-gray-300'} />)}</span><p className="mt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{review.status.replace('_',' ')}</p></div>
          </div>
          {review.body ? <p className="mt-4 whitespace-pre-line text-sm leading-6 text-gray-700 dark:text-gray-300">{review.body}</p> : <p className="mt-4 text-sm italic text-gray-400">Note sans commentaire</p>}
          {flagged && <div className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800"><IconAlertTriangle size={16} className="mt-0.5 shrink-0"/><span>À vérifier : {review.moderation_flags.map((flag) => flag.startsWith('blocked_term:') ? `terme interdit « ${flag.slice('blocked_term:'.length)} »` : flag.replaceAll('_', ' ')).join(', ')}. Aucun signalement automatique ne rejette l’avis.</span></div>}
          {canModerate && <div className="mt-5 flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center">
            {(review.status === 'pending_moderation' || review.status === 'published') && <select aria-label="Motif de modération" value={reasonById[review.id] ?? ''} onChange={(e) => setReasonById((current) => ({...current,[review.id]:e.target.value}))} className="min-h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-950"><option value="">Motif si rejet / masquage…</option>{reasonOptions.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>}
            <div className="flex flex-1 flex-wrap justify-end gap-2">
              {review.status === 'pending_moderation' && <><button disabled={busyId===review.id} onClick={() => moderate(review,'reject')} className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-red-200 px-3 text-sm font-semibold text-red-700"><IconX size={16}/> Rejeter</button><button disabled={busyId===review.id} onClick={() => moderate(review,'publish')} className="inline-flex min-h-11 items-center gap-1 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white"><IconCheck size={16}/> Publier</button></>}
              {review.status === 'published' && <button disabled={busyId===review.id} onClick={() => moderate(review,'hide')} className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-700"><IconEyeOff size={16}/> Masquer</button>}
              {(review.status === 'hidden' || review.status === 'rejected') && <button disabled={busyId===review.id} onClick={() => moderate(review,'restore')} className="inline-flex min-h-11 items-center gap-1 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white"><IconCheck size={16}/> Restaurer</button>}
            </div>
          </div>}
        </article>;
      })}
    </section>
  </div>;
}
