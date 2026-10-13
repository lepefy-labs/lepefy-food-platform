'use client';

import { useEffect, useRef, useState } from 'react';
import { IconPhoto, IconRotate, IconUpload } from '@tabler/icons-react';
import Button from '../../_components/ui/Button';
import Badge from '../../_components/ui/Badge';
import { Panel } from '../../_components/ui/Panel';
import { FormField, Select } from '../../_components/ui/Form';
import { ErrorText } from '../../_components/ui/InlineAlert';
import { useConfirm } from '../../_components/ui/ConfirmDialog';
import { useAdminMutation } from '../../_components/ui/useAdminMutation';

export type CardHeroSource = 'custom' | 'default' | 'none';

interface CardHeroSectionProps {
  /** Photo actuellement affichée sur /card (téléversée, par défaut du tenant, ou aucune). */
  preview: { src: string; srcSet?: string; mobilePosition: string; position: string } | null;
  source: CardHeroSource;
  position: string | null;
  /** Sans `tenant_settings.manage` : consultation seule. */
  readOnly?: boolean;
}

// Préréglages de cadrage (CSS object-position) : le sujet reste visible sur mobile comme sur ordinateur.
const FRAMING = [
  { value: '', label: 'Automatique' },
  { value: 'center', label: 'Centré' },
  { value: '72% 35%', label: 'Sujet à droite' },
  { value: '28% 35%', label: 'Sujet à gauche' },
  { value: 'center 20%', label: 'Haut de la photo' },
  { value: 'center 80%', label: 'Bas de la photo' },
];

const SOURCE_BADGE: Record<CardHeroSource, { label: string; tone: 'success' | 'neutral' }> = {
  custom: { label: 'Photo personnalisée', tone: 'success' },
  default: { label: 'Photo par défaut', tone: 'neutral' },
  none: { label: 'Aucune photo · dégradé de couleur', tone: 'neutral' },
};

// Les fonctions Vercel refusent un corps de requête > 4,5 Mo : une photo de
// téléphone est réduite dans le navigateur avant l'envoi (le serveur génère
// ensuite les variantes 480/800/1200 px).
const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;
const MAX_UPLOAD_WIDTH = 2400;

async function prepareUpload(file: File): Promise<Blob> {
  if (file.size <= MAX_UPLOAD_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_UPLOAD_WIDTH / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    return blob ?? file;
  } catch {
    return file;
  }
}

/** Photo de la hero de la carte digitale (/card) : téléversement, cadrage, retour à la photo par défaut. */
export function CardHeroSection({ preview, source, position, readOnly = false }: CardHeroSectionProps) {
  const upload = useAdminMutation();
  const save = useAdminMutation();
  const [ask, confirmDialog] = useConfirm();
  const fileInput = useRef<HTMLInputElement>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [framing, setFraming] = useState(position ?? '');

  useEffect(() => () => { if (localPreview) URL.revokeObjectURL(localPreview); }, [localPreview]);
  useEffect(() => setFraming(position ?? ''), [position]);

  const objectPosition = framing || preview?.position || 'center';
  const mobilePosition = framing || preview?.mobilePosition || 'center';
  const src = localPreview ?? preview?.src ?? null;
  const srcSet = localPreview ? undefined : preview?.srcSet;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setLocalPreview(URL.createObjectURL(file));
    const form = new FormData();
    const prepared = await prepareUpload(file);
    form.append('file', prepared instanceof File ? prepared : new File([prepared], 'photo.jpg', { type: 'image/jpeg' }));
    const result = await upload.run('/api/admin/card/hero-image', { form, method: 'POST', successMessage: 'Photo de la carte mise à jour' });
    setLocalPreview(null);
    if (fileInput.current) fileInput.current.value = '';
    if (!result) return;
  }

  async function handleFraming(value: string) {
    setFraming(value);
    await save.run('/api/admin/card/settings', { method: 'PATCH', body: { hero_image_position: value || null }, successMessage: 'Cadrage enregistré' });
  }

  async function handleReset() {
    const confirmed = await ask({
      title: 'Revenir à la photo par défaut ?',
      description: 'La photo téléversée est supprimée. La carte affiche à nouveau la photo par défaut de la boutique, ou un dégradé de couleur s’il n’y en a pas.',
      confirmLabel: 'Revenir à la photo par défaut',
      destructive: true,
    });
    if (!confirmed) return;
    await save.run('/api/admin/card/settings', { method: 'PATCH', body: { reset_hero: true }, successMessage: 'Photo par défaut rétablie' });
  }

  const badge = SOURCE_BADGE[localPreview ? 'custom' : source];

  return (
    <Panel
      id="photo-carte"
      title="Photo de la carte digitale"
      description="Grande photo en haut de la carte digitale (/card). Idéalement une personne qui paie en boutique, avec le geste du paiement bien visible."
      actions={<Badge tone={badge.tone} dot>{badge.label}</Badge>}
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-wrap items-end gap-4">
          <figure className="w-[180px] shrink-0">
            <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-a-border bg-a-surface-2">
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element -- aperçu : fichier local ou variantes déjà optimisées
                <img src={src} srcSet={srcSet} sizes="180px" alt="Aperçu mobile de la photo" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: mobilePosition }} />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center text-a-text-3"><IconPhoto size={28} aria-hidden="true" /></span>
              )}
            </div>
            <figcaption className="mt-1.5 text-xs text-a-text-3">Mobile</figcaption>
          </figure>
          <figure className="w-[150px] shrink-0">
            <div className="relative aspect-[1/1] overflow-hidden rounded-lg border border-a-border bg-a-surface-2">
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element -- aperçu : fichier local ou variantes déjà optimisées
                <img src={src} srcSet={srcSet} sizes="150px" alt="Aperçu ordinateur de la photo" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition }} />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center text-a-text-3"><IconPhoto size={28} aria-hidden="true" /></span>
              )}
            </div>
            <figcaption className="mt-1.5 text-xs text-a-text-3">Ordinateur (colonne de droite)</figcaption>
          </figure>
        </div>

        <div className="space-y-4">
          <div>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="sr-only"
              id="card-hero-file"
              onChange={(event) => handleFile(event.target.files?.[0])}
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => fileInput.current?.click()} loading={upload.pending} disabled={readOnly}>
                <IconUpload size={16} aria-hidden="true" />{source === 'custom' ? 'Remplacer la photo' : 'Choisir une photo'}
              </Button>
              {source === 'custom' && (
                <Button variant="secondary" onClick={handleReset} disabled={readOnly || save.pending || upload.pending}>
                  <IconRotate size={16} aria-hidden="true" />Revenir à la photo par défaut
                </Button>
              )}
            </div>
            <p className="mt-1.5 text-xs leading-5 text-a-text-3">JPEG, PNG, WebP ou AVIF · photos de téléphone acceptées (réduites automatiquement) · 1 200 px de large conseillés. Les versions mobile et ordinateur sont générées automatiquement.</p>
            <ErrorText message={upload.error} />
          </div>

          <FormField label="Cadrage" hint="Choisissez où se trouve le sujet pour qu’il reste visible sur tous les écrans.">
            <Select value={framing} onChange={(event) => handleFraming(event.target.value)} disabled={readOnly || save.pending || !src}>
              {FRAMING.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </FormField>
          <ErrorText message={save.error} />
        </div>
      </div>
      {confirmDialog}
    </Panel>
  );
}
