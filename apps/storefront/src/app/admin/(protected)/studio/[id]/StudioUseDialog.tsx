'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { IconArrowLeft } from '@tabler/icons-react';
import Dialog from '../../../_components/ui/Dialog';
import Button from '../../../_components/ui/Button';
import InlineAlert from '../../../_components/ui/InlineAlert';
import { Input } from '../../../_components/ui/Form';
import { useAdminToast } from '../../../_components/ui/Toaster';
import { cn } from '@/lib/utils/cn';
import { SINGLETON_TARGET, type StudioDestinationDefinition } from '@/lib/studio/destinations';
import { aspectValue, centeredCrop } from '@/lib/studio/rules';
import type { StudioCrop } from '@/lib/studio/domain';
import { newRequestKey } from '../studioClient';

interface Target { id: string; label: string; detail?: string | null; imageUrl?: string | null }

interface Props {
  open: boolean;
  onClose: () => void;
  assetId: string;
  ambianceOnly: boolean;
  image: { url: string | null; width: number; height: number };
  destinations: StudioDestinationDefinition[];
  preselect: { destination: string; targetId: string } | null;
  onPublished: () => Promise<void> | void;
}

/**
 * « Utiliser l’image »: 1. where (destinations this admin may edit),
 * 2. which element, 3. format preview (move the frame) then « Confirmer et
 * publier ». Nothing is public before the last step.
 */
export default function StudioUseDialog({ open, onClose, assetId, ambianceOnly, image, destinations, preselect, onPublished }: Props) {
  const toast = useAdminToast();
  const initial = destinations.find((d) => d.key === preselect?.destination) ?? null;
  const [step, setStep] = useState<1 | 2 | 3>(initial ? 2 : 1);
  const [destination, setDestination] = useState<StudioDestinationDefinition | null>(initial);
  const [query, setQuery] = useState('');
  const [targets, setTargets] = useState<Target[]>([]);
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [asCover, setAsCover] = useState(false);
  const [confirmAmbiance, setConfirmAmbiance] = useState(false);
  const [crop, setCrop] = useState<StudioCrop | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestKey = useRef(newRequestKey());

  const ratio = aspectValue(destination?.aspect ?? null);
  const needsAmbiance = ambianceOnly && Boolean(destination?.confirmAmbiance);

  // Targets of the chosen destination (server search, tenant-scoped).
  useEffect(() => {
    if (!destination || step !== 2) return;
    if (destination.singleton) { setTargets([{ id: SINGLETON_TARGET, label: destination.label }]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoadingTargets(true);
      try {
        const params = new URLSearchParams({ key: destination.key });
        if (query.trim()) params.set('q', query.trim());
        const response = await fetch(`/api/admin/studio/destinations?${params}`, { signal: controller.signal });
        const json = await response.json().catch(() => ({})) as { targets?: Target[]; error?: string };
        if (!response.ok) { setError(json.error ?? 'Liste indisponible.'); return; }
        setTargets(json.targets ?? []);
        if (preselect && destination.key === preselect.destination && !target) {
          const match = (json.targets ?? []).find((item) => item.id === preselect.targetId);
          if (match) setTarget(match);
        }
      } catch { /* aborted */ } finally { setLoadingTargets(false); }
    }, query ? 300 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination, step, query]);

  // Preselected product (from its editor) without search: fetch once with its id.
  useEffect(() => { if (destination?.singleton) setTarget({ id: SINGLETON_TARGET, label: destination.label }); }, [destination]);

  useEffect(() => { setCrop(centeredCrop(image.width, image.height, ratio)); }, [image.width, image.height, ratio]);

  function chooseDestination(next: StudioDestinationDefinition) {
    setDestination(next);
    setTarget(next.singleton ? { id: SINGLETON_TARGET, label: next.label } : null);
    setQuery('');
    setTargets([]);
    setError(null);
    setAsCover(false);
    setConfirmAmbiance(false);
    requestKey.current = newRequestKey();
    setStep(2);
  }

  async function publish() {
    if (!destination || !target) return;
    setPublishing(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/studio/assets/${assetId}/usages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: destination.key, targetId: target.id, crop, asCover, confirmAmbiance, requestKey: requestKey.current }),
      });
      const json = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(json.error ?? 'La publication n’a pas abouti. Réessayez.'); return; }
      requestKey.current = newRequestKey();
      toast.success(`Image publiée : ${destination.label} · ${target.label}`);
      await onPublished();
      onClose();
    } catch {
      setError('Connexion impossible. Rien n’a été publié : réessayez.');
    } finally {
      setPublishing(false);
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, StudioDestinationDefinition[]>();
    for (const item of destinations) map.set(item.group, [...(map.get(item.group) ?? []), item]);
    return [...map.entries()];
  }, [destinations]);

  const footer = step === 1 ? (
    <Button variant="secondary" onClick={onClose}>Fermer</Button>
  ) : step === 2 ? (
    <>
      <Button variant="secondary" onClick={() => setStep(1)}><IconArrowLeft size={16} aria-hidden="true" /> Retour</Button>
      <Button onClick={() => setStep(3)} disabled={!target || (needsAmbiance && !confirmAmbiance)}>Voir l’aperçu</Button>
    </>
  ) : (
    <>
      <Button variant="secondary" onClick={() => setStep(2)} disabled={publishing}><IconArrowLeft size={16} aria-hidden="true" /> Retour</Button>
      <Button onClick={() => void publish()} loading={publishing}>Confirmer et publier</Button>
    </>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!publishing}
      size="lg"
      title={step === 1 ? 'Où utiliser l’image ?' : step === 2 ? destination?.label ?? '' : 'Aperçu'}
      description={step === 1 ? 'Seuls les emplacements que vous pouvez modifier sont proposés.' : step === 2 ? destination?.hint : `${destination?.label} · ${target?.label} · ${destination?.aspectLabel}`}
      footer={footer}
    >
      {step === 1 && (
        destinations.length === 0 ? (
          <InlineAlert tone="warning">Aucun emplacement disponible avec vos droits. Demandez à un administrateur de la boutique.</InlineAlert>
        ) : (
          <div className="space-y-4">
            {groups.map(([group, items]) => (
              <fieldset key={group}>
                <legend className="mb-1 text-xs font-semibold text-a-text-3">{group}</legend>
                <ul className="space-y-1.5">
                  {items.map((item) => (
                    <li key={item.key}>
                      <button type="button" onClick={() => chooseDestination(item)} className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border border-a-border bg-a-surface px-3 py-2 text-left hover:border-a-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus">
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-a-text">{item.label}</span>
                          <span className="block text-xs text-a-text-3">{item.hint}</span>
                        </span>
                        <span className="shrink-0 text-xs text-a-text-3">{item.aspectLabel}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </fieldset>
            ))}
          </div>
        )
      )}

      {step === 2 && destination && (
        <div className="space-y-3">
          {!destination.singleton && (
            <>
              <label htmlFor="studio-target-search" className="sr-only">Rechercher</label>
              <Input id="studio-target-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Rechercher un ${destination.targetNoun}`} autoComplete="off" />
              <ul className="max-h-72 space-y-1 overflow-y-auto" aria-busy={loadingTargets}>
                {targets.map((item) => (
                  <li key={item.id}>
                    <button type="button" aria-pressed={target?.id === item.id} onClick={() => setTarget(item)}
                      className={cn('flex min-h-12 w-full items-center gap-3 rounded-lg border px-2 py-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus',
                        target?.id === item.id ? 'border-a-brand bg-a-brand-soft' : 'border-a-border bg-a-surface hover:border-a-border-strong')}>
                      <span className="h-10 w-10 shrink-0 overflow-hidden rounded bg-a-surface-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {item.imageUrl && <img src={item.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-a-text">{item.label}</span>
                        {item.detail && <span className="block text-xs text-a-text-3">{item.detail}</span>}
                      </span>
                    </button>
                  </li>
                ))}
                {!loadingTargets && targets.length === 0 && <li className="px-1 py-3 text-sm text-a-text-3">Aucun résultat.</li>}
              </ul>
            </>
          )}
          {destination.key === 'product' && (
            <label className="flex min-h-11 items-center gap-2 text-sm text-a-text">
              <input type="checkbox" checked={asCover} onChange={(event) => setAsCover(event.target.checked)} className="h-4 w-4 rounded border-a-field" />
              Image principale (couverture du produit)
            </label>
          )}
          {needsAmbiance && (
            <InlineAlert tone="warning" title="Image créée sans photo">
              <label className="mt-1 flex items-start gap-2">
                <input type="checkbox" checked={confirmAmbiance} onChange={(event) => setConfirmAmbiance(event.target.checked)} className="mt-1 h-4 w-4 rounded border-a-field" />
                <span>Je confirme qu’il s’agit d’une illustration : elle ne montre pas l’emballage, la marque ni les caractéristiques réelles du produit.</span>
              </label>
            </InlineAlert>
          )}
        </div>
      )}

      {step === 3 && destination && (
        <div className="space-y-3">
          {image.url && crop ? (
            <CropPreview url={image.url} width={image.width} height={image.height} crop={crop} movable={Boolean(ratio)} onChange={setCrop} />
          ) : (
            <InlineAlert tone="danger">Aperçu indisponible. Fermez puis rouvrez l’image.</InlineAlert>
          )}
          <p className="text-xs text-a-text-3">
            {ratio ? 'La zone claire sera publiée. Faites-la glisser pour ajuster le cadrage.' : 'L’image garde son format d’origine.'} Une copie dédiée est créée pour cet emplacement.
          </p>
          <InlineAlert tone="info">Visible sur la boutique après confirmation.</InlineAlert>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        </div>
      )}
    </Dialog>
  );
}

/** Image with the destination frame; the frame moves (pointer or arrows), never resizes. */
function CropPreview({ url, width, height, crop, movable, onChange }: { url: string; width: number; height: number; crop: StudioCrop; movable: boolean; onChange: (crop: StudioCrop) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; crop: StudioCrop } | null>(null);
  const clamp = (next: StudioCrop): StudioCrop => ({
    ...next,
    x: Math.min(Math.max(0, next.x), 1 - next.width),
    y: Math.min(Math.max(0, next.y), 1 - next.height),
  });
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!movable) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, crop };
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current || !box.current) return;
    const rect = box.current.getBoundingClientRect();
    onChange(clamp({ ...drag.current.crop, x: drag.current.crop.x + (event.clientX - drag.current.x) / rect.width, y: drag.current.crop.y + (event.clientY - drag.current.y) / rect.height }));
  }
  const step = 0.02;
  return (
    <div ref={box} className="relative mx-auto w-full max-w-md select-none overflow-hidden rounded-lg border border-a-border bg-white" style={{ aspectRatio: `${width} / ${height}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Image approuvée" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
      <div
        role={movable ? 'slider' : undefined}
        aria-label={movable ? 'Position du cadrage' : undefined}
        aria-valuetext={movable ? `${Math.round(crop.x * 100)} %, ${Math.round(crop.y * 100)} %` : undefined}
        tabIndex={movable ? 0 : undefined}
        onKeyDown={(event) => {
          if (!movable) return;
          const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
          if (!delta) return;
          event.preventDefault();
          onChange(clamp({ ...crop, x: crop.x + delta[0]!, y: crop.y + delta[1]! }));
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => { drag.current = null; }}
        className={cn('absolute rounded border-2 border-a-brand shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus', movable && 'cursor-move touch-none')}
        style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}
      />
    </div>
  );
}
