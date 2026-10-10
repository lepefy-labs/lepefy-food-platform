'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconChevronUp, IconChevronDown, IconPhoto, IconTrash, IconPlus } from '@tabler/icons-react';
import { VARIANT_BACKGROUND } from '@/components/home/HeroCarousel';
import { moveId, safeSlideHref, SLIDE_LIMITS, slideIssues, VARIANT_LABELS, VALID_VARIANTS } from '@/lib/home/heroSlideRules';
import type { TenantHeroSlide, HeroSlideBackgroundVariant } from '@lepefy/types';
import ConfirmDialog from '../../_components/ui/ConfirmDialog';

const INPUT_CLS =
  'w-full border border-a-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-a-focus focus:border-transparent bg-a-surface text-a-text';
const LABEL_CLS = 'text-a-text-3 text-xs font-medium mb-1 block';

interface SlideFormState {
  badge_text: string;
  title: string;
  subtitle: string;
  cta_primary_label: string;
  cta_primary_url: string;
  cta_secondary_label: string;
  cta_secondary_url: string;
  image_url: string;
  background_variant: HeroSlideBackgroundVariant;
  active: boolean;
}

function toFormState(slide?: TenantHeroSlide): SlideFormState {
  return {
    badge_text:          slide?.badge_text ?? '',
    title:               slide?.title ?? '',
    subtitle:            slide?.subtitle ?? '',
    cta_primary_label:   slide?.cta_primary_label ?? '',
    cta_primary_url:     slide?.cta_primary_url ?? '',
    cta_secondary_label: slide?.cta_secondary_label ?? '',
    cta_secondary_url:   slide?.cta_secondary_url ?? '',
    image_url:           slide?.image_url ?? '',
    background_variant:  slide?.background_variant ?? 'primary',
    active:              slide?.active ?? true,
  };
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? fallback;
}

/** Same gradients, text colours and layout cues as the storefront carousel. */
function SlidePreview({ form }: { form: SlideFormState }) {
  const primary = form.cta_primary_label.trim() && safeSlideHref(form.cta_primary_url);
  const secondary = form.cta_secondary_label.trim() && safeSlideHref(form.cta_secondary_url);
  return (
    <div className="relative overflow-hidden rounded-xl" style={{ backgroundImage: VARIANT_BACKGROUND[form.background_variant] }} aria-label="Aperçu de la slide">
      <div className="grid min-h-[150px] grid-cols-[1fr_auto] items-center gap-3 p-4">
        <div className="min-w-0">
          {form.badge_text.trim() && <span className="mb-2 inline-block rounded-full px-2 py-0.5 text-xs font-bold" style={{ backgroundColor: 'var(--color-secondary)', color: '#1a1a1a' }}>{form.badge_text}</span>}
          <p className="text-lg font-bold leading-tight text-white">{form.title.trim() || 'Titre de la slide'}</p>
          {form.subtitle.trim() && <p className="mt-1 line-clamp-2 text-xs text-white/90">{form.subtitle}</p>}
          {(primary || secondary) && <div className="mt-3 flex flex-wrap gap-1.5">
            {primary && <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-[var(--tenant-primary)]">{form.cta_primary_label}</span>}
            {secondary && <span className="rounded-full border border-white/60 px-3 py-1 text-xs font-semibold text-white">{form.cta_secondary_label}</span>}
          </div>}
        </div>
        {form.image_url && <div className="h-24 w-24 rounded-lg bg-cover bg-center sm:h-28 sm:w-40" style={{ backgroundImage: `url(${form.image_url})` }} />}
      </div>
    </div>
  );
}

interface SlideFormProps {
  initial?: TenantHeroSlide;
  submitLabel: string;
  isSaving: boolean;
  onSubmit: (form: SlideFormState) => void;
  onCancel?: () => void;
}

function SlideForm({ initial, submitLabel, isSaving, onSubmit, onCancel }: SlideFormProps) {
  const [form, setForm] = useState<SlideFormState>(toFormState(initial));
  const [showIssues, setShowIssues] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const issues = slideIssues(form);
  const id = initial?.id ?? 'new';

  function set<K extends keyof SlideFormState>(key: K, value: SlideFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit() {
    setShowIssues(true);
    if (issues.length === 0) onSubmit(form);
  }

  async function uploadImage(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('kind', 'hero-slide');
      const response = await fetch('/api/admin/hero-slides/upload-image', { method: 'POST', body });
      const data = await response.json().catch(() => ({})) as { imageUrl?: string; error?: string };
      if (!response.ok || !data.imageUrl) throw new Error(data.error ?? 'Échec du téléversement.');
      set('image_url', data.imageUrl);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Échec du téléversement.');
    } finally {
      setUploading(false);
    }
  }

  const field = (key: keyof SlideFormState, label: string, max: number, placeholder?: string) => (
    <div>
      <label htmlFor={`${key}-${id}`} className={LABEL_CLS}>{label}</label>
      <input id={`${key}-${id}`} type="text" maxLength={max} value={String(form[key])} onChange={(e) => set(key, e.target.value as never)} className={INPUT_CLS} placeholder={placeholder} />
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        {field('badge_text', 'Badge (optionnel)', SLIDE_LIMITS.badge, 'Ex. Nouveauté')}
        {field('title', 'Titre *', SLIDE_LIMITS.title)}
        <div>
          <label htmlFor={`subtitle-${id}`} className={LABEL_CLS}>Sous-titre (optionnel)</label>
          <textarea id={`subtitle-${id}`} value={form.subtitle} maxLength={SLIDE_LIMITS.subtitle} onChange={(e) => set('subtitle', e.target.value)} rows={2} className={`${INPUT_CLS} resize-none`} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {field('cta_primary_label', 'Bouton principal — texte', SLIDE_LIMITS.ctaLabel, 'Découvrir le catalogue')}
          {field('cta_primary_url', 'Bouton principal — lien', SLIDE_LIMITS.url, '/products')}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {field('cta_secondary_label', 'Bouton secondaire — texte', SLIDE_LIMITS.ctaLabel)}
          {field('cta_secondary_url', 'Bouton secondaire — lien', SLIDE_LIMITS.url, '/evenements')}
        </div>
        <p className="text-xs text-a-text-3">Lien : une page de la boutique commençant par « / » ou une adresse « https:// ».</p>
        <div>
          <label htmlFor={`variant-${id}`} className={LABEL_CLS}>Fond</label>
          <select id={`variant-${id}`} value={form.background_variant} onChange={(e) => set('background_variant', e.target.value as HeroSlideBackgroundVariant)} className={INPUT_CLS}>
            {VALID_VARIANTS.map((variant) => <option key={variant} value={variant}>{VARIANT_LABELS[variant]}</option>)}
          </select>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm text-a-text-2">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} className="h-5 w-5" />
          Afficher sur la page d’accueil
        </label>
      </div>

      <div className="space-y-3">
        <p className={LABEL_CLS}>Aperçu</p>
        <SlidePreview form={form} />
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-a-border bg-a-surface px-3 py-2 text-xs font-medium">
            <IconPhoto size={14} />
            {uploading ? 'Téléversement…' : form.image_url ? 'Remplacer l’image' : 'Ajouter une image (optionnelle)'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadImage(file);
                event.target.value = '';
              }}
            />
          </label>
          {form.image_url && <button type="button" onClick={() => set('image_url', '')} className="min-h-11 px-3 py-2 text-xs text-tone-danger-fg">Retirer l’image</button>}
        </div>
        {uploadError && <p role="alert" className="rounded-lg bg-tone-danger-bg px-3 py-2 text-xs text-tone-danger-fg">{uploadError}</p>}
      </div>

      {showIssues && issues.length > 0 && (
        <ul role="alert" className="space-y-1 rounded-lg bg-tone-danger-bg px-3 py-2 text-xs text-tone-danger-fg lg:col-span-2">
          {issues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      )}

      <div className="flex items-center gap-2 lg:col-span-2">
        <button onClick={handleSubmit} disabled={isSaving || uploading} className="min-h-11 rounded-lg bg-a-brand px-4 py-2 text-xs text-a-on-brand disabled:opacity-50">
          {isSaving ? 'Enregistrement…' : submitLabel}
        </button>
        {onCancel && (
          <button onClick={onCancel} disabled={isSaving} className="min-h-11 rounded-lg border border-a-border px-4 py-2 text-xs text-a-text-3 disabled:opacity-50">
            Annuler
          </button>
        )}
      </div>
    </div>
  );
}

interface HeroSlidesSectionProps {
  initialSlides: TenantHeroSlide[];
}

export function HeroSlidesSection({ initialSlides }: HeroSlidesSectionProps) {
  const router = useRouter();
  const [slides, setSlides] = useState<TenantHeroSlide[]>([...initialSlides].sort((a, b) => a.position - b.position));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingLastDeactivate, setPendingLastDeactivate] = useState<TenantHeroSlide | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const activeCount = slides.filter((slide) => slide.active).length;

  async function handleCreate(form: SlideFormState) {
    setSavingId('new');
    setMessage(null);
    try {
      const res = await fetch('/api/admin/hero-slides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!res.ok) { setMessage({ text: await errorOf(res, 'Création impossible.'), tone: 'error' }); return; }
      const created = await res.json() as TenantHeroSlide;
      setSlides((prev) => [...prev, created].sort((a, b) => a.position - b.position));
      setCreating(false);
      setMessage({ text: 'Slide ajoutée. Elle est visible sur la page d’accueil.', tone: 'ok' });
    } catch {
      setMessage({ text: 'Erreur réseau — réessayez.', tone: 'error' });
    } finally {
      setSavingId(null);
    }
  }

  async function patchSlide(id: string, payload: object): Promise<TenantHeroSlide | null> {
    try {
      const res = await fetch(`/api/admin/hero-slides/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) { setMessage({ text: await errorOf(res, 'Enregistrement impossible.'), tone: 'error' }); return null; }
      return await res.json() as TenantHeroSlide;
    } catch {
      setMessage({ text: 'Erreur réseau — réessayez.', tone: 'error' });
      return null;
    }
  }

  async function handleUpdate(id: string, form: SlideFormState) {
    setSavingId(id);
    setMessage(null);
    const current = slides.find((slide) => slide.id === id);
    const payload: Partial<SlideFormState> = { ...form };
    if (form.image_url === (current?.image_url ?? '')) delete payload.image_url;
    const saved = await patchSlide(id, payload);
    if (saved) {
      setSlides((prev) => prev.map((s) => (s.id === id ? saved : s)));
      setEditingId(null);
      setMessage({ text: 'Slide enregistrée.', tone: 'ok' });
    }
    setSavingId(null);
  }

  async function setActive(slide: TenantHeroSlide, active: boolean) {
    setSavingId(slide.id);
    setMessage(null);
    const saved = await patchSlide(slide.id, { active });
    if (saved) setSlides((prev) => prev.map((s) => (s.id === slide.id ? saved : s)));
    setSavingId(null);
    setPendingLastDeactivate(null);
  }

  function handleToggleActive(slide: TenantHeroSlide) {
    if (slide.active && activeCount === 1) { setPendingLastDeactivate(slide); return; }
    void setActive(slide, !slide.active);
  }

  async function handleDelete(id: string) {
    setSavingId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/hero-slides/${id}`, { method: 'DELETE' });
      if (!res.ok) { setMessage({ text: await errorOf(res, 'Suppression impossible.'), tone: 'error' }); return; }
      setSlides((prev) => prev.filter((s) => s.id !== id));
      setMessage({ text: 'Slide supprimée.', tone: 'ok' });
    } catch {
      setMessage({ text: 'Erreur réseau — réessayez.', tone: 'error' });
    } finally {
      setSavingId(null);
      setPendingDeleteId(null);
    }
  }

  async function handleMove(index: number, direction: -1 | 1) {
    const ids = moveId(slides.map((slide) => slide.id), index, direction);
    const moving = slides[index];
    if (!moving || index + direction < 0 || index + direction >= slides.length) return;
    setSavingId(moving.id);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/hero-slides/order', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
      if (!res.ok) {
        setMessage({ text: await errorOf(res, 'Réorganisation impossible.'), tone: 'error' });
        router.refresh();
        return;
      }
      const byId = new Map(slides.map((slide) => [slide.id, slide]));
      setSlides(ids.map((id, position) => ({ ...(byId.get(id) as TenantHeroSlide), position })));
    } catch {
      setMessage({ text: 'Erreur réseau — réessayez.', tone: 'error' });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="rounded-xl border border-a-border bg-a-surface p-5">
      <p className="mb-4 text-xs text-a-text-3">
        {activeCount > 0
          ? `${activeCount} slide${activeCount > 1 ? 's' : ''} affichée${activeCount > 1 ? 's' : ''} sur la page d’accueil, dans cet ordre. Les modifications sont visibles immédiatement.`
          : 'Aucune slide active : la page d’accueil affiche la slide de secours générique.'}
      </p>

      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mb-4 rounded-lg px-3 py-2 text-xs ${message.tone === 'ok' ? 'bg-tone-success-bg text-tone-success-fg' : 'bg-tone-danger-bg text-tone-danger-fg'}`}>{message.text}</p>
      )}

      <div className="mb-6 space-y-4">
        {slides.map((slide, index) => (
          <div key={slide.id} className={`rounded-lg border p-4 ${slide.active ? 'border-a-border' : 'border-dashed border-a-border bg-a-surface-2'}`}>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className={slide.active ? '' : 'opacity-60'}><SlidePreview form={toFormState(slide)} /></div>
              <div className="flex items-start gap-1 sm:flex-col">
                <button onClick={() => void handleMove(index, -1)} disabled={index === 0 || savingId !== null} aria-label={`Monter « ${slide.title} »`} className="flex h-11 w-11 items-center justify-center rounded-lg border border-a-border disabled:opacity-30">
                  <IconChevronUp size={16} stroke={1.5} />
                </button>
                <button onClick={() => void handleMove(index, 1)} disabled={index === slides.length - 1 || savingId !== null} aria-label={`Descendre « ${slide.title} »`} className="flex h-11 w-11 items-center justify-center rounded-lg border border-a-border disabled:opacity-30">
                  <IconChevronDown size={16} stroke={1.5} />
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <label className="flex min-h-11 items-center gap-2 text-sm text-a-text-2">
                <input type="checkbox" checked={slide.active} onChange={() => handleToggleActive(slide)} disabled={savingId === slide.id} className="h-5 w-5" />
                {slide.active ? 'Affichée' : 'Masquée'}
              </label>
              <div className="flex items-center gap-2">
                <button onClick={() => setEditingId(editingId === slide.id ? null : slide.id)} className="min-h-11 rounded-lg border border-a-border px-3 py-2 text-xs">
                  {editingId === slide.id ? 'Fermer' : 'Modifier'}
                </button>
                <button onClick={() => setPendingDeleteId(slide.id)} disabled={savingId === slide.id} className="flex min-h-11 items-center gap-1 rounded-lg border border-a-border px-3 py-2 text-xs text-tone-danger-fg disabled:opacity-50">
                  <IconTrash size={14} stroke={1.5} />
                  Supprimer
                </button>
              </div>
            </div>

            {editingId === slide.id && (
              <div className="mt-4 border-t border-a-border pt-4">
                <SlideForm initial={slide} submitLabel="Enregistrer" isSaving={savingId === slide.id} onSubmit={(form) => void handleUpdate(slide.id, form)} onCancel={() => setEditingId(null)} />
              </div>
            )}
          </div>
        ))}
      </div>

      {creating ? (
        <div className="rounded-lg border border-dashed border-a-border p-4">
          <p className="mb-3 text-xs font-medium text-a-text-3">Nouvelle slide</p>
          <SlideForm submitLabel="Ajouter la slide" isSaving={savingId === 'new'} onSubmit={(form) => void handleCreate(form)} onCancel={() => setCreating(false)} />
        </div>
      ) : (
        <button onClick={() => setCreating(true)} className="flex min-h-11 items-center gap-1.5 rounded-lg bg-a-brand px-3 py-2 text-xs text-a-on-brand">
          <IconPlus size={14} stroke={1.5} />
          Ajouter une slide
        </button>
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Supprimer cette slide ?"
        description="Cette slide sera supprimée définitivement de la page d’accueil. Pour la retirer temporairement, masquez-la plutôt."
        confirmLabel="Supprimer la slide"
        cancelLabel="Conserver"
        destructive
        loading={pendingDeleteId !== null && savingId === pendingDeleteId}
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => { if (pendingDeleteId) void handleDelete(pendingDeleteId); }}
      />
      <ConfirmDialog
        open={pendingLastDeactivate !== null}
        title="Masquer la dernière slide ?"
        description="Plus aucune slide ne sera active : la page d’accueil affichera la slide de secours générique."
        confirmLabel="Masquer"
        cancelLabel="Annuler"
        loading={pendingLastDeactivate !== null && savingId === pendingLastDeactivate.id}
        onCancel={() => setPendingLastDeactivate(null)}
        onConfirm={() => { if (pendingLastDeactivate) void setActive(pendingLastDeactivate, false); }}
      />
    </section>
  );
}
