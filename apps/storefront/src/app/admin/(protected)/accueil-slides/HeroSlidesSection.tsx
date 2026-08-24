'use client';

import { useState } from 'react';
import { IconChevronUp, IconChevronDown, IconTrash, IconPlus } from '@tabler/icons-react';
import { VARIANT_BACKGROUND } from '@/components/home/HeroCarousel';
import type { TenantHeroSlide, HeroSlideBackgroundVariant } from '@lepefy/types';
import ConfirmActionModal from '../../_components/ui/ConfirmActionModal';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

const VARIANT_OPTIONS: { value: HeroSlideBackgroundVariant; label: string }[] = [
  { value: 'primary',   label: 'Primary (couleur principale)' },
  { value: 'secondary', label: 'Secondary (couleur secondaire)' },
  { value: 'accent',    label: 'Accent (fort contraste)' },
];

interface SlideFormState {
  badge_text: string;
  title: string;
  subtitle: string;
  cta_primary_label: string;
  cta_primary_url: string;
  cta_secondary_label: string;
  cta_secondary_url: string;
  background_variant: HeroSlideBackgroundVariant;
  active: boolean;
}

function toFormState(slide?: TenantHeroSlide): SlideFormState {
  return {
    badge_text:          slide?.badge_text ?? '',
    title:                slide?.title ?? '',
    subtitle:             slide?.subtitle ?? '',
    cta_primary_label:   slide?.cta_primary_label ?? '',
    cta_primary_url:     slide?.cta_primary_url ?? '',
    cta_secondary_label: slide?.cta_secondary_label ?? '',
    cta_secondary_url:   slide?.cta_secondary_url ?? '',
    background_variant:  slide?.background_variant ?? 'primary',
    active:              slide?.active ?? true,
  };
}

function validate(form: SlideFormState): string | null {
  if (!form.title.trim()) return 'Le titre est obligatoire.';
  if (Boolean(form.cta_secondary_label.trim()) !== Boolean(form.cta_secondary_url.trim())) {
    return 'Le CTA secondaire nécessite un libellé ET un lien (ou aucun des deux).';
  }
  return null;
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
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof SlideFormState>(key: K, value: SlideFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit() {
    const validationError = validate(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    onSubmit(form);
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="px-3 py-2 rounded-lg text-xs bg-red-50 text-red-700">{error}</div>
      )}

      <div>
        <label className={LABEL_CLS}>Badge (optionnel)</label>
        <input
          type="text"
          value={form.badge_text}
          onChange={(e) => set('badge_text', e.target.value)}
          className={INPUT_CLS}
          placeholder="Ex. Nouveauté"
        />
      </div>

      <div>
        <label className={LABEL_CLS}>Titre *</label>
        <input
          type="text"
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          className={INPUT_CLS}
        />
      </div>

      <div>
        <label className={LABEL_CLS}>Sous-titre (optionnel)</label>
        <textarea
          value={form.subtitle}
          onChange={(e) => set('subtitle', e.target.value)}
          rows={2}
          className={`${INPUT_CLS} resize-none`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL_CLS}>CTA principal — libellé</label>
          <input
            type="text"
            value={form.cta_primary_label}
            onChange={(e) => set('cta_primary_label', e.target.value)}
            className={INPUT_CLS}
            placeholder="Découvrir le catalogue"
          />
        </div>
        <div>
          <label className={LABEL_CLS}>CTA principal — lien</label>
          <input
            type="text"
            value={form.cta_primary_url}
            onChange={(e) => set('cta_primary_url', e.target.value)}
            className={INPUT_CLS}
            placeholder="/products"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL_CLS}>CTA secondaire — libellé</label>
          <input
            type="text"
            value={form.cta_secondary_label}
            onChange={(e) => set('cta_secondary_label', e.target.value)}
            className={INPUT_CLS}
          />
        </div>
        <div>
          <label className={LABEL_CLS}>CTA secondaire — lien</label>
          <input
            type="text"
            value={form.cta_secondary_url}
            onChange={(e) => set('cta_secondary_url', e.target.value)}
            className={INPUT_CLS}
          />
        </div>
      </div>

      <div>
        <label className={LABEL_CLS}>Fond</label>
        <div className="flex items-center gap-3">
          <select
            value={form.background_variant}
            onChange={(e) => set('background_variant', e.target.value as HeroSlideBackgroundVariant)}
            className={INPUT_CLS}
          >
            {VARIANT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {/* Aperçu live — mêmes gradients réels que le storefront (HeroCarousel),
              jamais une couleur arbitraire dans l'aperçu. */}
          <div
            aria-hidden="true"
            className="w-16 h-11 rounded-lg shrink-0 border border-gray-200"
            style={{ backgroundImage: VARIANT_BACKGROUND[form.background_variant] }}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`active-${initial?.id ?? 'new'}`}
          checked={form.active}
          onChange={(e) => set('active', e.target.checked)}
          className="w-5 h-5"
        />
        <label htmlFor={`active-${initial?.id ?? 'new'}`} className="text-sm text-gray-600">Actif</label>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSubmit}
          disabled={isSaving}
          className="min-h-11 px-4 py-2 text-xs rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50"
        >
          {submitLabel}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={isSaving}
            className="min-h-11 px-4 py-2 text-xs rounded-lg border border-gray-200 text-gray-500 disabled:opacity-50"
          >
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
  const [slides, setSlides] = useState<TenantHeroSlide[]>(
    [...initialSlides].sort((a, b) => a.position - b.position),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

  async function handleCreate(form: SlideFormState) {
    setSavingId('new');
    try {
      const res = await fetch('/api/admin/hero-slides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      const created = await res.json() as TenantHeroSlide;
      setSlides((prev) => [...prev, created].sort((a, b) => a.position - b.position));
      setCreating(false);
      showToast('Slide créée', 'success');
    } catch {
      showToast("Erreur lors de la création", 'error');
    } finally {
      setSavingId(null);
    }
  }

  async function patchSlide(id: string, payload: object): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/hero-slides/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      return true;
    } catch {
      showToast("Erreur lors de l'enregistrement", 'error');
      return false;
    }
  }

  async function handleUpdate(id: string, form: SlideFormState) {
    setSavingId(id);
    const ok = await patchSlide(id, form);
    if (ok) {
      setSlides((prev) => prev.map((s) => (s.id === id ? { ...s, ...form } : s)));
      setEditingId(null);
      showToast('Enregistré', 'success');
    }
    setSavingId(null);
  }

  async function handleToggleActive(slide: TenantHeroSlide) {
    setSavingId(slide.id);
    const ok = await patchSlide(slide.id, { active: !slide.active });
    if (ok) {
      setSlides((prev) => prev.map((s) => (s.id === slide.id ? { ...s, active: !s.active } : s)));
    }
    setSavingId(null);
  }

  async function handleDelete(id: string) {
    setSavingId(id);
    try {
      const res = await fetch(`/api/admin/hero-slides/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setSlides((prev) => prev.filter((s) => s.id !== id));
      setPendingDeleteId(null);
      showToast('Slide supprimée', 'success');
    } catch {
      showToast('Erreur lors de la suppression', 'error');
    } finally {
      setSavingId(null);
    }
  }

  async function handleMove(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= slides.length) return;

    const current = slides[index];
    const target  = slides[targetIndex];
    if (!current || !target) return;

    setSavingId(current.id);
    const [ok1, ok2] = await Promise.all([
      patchSlide(current.id, { position: target.position }),
      patchSlide(target.id, { position: current.position }),
    ]);
    if (ok1 && ok2) {
      const next = [...slides];
      next[index] = { ...target, position: current.position };
      next[targetIndex] = { ...current, position: target.position };
      setSlides(next.sort((a, b) => a.position - b.position));
    }
    setSavingId(null);
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      {toast && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-xs ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {toast.msg}
        </div>
      )}

      <div className="space-y-4 mb-6">
        {slides.length === 0 && !creating && (
          <p className="text-sm text-gray-400">Aucune slide configurée — la slide de secours générique est affichée.</p>
        )}

        {slides.map((slide, index) => (
          <div key={slide.id} className="border border-gray-100 rounded-lg p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                {slide.badge_text && (
                  <span
                    className="inline-block text-2xs font-bold px-2 py-0.5 rounded-full mb-1"
                    style={{ backgroundColor: 'var(--color-secondary)', color: '#1a1a1a' }}
                  >
                    {slide.badge_text}
                  </span>
                )}
                <p className="text-sm font-semibold text-gray-900 truncate">{slide.title}</p>
                {slide.subtitle && <p className="text-xs text-gray-500 truncate">{slide.subtitle}</p>}
                {!slide.active && <p className="text-2xs text-gray-400 mt-0.5">Inactif — masqué sur la home</p>}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleMove(index, -1)}
                  disabled={index === 0 || savingId === slide.id}
                  aria-label="Monter la slide"
                  className="w-11 h-11 flex items-center justify-center rounded-lg border border-gray-200 disabled:opacity-30"
                >
                  <IconChevronUp size={16} stroke={1.5} />
                </button>
                <button
                  onClick={() => handleMove(index, 1)}
                  disabled={index === slides.length - 1 || savingId === slide.id}
                  aria-label="Descendre la slide"
                  className="w-11 h-11 flex items-center justify-center rounded-lg border border-gray-200 disabled:opacity-30"
                >
                  <IconChevronDown size={16} stroke={1.5} />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between flex-wrap gap-2">
              <label className="flex items-center gap-2 text-sm text-gray-600 min-h-11">
                <input
                  type="checkbox"
                  checked={slide.active}
                  onChange={() => handleToggleActive(slide)}
                  disabled={savingId === slide.id}
                  className="w-5 h-5"
                />
                Actif
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditingId(editingId === slide.id ? null : slide.id)}
                  className="min-h-11 px-3 py-2 text-xs rounded-lg border border-gray-200"
                >
                  {editingId === slide.id ? 'Fermer' : 'Modifier'}
                </button>
                <button
                  onClick={() => setPendingDeleteId(slide.id)}
                  disabled={savingId === slide.id}
                  className="min-h-11 px-3 py-2 text-xs rounded-lg border border-gray-200 text-red-600 flex items-center gap-1 disabled:opacity-50"
                >
                  <IconTrash size={14} stroke={1.5} />
                  Supprimer
                </button>
              </div>
            </div>

            {editingId === slide.id && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <SlideForm
                  initial={slide}
                  submitLabel="Enregistrer"
                  isSaving={savingId === slide.id}
                  onSubmit={(form) => handleUpdate(slide.id, form)}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {creating ? (
        <div className="border border-dashed border-gray-200 rounded-lg p-4">
          <p className="text-xs font-medium text-gray-500 mb-3">Nouvelle slide</p>
          <SlideForm
            submitLabel="Ajouter"
            isSaving={savingId === 'new'}
            onSubmit={handleCreate}
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="min-h-11 flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg text-white bg-[var(--color-primary)]"
        >
          <IconPlus size={14} stroke={1.5} />
          Ajouter une slide
        </button>
      )}

      <ConfirmActionModal
        open={pendingDeleteId !== null}
        title="Supprimer cette slide ?"
        description="Cette slide sera supprimée définitivement de la page d’accueil. Cette action est irréversible."
        confirmLabel="Supprimer la slide"
        cancelLabel="Conserver"
        destructive
        loading={pendingDeleteId !== null && savingId === pendingDeleteId}
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingDeleteId) void handleDelete(pendingDeleteId);
        }}
      />
    </section>
  );
}