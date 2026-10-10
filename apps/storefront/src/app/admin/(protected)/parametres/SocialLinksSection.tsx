'use client';

import { useState } from 'react';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import Button from '../../_components/ui/Button';
import { SOCIAL_PLATFORM_REGISTRY, type TenantSocialLink, type SocialPlatform } from '@lepefy/types';
import { SettingsFeedback, SettingsPanel, SETTINGS_INPUT_CLS, SETTINGS_LABEL_CLS, SETTINGS_OUTLINE_DARK_CLS } from './_components/SettingsUi';
import { useSettingsFeedback } from './_components/useSettingsFeedback';

const PLATFORM_OPTIONS: SocialPlatform[] = ['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'x'];

interface FormState { platform: SocialPlatform; url: string; sort_order: string; active: boolean; }
function emptyForm(sortOrder: number, usedPlatforms: SocialPlatform[]): FormState {
  const available = PLATFORM_OPTIONS.find((p) => !usedPlatforms.includes(p)) ?? 'instagram';
  return { platform: available, url: '', sort_order: String(sortOrder), active: true };
}
function toForm(link: TenantSocialLink): FormState { return { platform: link.platform, url: link.url, sort_order: String(link.sort_order), active: link.active }; }
function formToBody(form: FormState) { return { platform: form.platform, url: form.url, sort_order: form.sort_order, active: form.active }; }

export function SocialLinksSection({ initialLinks }: { initialLinks: TenantSocialLink[] }) {
  const [links, setLinks] = useState<TenantSocialLink[]>(initialLinks);
  const usedPlatforms = links.map((l) => l.platform);
  const [newForm, setNewForm] = useState<FormState>(emptyForm(initialLinks.length, usedPlatforms));
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const { feedback, show: showToast } = useSettingsFeedback();

  async function handleCreate() {
    if (!newForm.url.trim().startsWith('https://')) return showToast('Le lien doit commencer par https://', 'error');
    setIsSaving('new');
    try {
      const res = await fetch('/api/admin/social-links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formToBody(newForm)) });
      if (!res.ok) throw new Error();
      const created = await res.json() as TenantSocialLink;
      const nextLinks = [...links.filter((l) => l.platform !== created.platform), created];
      setLinks(nextLinks); setNewForm(emptyForm(nextLinks.length, nextLinks.map((l) => l.platform))); showToast('Réseau social ajouté', 'success');
    } catch { showToast('Erreur lors de l\'ajout', 'error'); } finally { setIsSaving(null); }
  }
  async function handleUpdate(id: string, form: FormState) {
    if (!form.url.trim().startsWith('https://')) return showToast('Le lien doit commencer par https://', 'error');
    setIsSaving(id);
    try { const res = await fetch(`/api/admin/social-links/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formToBody(form)) }); if (!res.ok) throw new Error(); showToast('Enregistré', 'success'); }
    catch { showToast('Erreur lors de l\'enregistrement', 'error'); } finally { setIsSaving(null); }
  }
  async function handleDelete(id: string) {
    setIsSaving(id);
    try { const res = await fetch(`/api/admin/social-links/${id}`, { method: 'DELETE' }); if (!res.ok) throw new Error(); setLinks((prev) => prev.filter((l) => l.id !== id)); showToast('Réseau social supprimé', 'success'); }
    catch { showToast('Erreur lors de la suppression', 'error'); } finally { setIsSaving(null); }
  }
  function updateLinkField(id: string, field: keyof FormState, value: string | boolean) {
    setLinks((prev) => prev.map((l) => {
      if (l.id !== id) return l;
      const form = { ...toForm(l), [field]: value };
      return { ...l, platform: form.platform, url: form.url, sort_order: parseInt(form.sort_order, 10) || 0, active: form.active };
    }));
  }

  return (
    <SettingsPanel
      id="reseaux-sociaux"
      title="Réseaux sociaux"
      description="Liens affichés sur la carte digitale et la boutique."
      aside={<SettingsFeedback feedback={feedback} />}
    >
      {links.length > 0 ? (
        <ul className="divide-y divide-a-border">
          {links.map((link) => {
            const form = toForm(link);
            const label = SOCIAL_PLATFORM_REGISTRY[form.platform].label;
            return (
              <li key={link.id} className="py-4 first:pt-0 last:pb-0">
                <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)_88px]">
                  <div>
                    <label htmlFor={`social-platform-${link.id}`} className={SETTINGS_LABEL_CLS}>Plateforme</label>
                    <select id={`social-platform-${link.id}`} value={form.platform} onChange={(e) => updateLinkField(link.id, 'platform', e.target.value)} className={SETTINGS_INPUT_CLS}>
                      {PLATFORM_OPTIONS.map((p) => <option key={p} value={p} disabled={p !== form.platform && usedPlatforms.includes(p)}>{SOCIAL_PLATFORM_REGISTRY[p].label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`social-url-${link.id}`} className={SETTINGS_LABEL_CLS}>Lien</label>
                    <input id={`social-url-${link.id}`} type="url" value={form.url} onChange={(e) => updateLinkField(link.id, 'url', e.target.value)} className={SETTINGS_INPUT_CLS} />
                  </div>
                  <div>
                    <label htmlFor={`social-order-${link.id}`} className={SETTINGS_LABEL_CLS}>Ordre</label>
                    <input id={`social-order-${link.id}`} type="number" value={form.sort_order} onChange={(e) => updateLinkField(link.id, 'sort_order', e.target.value)} className={SETTINGS_INPUT_CLS} />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <label className="flex min-h-11 items-center gap-2 text-sm text-a-text-2">
                    <input type="checkbox" checked={form.active} onChange={(e) => updateLinkField(link.id, 'active', e.target.checked)} className="h-4 w-4 accent-[var(--admin-primary)]" />Actif
                  </label>
                  <div className="ml-auto flex gap-2">
                    <button type="button" onClick={() => handleDelete(link.id)} disabled={isSaving === link.id} aria-label={`Supprimer ${label}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-a-border px-3 text-sm text-a-text-2 hover:border-tone-danger-border hover:bg-tone-danger-bg hover:text-tone-danger-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus disabled:opacity-50"><IconTrash size={16} aria-hidden="true" />Supprimer</button>
                    <Button type="button" onClick={() => handleUpdate(link.id, toForm(link))} loading={isSaving === link.id} className="min-h-11">Enregistrer</Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-a-border p-4 text-sm text-a-text-3">Aucun réseau social configuré.</p>
      )}

      {usedPlatforms.length < PLATFORM_OPTIONS.length && (
        <div className="mt-6 border-t border-a-border pt-5">
          <h3 className="mb-3 text-sm font-semibold text-a-text">Ajouter un réseau social</h3>
          <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)_88px]">
            <div>
              <label htmlFor="social-new-platform" className={SETTINGS_LABEL_CLS}>Plateforme</label>
              <select id="social-new-platform" value={newForm.platform} onChange={(e) => setNewForm({ ...newForm, platform: e.target.value as SocialPlatform })} className={SETTINGS_INPUT_CLS}>
                {PLATFORM_OPTIONS.map((p) => <option key={p} value={p} disabled={usedPlatforms.includes(p)}>{SOCIAL_PLATFORM_REGISTRY[p].label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="social-new-url" className={SETTINGS_LABEL_CLS}>Lien</label>
              <input id="social-new-url" type="url" value={newForm.url} onChange={(e) => setNewForm({ ...newForm, url: e.target.value })} placeholder="https://…" className={SETTINGS_INPUT_CLS} />
            </div>
            <div>
              <label htmlFor="social-new-order" className={SETTINGS_LABEL_CLS}>Ordre</label>
              <input id="social-new-order" type="number" value={newForm.sort_order} onChange={(e) => setNewForm({ ...newForm, sort_order: e.target.value })} className={SETTINGS_INPUT_CLS} />
            </div>
          </div>
          <Button type="button" variant="outline" onClick={handleCreate} loading={isSaving === 'new'} disabled={!newForm.url.trim()} className={`mt-3 min-h-11 ${SETTINGS_OUTLINE_DARK_CLS}`}>{isSaving !== 'new' && <IconPlus size={16} aria-hidden="true" />}Ajouter</Button>
        </div>
      )}
    </SettingsPanel>
  );
}
