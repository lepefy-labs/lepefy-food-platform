'use client';

import { useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconCamera, IconPhoto, IconSparkles, IconX } from '@tabler/icons-react';
import Button from '../../_components/ui/Button';
import InlineAlert from '../../_components/ui/InlineAlert';
import { FormField, Input, Textarea } from '../../_components/ui/Form';
import { cn } from '@/lib/utils/cn';
import { STUDIO_LIMITS, type StudioOrigin } from '@/lib/studio/domain';
import { ACCEPTED_PHOTO_TYPES, newRequestKey, startJob, uploadPhoto } from './studioClient';

interface StudioCreatePanelProps {
  styleSummary: string;
  styleVersion: number;
  remaining: number;
  /** `product:<id>` from « Générer avec l’IA » of a product: carried to the image page. */
  pour: string | null;
  pourLabel: string | null;
}

/**
 * « Créer une image »: from a photo (gallery, camera, photo received on
 * WhatsApp) with an optional request, or from an idea. The photo goes straight
 * to private storage; the page then opens the image, which updates by itself
 * while the proposal is being made (the user may leave).
 */
export default function StudioCreatePanel({ styleSummary, styleVersion, remaining, pour, pourLabel }: StudioCreatePanelProps) {
  const router = useRouter();
  const [origin, setOrigin] = useState<StudioOrigin>('photo');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [request, setRequest] = useState('');
  const [title, setTitle] = useState('');
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'creating'>('idle');
  const [error, setError] = useState<string | null>(null);
  const requestKey = useRef(newRequestKey());
  const uploadedPath = useRef<{ file: File; path: string } | null>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const tabsId = useId();

  const busy = phase !== 'idle';
  const exhausted = remaining <= 0;
  const canSubmit = !busy && !exhausted && (origin === 'photo' ? Boolean(file) : request.trim().length >= 3);

  function pick(next: File | null) {
    setError(null);
    if (preview) URL.revokeObjectURL(preview);
    setFile(next);
    setPreview(next ? URL.createObjectURL(next) : null);
    uploadedPath.current = null;
    requestKey.current = newRequestKey();
  }

  function switchOrigin(next: StudioOrigin) {
    if (busy) return;
    setOrigin(next);
    setError(null);
    requestKey.current = newRequestKey();
  }

  async function submit() {
    if (!canSubmit) return;
    setError(null);
    try {
      let uploadPath: string | null = null;
      if (origin === 'photo' && file) {
        if (uploadedPath.current?.file === file) {
          uploadPath = uploadedPath.current.path;
        } else {
          setPhase('uploading');
          uploadPath = await uploadPhoto(file);
          uploadedPath.current = { file, path: uploadPath };
        }
      }
      setPhase('creating');
      const response = await fetch('/api/admin/studio/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, request: request.trim() || null, title: title.trim() || null, uploadPath, requestKey: requestKey.current }),
      });
      const json = await response.json().catch(() => ({})) as { assetId?: string; jobId?: string; error?: string };
      if (!response.ok || !json.assetId) throw new Error(json.error ?? 'La création n’a pas pu démarrer. Réessayez.');
      if (json.jobId) startJob(json.jobId);
      router.push(`/admin/studio/${json.assetId}${pour ? `?pour=${encodeURIComponent(pour)}` : ''}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'La création n’a pas pu démarrer. Réessayez.');
      setPhase('idle');
    }
  }

  return (
    <section id="creer" aria-labelledby={`${tabsId}-title`} className="scroll-mt-20 rounded-[10px] border border-a-border bg-a-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${tabsId}-title`} className="text-base font-semibold text-a-text">Créer une image</h2>
        <p className="text-xs text-a-text-3">{exhausted ? 'Plus de création ce mois-ci' : `Il reste ${remaining} création${remaining > 1 ? 's' : ''} ce mois-ci`}</p>
      </div>

      {pour && pourLabel && (
        <p className="mt-2 text-sm text-a-text-2">Pour : <span className="font-semibold text-a-text">{pourLabel}</span>. Vous choisirez où l’utiliser après l’avoir vérifiée.</p>
      )}

      <div role="group" aria-label="Point de départ" className="mt-4 grid grid-cols-2 gap-1 rounded-[10px] border border-a-border bg-a-surface-2 p-1">
        {([['photo', 'À partir d’une photo', 'Photo', IconPhoto], ['prompt', 'Créer avec une idée', 'Idée', IconSparkles]] as const).map(([value, label, short, Icon]) => (
          <button
            key={value}
            type="button"
            aria-pressed={origin === value}
            onClick={() => switchOrigin(value)}
            className={cn(
              'flex min-h-11 items-center justify-center gap-2 rounded-lg px-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus',
              origin === value ? 'bg-a-surface text-a-text shadow-sm' : 'text-a-text-2 hover:text-a-text',
            )}
          >
            <Icon size={18} aria-hidden="true" />
            <span className="truncate sm:hidden">{short}</span>
            <span className="hidden truncate sm:inline">{label}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-4">
        {origin === 'photo' ? (
          <>
            {preview ? (
              <div className="relative overflow-hidden rounded-lg border border-a-border bg-a-surface-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="Photo choisie" className="mx-auto max-h-72 w-auto object-contain" />
                <button
                  type="button"
                  onClick={() => pick(null)}
                  disabled={busy}
                  className="absolute right-2 top-2 inline-flex min-h-10 items-center gap-1 rounded-full bg-a-surface px-3 text-sm font-semibold text-a-text shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus"
                >
                  <IconX size={16} aria-hidden="true" /> Changer
                </button>
              </div>
            ) : (
              <div className="rounded-lg border-2 border-dashed border-a-field bg-a-surface-2 p-4 text-center">
                <p className="text-sm font-semibold text-a-text">Choisir une photo</p>
                <p className="mt-1 text-xs text-a-text-3">Galerie, appareil photo ou photo reçue sur WhatsApp · JPEG, PNG ou WebP</p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <Button variant="secondary" onClick={() => galleryInput.current?.click()}>
                    <IconPhoto size={18} aria-hidden="true" /> Galerie
                  </Button>
                  <Button variant="secondary" onClick={() => cameraInput.current?.click()} className="sm:hidden">
                    <IconCamera size={18} aria-hidden="true" /> Prendre une photo
                  </Button>
                </div>
              </div>
            )}
            <input ref={galleryInput} type="file" accept={ACCEPTED_PHOTO_TYPES} className="hidden" onChange={(event) => pick(event.target.files?.[0] ?? null)} />
            <input ref={cameraInput} type="file" accept={ACCEPTED_PHOTO_TYPES} capture="environment" className="hidden" onChange={(event) => pick(event.target.files?.[0] ?? null)} />
            <FormField label="Votre demande" optional hint="Ex. enlever le piment rouge, garder le plat identique.">
              <Textarea value={request} onChange={(event) => setRequest(event.target.value)} rows={2} maxLength={STUDIO_LIMITS.requestChars} placeholder="Laissez vide pour seulement embellir la photo" />
            </FormField>
          </>
        ) : (
          <>
            <FormField label="Décrivez votre image" hint="Ex. des bananes plantain vertes sur un plan de travail clair, lumière du matin.">
              <Textarea value={request} onChange={(event) => setRequest(event.target.value)} rows={4} maxLength={STUDIO_LIMITS.requestChars} />
            </FormField>
            <InlineAlert tone="warning" title="Image d’ambiance uniquement">
              Sans emballage, logo, texte ni marque. Pour montrer un produit réel, partez d’une photo du produit.
            </InlineAlert>
          </>
        )}

        <FormField label="Nom de l’image" optional hint="Pour la retrouver dans la bibliothèque.">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={STUDIO_LIMITS.titleChars} />
        </FormField>

        <InlineAlert tone="info" title="Le style de votre boutique est appliqué">
          {styleSummary} (version {styleVersion}). Aucun réglage technique à choisir.
        </InlineAlert>

        {error && <InlineAlert tone="danger" title="Création impossible">{error}</InlineAlert>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-a-text-3">Vous pourrez quitter la page : l’image vous attendra dans la bibliothèque.</p>
          <Button onClick={() => void submit()} disabled={!canSubmit} loading={busy} className="w-full sm:w-auto">
            {phase === 'uploading' ? 'Envoi de la photo…' : phase === 'creating' ? 'Démarrage…' : origin === 'photo' ? 'Créer une proposition' : 'Créer l’image'}
          </Button>
        </div>
      </div>
    </section>
  );
}
