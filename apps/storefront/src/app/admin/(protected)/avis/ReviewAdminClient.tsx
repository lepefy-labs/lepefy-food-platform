'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconAlertTriangle, IconCheck, IconEyeOff, IconRosetteDiscountCheck, IconStar, IconX } from '@tabler/icons-react';
import { REVIEW_REASON_CODES } from '@/lib/reviews/reviewModeration';
import Button from '@/app/admin/_components/ui/Button';
import Dialog from '@/app/admin/_components/ui/Dialog';
import InlineAlert, { ErrorText } from '@/app/admin/_components/ui/InlineAlert';
import {
  ACTION_LABELS,
  actionsFor,
  flagLabel,
  moderationIssues,
  needsReason,
  publicRatingState,
  REASON_LABELS,
  REVIEW_STATUS_LABELS,
  type ModerationAction,
} from '@/lib/reviews/reviewAdmin';

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

const STATUS_TONE: Record<AdminReviewRow['status'], string> = {
  pending_moderation: 'bg-amber-50 text-amber-800',
  published: 'bg-emerald-50 text-emerald-800',
  rejected: 'bg-red-50 text-red-700',
  hidden: 'bg-gray-100 text-gray-600',
};

const ACTION_ICONS: Record<ModerationAction, typeof IconCheck> = { publish: IconCheck, restore: IconCheck, reject: IconX, hide: IconEyeOff };

function ModerationModal({ review, action, onClose, onDone }: {
  review: AdminReviewRow;
  action: ModerationAction;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reasonCode, setReasonCode] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const issues = moderationIssues(action, reasonCode || null, reasonText);
  const flagged = review.moderation_flags.length > 0;
  const publishing = action === 'publish' || action === 'restore';

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reviews/${review.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reasonCode: needsReason(action) ? reasonCode : null, reasonText: reasonText.trim() || null }),
      });
      const body = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) { setError(body?.error ?? 'Action impossible.'); return; }
      onDone();
    } catch {
      setError('Erreur réseau — réessayez.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      size="sm"
      title={action === 'publish' ? 'Publier cet avis ?' : action === 'restore' ? 'Republier cet avis ?' : action === 'reject' ? 'Rejeter cet avis ?' : 'Masquer cet avis ?'}
      description={publishing ? 'Il sera visible sur la boutique et compté dans la note moyenne. Le texte du client n’est jamais modifié.'
        : action === 'reject' ? 'Il ne sera jamais publié. Le client n’est pas prévenu.'
          : 'Il disparaît de la boutique et de la note moyenne ; vous pourrez le republier.'}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Annuler</Button>
        <Button variant={publishing ? 'primary' : 'danger'} onClick={() => void confirm()} loading={busy} disabled={issues.length > 0}>
          {publishing && flagged ? `${ACTION_LABELS[action]} malgré le signalement` : ACTION_LABELS[action]}
        </Button>
      </>}
    >
      {(publishing && flagged) || needsReason(action) || error ? (
        <div className="space-y-3">
          {publishing && flagged && (
            <InlineAlert tone="warning">Signalé : {review.moderation_flags.map(flagLabel).join(', ')}. Vérifiez qu’il ne contient pas de données personnelles avant de publier.</InlineAlert>
          )}
          {needsReason(action) && <>
            <label className="block text-sm font-semibold text-a-text">Motif (obligatoire)
              <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} className="mt-1.5 min-h-10 w-full rounded-lg border border-a-border-strong bg-a-surface px-3 text-sm font-normal text-a-text">
                <option value="">Choisir…</option>
                {REVIEW_REASON_CODES.map((code) => <option key={code} value={code}>{REASON_LABELS[code]}</option>)}
              </select>
            </label>
            <label className="block text-sm font-semibold text-a-text">Précision {reasonCode === 'other' ? '(obligatoire)' : '(facultative)'}
              <textarea value={reasonText} onChange={(e) => setReasonText(e.target.value)} maxLength={500} rows={2} className="mt-1.5 font-normal w-full rounded-lg border border-a-border-strong bg-a-surface px-3 py-2 text-sm text-a-text placeholder:text-a-text-3 focus:outline focus:outline-2 focus:outline-a-focus" />
            </label>
          </>}
          <ErrorText message={error} />
        </div>
      ) : null}
    </Dialog>
  );
}

export default function ReviewAdminClient({
  initialReviews, enabled, publicDisplay, minPublicCount, blacklistTerms, canModerate, canManage, publishedCount,
}: {
  initialReviews: AdminReviewRow[];
  enabled: boolean;
  publicDisplay: boolean;
  minPublicCount: number;
  blacklistTerms: string[];
  canModerate: boolean;
  canManage: boolean;
  publishedCount: number;
}) {
  const router = useRouter();
  const baseline = { enabled, publicDisplay, minPublicCount, terms: blacklistTerms.join('\n') };
  const [settings, setSettings] = useState(baseline);
  const [saving, setSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [pending, setPending] = useState<{ review: AdminReviewRow; action: ModerationAction } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = JSON.stringify(settings) !== JSON.stringify(baseline);
  const rating = publicRatingState(publishedCount, settings.minPublicCount, settings.publicDisplay);

  async function saveSettings() {
    setSaving(true);
    setSettingsMessage(null);
    try {
      const blacklist = settings.terms.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
      const response = await fetch('/api/admin/reviews/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: settings.enabled, publicDisplay: settings.publicDisplay, minPublicCount: settings.minPublicCount, blacklistTerms: blacklist }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setSettingsMessage({ text: payload.error ?? 'Enregistrement impossible.', tone: 'error' }); return; }
      setSettingsMessage({ text: 'Configuration enregistrée. La boutique est mise à jour.', tone: 'ok' });
      router.refresh();
    } catch {
      setSettingsMessage({ text: 'Erreur réseau — réessayez.', tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return <div className="space-y-6">
    {canManage && <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <h2 className="font-semibold text-gray-950 dark:text-white">Configuration</h2>
      <p className="mt-1 text-sm leading-6 text-gray-500">Après une commande payée et terminée, le client reçoit une invitation à +24 h, un rappel à +7 jours ; le lien reste valable 30 jours.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <label className="flex items-center gap-3 rounded-xl bg-gray-50 p-4 dark:bg-gray-800"><input type="checkbox" checked={settings.enabled} onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })} className="h-5 w-5" /><span className="text-sm font-medium">Envoyer les invitations</span></label>
        <label className="flex items-center gap-3 rounded-xl bg-gray-50 p-4 dark:bg-gray-800"><input type="checkbox" checked={settings.publicDisplay} onChange={(e) => setSettings({ ...settings, publicDisplay: e.target.checked })} className="h-5 w-5" /><span className="text-sm font-medium">Afficher les avis sur la boutique</span></label>
        <label className="rounded-xl bg-gray-50 p-4 text-sm dark:bg-gray-800"><span className="font-medium">Avis minimum avant d’afficher la note</span><input type="number" min={1} max={50} value={settings.minPublicCount} onChange={(e) => setSettings({ ...settings, minPublicCount: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 dark:border-gray-700 dark:bg-gray-900" /></label>
      </div>
      <p className={`mt-3 rounded-xl px-3 py-2 text-xs ${rating.visible ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>{rating.text}</p>
      <label className="mt-4 block text-sm"><span className="font-medium text-gray-900 dark:text-gray-100">Liste de vigilance</span><span className="ml-2 text-xs text-gray-400">un terme par ligne : l’avis est signalé pour vérification, jamais rejeté automatiquement</span>
        <textarea value={settings.terms} onChange={(e) => setSettings({ ...settings, terms: e.target.value })} rows={4} className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 dark:border-gray-700 dark:bg-gray-950" placeholder={'numéro de téléphone\nnom d’un employé'} /></label>
      {settingsMessage && <p role={settingsMessage.tone === 'error' ? 'alert' : 'status'} className={`mt-3 rounded-xl px-3 py-2 text-sm ${settingsMessage.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{settingsMessage.text}</p>}
      {dirty && <div className="mt-4 flex flex-wrap items-center gap-2">
        <button onClick={() => void saveSettings()} disabled={saving} className="min-h-11 rounded-xl bg-[var(--admin-primary)] px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
        <button onClick={() => { setSettings(baseline); setSettingsMessage(null); }} disabled={saving} className="min-h-11 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700">Annuler</button>
        <span className="text-xs text-gray-500">Modifications non enregistrées</span>
      </div>}
    </section>}

    {notice && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{notice}</p>}

    <section className="space-y-3">
      {initialReviews.length === 0 ? <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500">Aucun avis dans ce filtre.</div> : initialReviews.map((review) => {
        const flagged = review.moderation_flags.length > 0;
        return <article key={review.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2"><strong className="text-gray-950 dark:text-white">{review.reviewer_display_name || 'Client vérifié'}</strong><span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><IconRosetteDiscountCheck size={14}/> achat vérifié</span></div>
              <p className="mt-1 text-xs text-gray-400">
                <Link href={`/admin/orders/${review.order_id}`} className="hover:underline">Commande {review.orderNumber}</Link>
                {review.orderDate ? ` · ${new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(review.orderDate))}` : ''}
                {' · avis du '}{new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(review.submitted_at))}
              </p>
            </div>
            <div className="text-right">
              <span className="inline-flex" aria-label={`${review.rating} sur 5`}>{[1,2,3,4,5].map((value) => <IconStar key={value} size={17} fill={value <= review.rating ? 'currentColor':'none'} className={value <= review.rating ? 'text-amber-500':'text-gray-300'} />)}</span>
              <p className="mt-1"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[review.status]}`}>{REVIEW_STATUS_LABELS[review.status]}</span></p>
              {review.moderation_reason_code && review.status !== 'published' && <p className="mt-1 text-xs text-gray-400">Motif : {REASON_LABELS[review.moderation_reason_code as keyof typeof REASON_LABELS] ?? review.moderation_reason_code}</p>}
            </div>
          </div>
          {review.body ? <p className="mt-4 whitespace-pre-line text-sm leading-6 text-gray-700 dark:text-gray-300">{review.body}</p> : <p className="mt-4 text-sm italic text-gray-400">Note sans commentaire</p>}
          {flagged && <div className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800"><IconAlertTriangle size={16} className="mt-0.5 shrink-0"/><span>À vérifier : {review.moderation_flags.map(flagLabel).join(', ')}. Un signalement ne rejette jamais l’avis automatiquement.</span></div>}
          {canModerate && <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
            {actionsFor(review.status).map((action) => {
              const Icon = ACTION_ICONS[action];
              const positive = action === 'publish' || action === 'restore';
              return <button key={action} onClick={() => { setNotice(null); setPending({ review, action }); }}
                className={`inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm font-semibold ${positive ? 'bg-emerald-600 text-white' : action === 'reject' ? 'border border-red-200 text-red-700' : 'border border-gray-200 text-gray-700'}`}>
                <Icon size={16}/> {ACTION_LABELS[action]}{needsReason(action) ? '…' : ''}
              </button>;
            })}
          </div>}
        </article>;
      })}
    </section>

    {pending && <ModerationModal review={pending.review} action={pending.action} onClose={() => setPending(null)} onDone={() => {
      const label = { publish: 'publié', restore: 'republié', reject: 'rejeté', hide: 'masqué' }[pending.action];
      setPending(null);
      setNotice(`Avis ${label}.`);
      router.refresh();
    }} />}
  </div>;
}
