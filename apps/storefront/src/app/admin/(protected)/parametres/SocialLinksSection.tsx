'use client';

import { useState } from 'react';
import { IconBrandInstagram, IconPlus, IconTrash } from '@tabler/icons-react';
import Button from '../../_components/ui/Button';
import { SOCIAL_PLATFORM_REGISTRY, type TenantSocialLink, type SocialPlatform } from '@lepefy/types';

const INPUT_CLS = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-transparent focus:ring-2 focus:ring-[var(--admin-primary)] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const LABEL_CLS = 'mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300';
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
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  function showToast(msg: string, type: 'success' | 'error') { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); }

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
    <section className="overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <header className="flex items-start gap-3 border-b border-blue-100 bg-blue-50/80 px-4 py-3.5 dark:border-gray-800 dark:bg-gray-900">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/80 text-blue-600 shadow-sm dark:bg-gray-800"><IconBrandInstagram size={19} /></div>
        <div><h2 className="text-sm font-semibold text-blue-700 dark:text-blue-200">Réseaux sociaux</h2><p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Présence sociale visible sur la carte digitale</p></div>
      </header>
      <div className="p-4 sm:p-5">
        {toast && <div className={`mb-4 rounded-lg px-3 py-2 text-xs ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{toast.msg}</div>}
        <div className="space-y-3">
          {links.map((link) => {
            const form = toForm(link);
            return <div key={link.id} className="rounded-xl border border-gray-200 bg-[var(--admin-surface-subtle)] p-3 dark:border-gray-800 dark:bg-gray-950/40">
              <div className="grid gap-3 sm:grid-cols-[1fr_90px]">
                <div><label className={LABEL_CLS}>Plateforme</label><select value={form.platform} onChange={(e) => updateLinkField(link.id, 'platform', e.target.value)} className={INPUT_CLS}>{PLATFORM_OPTIONS.map((p) => <option key={p} value={p} disabled={p !== form.platform && usedPlatforms.includes(p)}>{SOCIAL_PLATFORM_REGISTRY[p].label}</option>)}</select></div>
                <div><label className={LABEL_CLS}>Ordre</label><input type="number" value={form.sort_order} onChange={(e) => updateLinkField(link.id, 'sort_order', e.target.value)} className={INPUT_CLS} /></div>
              </div>
              <div className="mt-3"><label className={LABEL_CLS}>Lien</label><input type="text" value={form.url} onChange={(e) => updateLinkField(link.id, 'url', e.target.value)} className={INPUT_CLS} /></div>
              <div className="mt-3 flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={form.active} onChange={(e) => updateLinkField(link.id, 'active', e.target.checked)} />Actif</label><div className="ml-auto flex gap-2"><Button size="sm" onClick={() => handleUpdate(link.id, toForm(link))} loading={isSaving === link.id}>Enregistrer</Button><button onClick={() => handleDelete(link.id)} disabled={isSaving === link.id} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-gray-200 px-3 text-xs text-gray-500 hover:bg-white disabled:opacity-50"><IconTrash size={14} />Supprimer</button></div></div>
            </div>;
          })}
        </div>
        {usedPlatforms.length < PLATFORM_OPTIONS.length && <div className="mt-4 rounded-xl border border-dashed border-blue-200 bg-blue-50/30 p-3">
          <p className="mb-3 text-xs font-semibold text-blue-700">Ajouter un réseau social</p>
          <div className="grid gap-3 sm:grid-cols-[1fr_90px]"><select value={newForm.platform} onChange={(e) => setNewForm({ ...newForm, platform: e.target.value as SocialPlatform })} className={INPUT_CLS}>{PLATFORM_OPTIONS.map((p) => <option key={p} value={p} disabled={usedPlatforms.includes(p)}>{SOCIAL_PLATFORM_REGISTRY[p].label}</option>)}</select><input type="number" value={newForm.sort_order} onChange={(e) => setNewForm({ ...newForm, sort_order: e.target.value })} className={INPUT_CLS} /></div>
          <input type="text" value={newForm.url} onChange={(e) => setNewForm({ ...newForm, url: e.target.value })} placeholder="https://..." className={`${INPUT_CLS} mt-3`} />
          <Button onClick={handleCreate} loading={isSaving === 'new'} className="mt-3">{isSaving !== 'new' && <IconPlus size={14} />}Ajouter</Button>
        </div>}
      </div>
    </section>
  );
}
