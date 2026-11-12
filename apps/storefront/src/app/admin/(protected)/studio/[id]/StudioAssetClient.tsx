'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconArrowBackUp, IconCheck, IconExternalLink, IconRefresh, IconTrash, IconWand } from '@tabler/icons-react';
import Button from '../../../_components/ui/Button';
import Badge from '../../../_components/ui/Badge';
import InlineAlert from '../../../_components/ui/InlineAlert';
import ConfirmDialog from '../../../_components/ui/ConfirmDialog';
import { FormField, Textarea } from '../../../_components/ui/Form';
import { useAdminToast } from '../../../_components/ui/Toaster';
import { cn } from '@/lib/utils/cn';
import { STUDIO_ASSET_STATUS_META, STUDIO_REVISION_STATUS_META } from '@/lib/admin/statusRegistry';
import { formatDate } from '@/lib/admin/format';
import { STUDIO_LIMITS, type StudioAssetDetail, type StudioRevisionView } from '@/lib/studio/domain';
import type { StudioDestinationDefinition } from '@/lib/studio/destinations';
import { newRequestKey, startJob } from '../studioClient';
import StudioUseDialog from './StudioUseDialog';

interface Props {
  initialAsset: StudioAssetDetail;
  destinations: StudioDestinationDefinition[];
  pour: { destination: string; targetId: string } | null;
}

async function call<T>(url: string, init: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
    const json = await response.json().catch(() => ({})) as T & { error?: string };
    return response.ok ? { ok: true, data: json } : { ok: false, error: json.error ?? 'Une erreur est survenue. Réessayez.' };
  } catch {
    return { ok: false, error: 'Connexion impossible. Vérifiez le réseau puis réessayez.' };
  }
}

/**
 * One image: compare original and proposal, ask corrections in plain words,
 * approve a version or discard, then « Utiliser l’image ». The page polls the
 * image every 4 s while a version is being made (visible tab only); the user
 * may leave and come back.
 */
export default function StudioAssetClient({ initialAsset, destinations, pour }: Props) {
  const router = useRouter();
  const toast = useAdminToast();
  const [asset, setAsset] = useState(initialAsset);
  const succeeded = useMemo(() => asset.revisions.filter((rev) => rev.status === 'succeeded'), [asset.revisions]);
  const latest = asset.revisions.at(-1) ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(asset.approvedRevisionId ?? succeeded.at(-1)?.id ?? null);
  const selected = asset.revisions.find((rev) => rev.id === selectedId) ?? succeeded.at(-1) ?? null;
  const [showOriginal, setShowOriginal] = useState(false);
  const [correction, setCorrection] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'discard' | { usageId: string; label: string }>(null);
  const [useOpen, setUseOpen] = useState(false);
  const correctionKey = useRef(newRequestKey());

  const refresh = useCallback(async () => {
    const result = await call<{ asset: StudioAssetDetail }>(`/api/admin/studio/assets/${asset.id}`, { method: 'GET' });
    if (result.ok) {
      setAsset(result.data.asset);
      return result.data.asset;
    }
    return null;
  }, [asset.id]);

  // Poll while a version is being made; select the new proposal when it lands.
  useEffect(() => {
    if (!asset.busy) return;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      const next = await refresh();
      if (next && !next.busy) {
        const newest = next.revisions.filter((rev) => rev.status === 'succeeded').at(-1);
        if (newest) setSelectedId(newest.id);
        router.refresh();
      }
    }, 4000);
    return () => window.clearInterval(timer);
  }, [asset.busy, refresh, router]);

  // Opened from a product: offer the destination as soon as the image is approved.
  useEffect(() => {
    if (pour && asset.status === 'approved' && asset.usages.every((usage) => usage.status !== 'active')) setUseOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.status]);

  async function act(label: string, run: () => Promise<boolean>) {
    setPending(label);
    setError(null);
    try { await run(); } finally { setPending(null); }
  }

  const requestCorrection = () => act('correct', async () => {
    if (!selected || selected.status !== 'succeeded') return false;
    const result = await call<{ jobId: string }>(`/api/admin/studio/assets/${asset.id}/revisions`, {
      method: 'POST', body: JSON.stringify({ action: 'correct', baseRevisionId: selected.id, request: correction, requestKey: correctionKey.current }),
    });
    if (!result.ok) { setError(result.error); return false; }
    startJob(result.data.jobId);
    correctionKey.current = newRequestKey();
    setCorrection('');
    await refresh();
    return true;
  });

  const retry = (revision: StudioRevisionView) => act('retry', async () => {
    const result = await call<{ jobId: string }>(`/api/admin/studio/assets/${asset.id}/revisions`, {
      method: 'POST', body: JSON.stringify({ action: 'retry', revisionId: revision.id }),
    });
    if (!result.ok) { setError(result.error); return false; }
    startJob(result.data.jobId);
    await refresh();
    return true;
  });

  const decide = (action: 'approve' | 'discard' | 'restore') => act(action, async () => {
    const result = await call<{ status: string }>(`/api/admin/studio/assets/${asset.id}`, {
      method: 'PATCH', body: JSON.stringify({ action, revisionId: action === 'approve' ? selected?.id : undefined }),
    });
    if (!result.ok) { setError(result.error); return false; }
    await refresh();
    router.refresh();
    if (action === 'approve') toast.success('Version approuvée. Choisissez maintenant où l’utiliser.');
    if (action === 'discard') { toast.success('Image écartée'); router.push('/admin/studio'); }
    if (action === 'approve') setUseOpen(true);
    return true;
  });

  const removeUsage = (usageId: string) => act('remove', async () => {
    const result = await call<{ detached: boolean }>(`/api/admin/studio/usages/${usageId}`, { method: 'DELETE' });
    if (!result.ok) { setError(result.error); return false; }
    toast.success(result.data.detached ? 'Image retirée de cet emplacement' : 'L’emplacement montrait déjà une autre image : rien n’a été retiré.');
    setConfirm(null);
    await refresh();
    return true;
  });

  const statusMeta = STUDIO_ASSET_STATUS_META[asset.status] ?? { label: asset.status, tone: 'neutral' as const };
  const activeUsages = asset.usages.filter((usage) => usage.status === 'active');
  const latestFailed = latest?.status === 'failed' ? latest : null;
  // The Original/Proposition switch exists on phones only (desktop shows both side by side).
  const shownUrl = showOriginal ? asset.sourceUrl : selected?.imageUrl ?? null;
  const canCorrect = !asset.busy && selected?.status === 'succeeded' && (asset.status === 'review' || asset.status === 'approved');
  const isApprovedSelected = asset.status === 'approved' && asset.approvedRevisionId === selected?.id;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <section aria-label="Aperçu" className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusMeta.tone} dot>{statusMeta.label}</Badge>
          <Badge tone={asset.ambianceOnly ? 'warning' : 'neutral'}>{asset.ambianceOnly ? 'Idée · image d’ambiance' : 'À partir d’une photo'}</Badge>
          {asset.requestText && <span className="min-w-0 truncate text-sm text-a-text-2">« {asset.requestText} »</span>}
        </div>

        {asset.sourceUrl && selected?.imageUrl && (
          <div role="group" aria-label="Image affichée" className="grid grid-cols-2 gap-1 rounded-[10px] border border-a-border bg-a-surface-2 p-1 sm:max-w-xs md:hidden">
            {([false, true] as const).map((original) => (
              <button
                key={String(original)}
                type="button"
                aria-pressed={showOriginal === original}
                onClick={() => setShowOriginal(original)}
                className={cn('min-h-10 rounded-lg text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus', showOriginal === original ? 'bg-a-surface text-a-text shadow-sm' : 'text-a-text-2')}
              >
                {original ? 'Original' : 'Proposition'}
              </button>
            ))}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {asset.sourceUrl && (
            <figure className="hidden md:block">
              <figcaption className="mb-1 text-xs font-semibold text-a-text-3">Original</figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset.sourceUrl} alt="Photo d’origine" className="aspect-square w-full rounded-lg border border-a-border bg-white object-contain" />
            </figure>
          )}
          <figure className={cn(!asset.sourceUrl && 'md:col-span-2 md:max-w-xl')}>
            <figcaption className="mb-1 text-xs font-semibold text-a-text-3">
              {showOriginal ? 'Original' : selected ? `Proposition · version ${selected.revisionNo}` : 'Proposition'}
            </figcaption>
            <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-a-border bg-a-surface-2">
              {shownUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shownUrl} alt={showOriginal ? 'Photo d’origine' : `Proposition, version ${selected?.revisionNo ?? ''}`} className="h-full w-full bg-white object-contain" />
              ) : asset.busy ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                  <div className="h-1.5 w-40 overflow-hidden rounded-full bg-a-border" aria-hidden="true"><div className="h-full w-1/2 animate-pulse rounded-full bg-a-brand" /></div>
                  <p className="text-sm font-semibold text-a-text" aria-live="polite">Création en cours… environ 20 secondes</p>
                  <p className="text-xs text-a-text-3">Vous pouvez quitter la page : l’image vous attendra dans la bibliothèque.</p>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-sm text-a-text-3">Aucune proposition pour le moment.</div>
              )}
            </div>
          </figure>
        </div>

        {asset.busy && shownUrl && (
          <InlineAlert tone="info" title="Nouvelle version en cours">La correction demandée est en cours de création. La page se mettra à jour toute seule.</InlineAlert>
        )}

        {latestFailed && !asset.busy && (
          <InlineAlert
            tone="danger"
            title={succeeded.length ? 'La correction n’a pas abouti' : 'La création n’a pas abouti'}
            action={<Button variant="secondary" size="sm" onClick={() => void retry(latestFailed)} loading={pending === 'retry'}><IconRefresh size={16} aria-hidden="true" /> Réessayer</Button>}
          >
            {latestFailed.errorMessage} {succeeded.length ? 'La proposition précédente est conservée.' : 'Votre photo est conservée ; cet essai n’est pas décompté.'}
          </InlineAlert>
        )}

        {asset.revisions.length > 1 && (
          <div>
            <p className="mb-1 text-xs font-semibold text-a-text-3">Versions</p>
            <ul className="flex flex-wrap gap-2">
              {asset.revisions.map((rev) => {
                const meta = STUDIO_REVISION_STATUS_META[rev.status] ?? { label: rev.status, tone: 'neutral' as const };
                return (
                  <li key={rev.id}>
                    <button
                      type="button"
                      disabled={rev.status !== 'succeeded'}
                      aria-pressed={selected?.id === rev.id}
                      onClick={() => { setSelectedId(rev.id); setShowOriginal(false); }}
                      className={cn('flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus disabled:cursor-default',
                        selected?.id === rev.id ? 'border-a-brand bg-a-brand-soft text-a-brand-fg' : 'border-a-border bg-a-surface text-a-text-2')}
                      title={rev.requestText ?? undefined}
                    >
                      V{rev.revisionNo}
                      {asset.approvedRevisionId === rev.id ? <Badge tone="success">Approuvée</Badge> : rev.status !== 'succeeded' ? <Badge tone={meta.tone}>{meta.label}</Badge> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            {selected?.requestText && selected.revisionNo > 1 && <p className="mt-1 text-xs text-a-text-3">Correction demandée : « {selected.requestText} »</p>}
          </div>
        )}
      </section>

      <aside className="space-y-4">
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}

        {(asset.status === 'review' || asset.status === 'approved') && selected?.status === 'succeeded' && (
          <section aria-labelledby="studio-decide" className="space-y-3 rounded-[10px] border border-a-border bg-a-surface p-4">
            <h2 id="studio-decide" className="text-base font-semibold text-a-text">{isApprovedSelected ? 'Image prête' : 'Vérifier la proposition'}</h2>
            {asset.ambianceOnly && <p className="text-sm text-a-text-2">Image d’ambiance : vérifiez qu’elle ne montre ni emballage, ni logo, ni texte.</p>}
            {!asset.ambianceOnly && !isApprovedSelected && <p className="text-sm text-a-text-2">Vérifiez que le produit, son étiquette et son texte sont identiques à la photo d’origine.</p>}
            {isApprovedSelected ? (
              <Button className="w-full" onClick={() => setUseOpen(true)} disabled={asset.busy}><IconWand size={18} aria-hidden="true" /> Utiliser l’image</Button>
            ) : (
              <Button className="w-full" onClick={() => void decide('approve')} loading={pending === 'approve'} disabled={asset.busy}><IconCheck size={18} aria-hidden="true" /> Approuver cette version</Button>
            )}
          </section>
        )}

        {canCorrect && (
          <section aria-labelledby="studio-correct" className="space-y-3 rounded-[10px] border border-a-border bg-a-surface p-4">
            <h2 id="studio-correct" className="text-base font-semibold text-a-text">Demander une correction</h2>
            <FormField label="Que faut-il changer ?" hint={`À partir de la version ${selected!.revisionNo}. Une correction compte comme une création.`}>
              <Textarea rows={3} value={correction} onChange={(event) => setCorrection(event.target.value)} maxLength={STUDIO_LIMITS.requestChars} placeholder="Ex. moins de sauce, assiette blanche" />
            </FormField>
            <Button variant="secondary" className="w-full" onClick={() => void requestCorrection()} loading={pending === 'correct'} disabled={correction.trim().length < 3}>
              Demander une correction
            </Button>
          </section>
        )}

        <section aria-labelledby="studio-usages" className="space-y-2 rounded-[10px] border border-a-border bg-a-surface p-4">
          <h2 id="studio-usages" className="text-base font-semibold text-a-text">Utilisations</h2>
          {activeUsages.length === 0 ? (
            <p className="text-sm text-a-text-3">{asset.status === 'approved' ? 'Pas encore utilisée.' : 'Approuvez une version pour l’utiliser sur la boutique.'}</p>
          ) : (
            <ul className="divide-y divide-a-border">
              {activeUsages.map((usage) => (
                <li key={usage.id} className="flex items-start justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-a-text">{usage.destinationLabel}</p>
                    <p className="truncate text-xs text-a-text-3">{usage.targetLabel} · depuis le {formatDate(usage.createdAt)}</p>
                    {usage.manageHref && <Link href={usage.manageHref} className="inline-flex items-center gap-1 text-xs font-semibold text-a-brand-fg hover:underline">Ouvrir <IconExternalLink size={14} aria-hidden="true" /></Link>}
                  </div>
                  {usage.canRemove && (
                    <Button variant="ghost" size="sm" onClick={() => setConfirm({ usageId: usage.id, label: `${usage.destinationLabel} · ${usage.targetLabel ?? ''}` })}>Retirer d’ici</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {asset.status === 'approved' && activeUsages.length > 0 && (
            <Button variant="secondary" size="sm" onClick={() => setUseOpen(true)}>Utiliser ailleurs</Button>
          )}
        </section>

        <div className="flex flex-wrap gap-2">
          {asset.status === 'discarded' || asset.status === 'archived' ? (
            <Button variant="secondary" onClick={() => void decide('restore')} loading={pending === 'restore'}><IconArrowBackUp size={18} aria-hidden="true" /> Remettre dans la bibliothèque</Button>
          ) : activeUsages.length === 0 && !asset.busy ? (
            <Button variant="ghost" onClick={() => setConfirm('discard')}><IconTrash size={18} aria-hidden="true" /> Écarter l’image</Button>
          ) : null}
        </div>
        <p className="text-xs text-a-text-3">Créée le {formatDate(asset.createdAt, 'datetime')}{selected ? ` · style v${selected.styleVersion}` : ''}</p>
      </aside>

      <ConfirmDialog
        open={confirm === 'discard'}
        title="Écarter cette image ?"
        description="Elle quitte la bibliothèque. Vous pouvez la remettre pendant 7 jours, ensuite ses fichiers sont supprimés."
        confirmLabel="Écarter"
        destructive
        loading={pending === 'discard'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void decide('discard')}
      />
      <ConfirmDialog
        open={typeof confirm === 'object' && confirm !== null}
        title="Retirer l’image de cet emplacement ?"
        description={typeof confirm === 'object' && confirm ? `${confirm.label}. L’emplacement n’aura plus cette image sur la boutique. Les autres emplacements ne changent pas.` : undefined}
        confirmLabel="Retirer"
        destructive
        loading={pending === 'remove'}
        error={error}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { if (typeof confirm === 'object' && confirm) void removeUsage(confirm.usageId); }}
      />
      {useOpen && selected && asset.status === 'approved' && (
        <StudioUseDialog
          open={useOpen}
          onClose={() => setUseOpen(false)}
          assetId={asset.id}
          ambianceOnly={asset.ambianceOnly}
          image={approvedImage(asset, selected)}
          destinations={destinations}
          preselect={pour}
          onPublished={async () => { await refresh(); router.refresh(); }}
        />
      )}
    </div>
  );
}

function approvedImage(asset: StudioAssetDetail, fallback: StudioRevisionView) {
  const approved = asset.revisions.find((rev) => rev.id === asset.approvedRevisionId) ?? fallback;
  return { url: approved.imageUrl, width: approved.width ?? 1024, height: approved.height ?? 1024 };
}
