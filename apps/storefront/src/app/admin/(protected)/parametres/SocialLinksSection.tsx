'use client';

import { useState } from 'react';
import { IconTrash, IconPlus } from '@tabler/icons-react';
import Button from '../../_components/ui/Button';
import { SOCIAL_PLATFORM_REGISTRY, type TenantSocialLink, type SocialPlatform } from '@lepefy/types';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

const PLATFORM_OPTIONS: SocialPlatform[] = ['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'x'];

interface FormState {
  platform: SocialPlatform;
  url: string;
  sort_order: string;
  active: boolean;
}

function emptyForm(sortOrder: number, usedPlatforms: SocialPlatform[]): FormState {
  const available = PLATFORM_OPTIONS.find((p) => !usedPlatforms.includes(p)) ?? 'instagram';
  return { platform: available, url: '', sort_order: String(sortOrder), active: true };
}

function toForm(link: TenantSocialLink): FormState {
  return {
    platform: link.platform,
    url: link.url,
    sort_order: String(link.sort_order),
    active: link.active,
  };
}

function formToBody(form: FormState) {
  return {
    platform: form.platform,
    url: form.url,
    sort_order: form.sort_order,
    active: form.active,
  };
}

interface SocialLinksSectionProps {
  initialLinks: TenantSocialLink[];
}

export function SocialLinksSection({ initialLinks }: SocialLinksSectionProps) {
  const [links, setLinks] = useState<TenantSocialLink[]>(initialLinks);
  const usedPlatforms = links.map((l) => l.platform);
  const [newForm, setNewForm] = useState<FormState>(emptyForm(initialLinks.length, usedPlatforms));
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

  async function handleCreate() {
    if (!newForm.url.trim().startsWith('https://')) {
      showToast('Le lien doit commencer par https://', 'error');
      return;
    }

    setIsSaving('new');
    try {
      const res = await fetch('/api/admin/social-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formToBody(newForm)),
      });
      if (!res.ok) throw new Error();
      const created = await res.json() as TenantSocialLink;
      const nextLinks = [...links.filter((l) => l.platform !== created.platform), created];
      setLinks(nextLinks);
      setNewForm(emptyForm(nextLinks.length, nextLinks.map((l) => l.platform)));
      showToast('Réseau social ajouté', 'success');
    } catch {
      showToast('Erreur lors de l\'ajout', 'error');
    } finally {
      setIsSaving(null);
    }
  }

  async function handleUpdate(id: string, form: FormState) {
    if (!form.url.trim().startsWith('https://')) {
      showToast('Le lien doit commencer par https://', 'error');
      return;
    }

    setIsSaving(id);
    try {
      const res = await fetch(`/api/admin/social-links/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formToBody(form)),
      });
      if (!res.ok) throw new Error();
      showToast('Enregistré', 'success');
    } catch {
      showToast('Erreur lors de l\'enregistrement', 'error');
    } finally {
      setIsSaving(null);
    }
  }

  async function handleDelete(id: string) {
    setIsSaving(id);
    try {
      const res = await fetch(`/api/admin/social-links/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setLinks((prev) => prev.filter((l) => l.id !== id));
      showToast('Réseau social supprimé', 'success');
    } catch {
      showToast('Erreur lors de la suppression', 'error');
    } finally {
      setIsSaving(null);
    }
  }

  function updateLinkField(id: string, field: keyof FormState, value: string | boolean) {
    setLinks((prev) => prev.map((l) => {
      if (l.id !== id) return l;
      const form = { ...toForm(l), [field]: value };
      return {
        ...l,
        platform: form.platform,
        url: form.url,
        sort_order: parseInt(form.sort_order, 10) || 0,
        active: form.active,
      };
    }));
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-700 mb-1">Réseaux sociaux</h2>
      <p className="text-xs text-gray-400 mb-4">
        Affichés dans la carte digitale.
      </p>

      {toast && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-xs ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {toast.msg}
        </div>
      )}

      <div className="space-y-4 mb-6">
        {links.map((link) => {
          const form = toForm(link);
          return (
            <div key={link.id} className="border border-gray-100 rounded-lg p-4">
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className={LABEL_CLS}>Plateforme</label>
                  <select
                    value={form.platform}
                    onChange={(e) => updateLinkField(link.id, 'platform', e.target.value)}
                    className={INPUT_CLS}
                  >
                    {PLATFORM_OPTIONS.map((p) => (
                      <option
                        key={p}
                        value={p}
                        disabled={p !== form.platform && usedPlatforms.includes(p)}
                      >
                        {SOCIAL_PLATFORM_REGISTRY[p].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Ordre</label>
                  <input
                    type="number"
                    value={form.sort_order}
                    onChange={(e) => updateLinkField(link.id, 'sort_order', e.target.value)}
                    className={INPUT_CLS}
                  />
                </div>
              </div>

              <div className="mb-3">
                <label className={LABEL_CLS}>Lien</label>
                <input
                  type="text"
                  value={form.url}
                  onChange={(e) => updateLinkField(link.id, 'url', e.target.value)}
                  placeholder="https://..."
                  className={INPUT_CLS}
                />
              </div>

              <div className="flex items-center gap-2 mb-3">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => updateLinkField(link.id, 'active', e.target.checked)}
                  id={`active-${link.id}`}
                />
                <label htmlFor={`active-${link.id}`} className="text-sm text-gray-600">Actif</label>
              </div>

              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => handleUpdate(link.id, toForm(link))} loading={isSaving === link.id}>
                  Enregistrer
                </Button>
                <button
                  onClick={() => handleDelete(link.id)}
                  disabled={isSaving === link.id}
                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-500 flex items-center gap-1 disabled:opacity-50"
                >
                  <IconTrash size={14} stroke={1.5} />
                  Supprimer
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {newForm && usedPlatforms.length < PLATFORM_OPTIONS.length && (
        <div className="border border-dashed border-gray-200 rounded-lg p-4">
          <p className="text-xs font-medium text-gray-500 mb-3">Ajouter un réseau social</p>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className={LABEL_CLS}>Plateforme</label>
              <select
                value={newForm.platform}
                onChange={(e) => setNewForm({ ...newForm, platform: e.target.value as SocialPlatform })}
                className={INPUT_CLS}
              >
                {PLATFORM_OPTIONS.map((p) => (
                  <option key={p} value={p} disabled={usedPlatforms.includes(p)}>
                    {SOCIAL_PLATFORM_REGISTRY[p].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Ordre</label>
              <input
                type="number"
                value={newForm.sort_order}
                onChange={(e) => setNewForm({ ...newForm, sort_order: e.target.value })}
                className={INPUT_CLS}
              />
            </div>
          </div>

          <div className="mb-3">
            <label className={LABEL_CLS}>Lien</label>
            <input
              type="text"
              value={newForm.url}
              onChange={(e) => setNewForm({ ...newForm, url: e.target.value })}
              placeholder="https://..."
              className={INPUT_CLS}
            />
          </div>

          <Button onClick={handleCreate} loading={isSaving === 'new'}>
            {isSaving !== 'new' && <IconPlus size={14} stroke={1.5} />}
            Ajouter
          </Button>
        </div>
      )}
    </section>
  );
}
