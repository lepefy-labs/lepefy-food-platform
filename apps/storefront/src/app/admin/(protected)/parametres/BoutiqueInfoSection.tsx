'use client';

import { useState } from 'react';
import { IconBuildingStore } from '@tabler/icons-react';
import Button from '../../_components/ui/Button';

const INPUT_CLS =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-transparent focus:ring-2 focus:ring-[var(--admin-primary)] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const LABEL_CLS = 'mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300';

interface BoutiqueInfoSectionProps {
  tagline: string | null;
  storefront_url: string | null;
  whatsapp_number: string | null;
  click_collect_address: string | null;
  google_maps_url: string | null;
  click_collect_hours: string | null;
  click_collect_hours_it: string | null;
}

export function BoutiqueInfoSection({
  tagline,
  storefront_url,
  whatsapp_number,
  click_collect_address,
  google_maps_url,
  click_collect_hours,
  click_collect_hours_it,
}: BoutiqueInfoSectionProps) {
  const [form, setForm] = useState({
    tagline: tagline ?? '',
    storefront_url: storefront_url ?? '',
    whatsapp_number: whatsapp_number ?? '',
    click_collect_address: click_collect_address ?? '',
    google_maps_url: google_maps_url ?? '',
    click_collect_hours: click_collect_hours ?? '',
    click_collect_hours_it: click_collect_hours_it ?? '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const res = await fetch('/api/admin/tenant', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || 'Erreur lors de l\'enregistrement');
      }
      showToast('Enregistré', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Erreur lors de l\'enregistrement', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[#E8E4FF] bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <header className="flex items-start gap-3 border-b border-[#E8E4FF] bg-[var(--admin-primary-soft)] px-4 py-3.5 dark:border-gray-800 dark:bg-gray-900">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/80 text-[var(--admin-primary-fg)] shadow-sm dark:bg-gray-800">
          <IconBuildingStore size={19} stroke={1.7} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-[var(--admin-primary-fg)] dark:text-violet-200">Boutique</h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Informations visibles par vos clients</p>
        </div>
      </header>

      <div className="p-4 sm:p-5">
        {toast && (
          <div className={`mb-4 rounded-lg px-3 py-2 text-xs ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {toast.msg}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={LABEL_CLS}>Slogan</label>
            <input type="text" value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder="ex: Les saveurs de chez nous" className={INPUT_CLS} />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL_CLS}>URL canonique de la boutique</label>
            <input type="url" value={form.storefront_url} onChange={(e) => setForm({ ...form, storefront_url: e.target.value })} placeholder="https://shop.exemple.com" className={INPUT_CLS} />
            <p className="mt-1 text-xs text-gray-500">Utilisée dans les emails, liens de suivi et outils plateforme. URL HTTPS publique de la boutique.</p>
          </div>
          <div>
            <label className={LABEL_CLS}>WhatsApp</label>
            <input type="text" value={form.whatsapp_number} onChange={(e) => setForm({ ...form, whatsapp_number: e.target.value })} className={INPUT_CLS} />
            <p className="mt-1 text-xs text-gray-500">Format international sans espaces ni symboles.</p>
          </div>
          <div>
            <label className={LABEL_CLS}>Lien Google Maps</label>
            <input type="url" value={form.google_maps_url} onChange={(e) => setForm({ ...form, google_maps_url: e.target.value })} placeholder="https://maps.app.goo.gl/..." className={INPUT_CLS} />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL_CLS}>Adresse click & collect</label>
            <textarea value={form.click_collect_address} onChange={(e) => setForm({ ...form, click_collect_address: e.target.value })} rows={2} className={`${INPUT_CLS} resize-none`} />
          </div>
          <div>
            <label className={LABEL_CLS}>Horaires click & collect</label>
            <input type="text" value={form.click_collect_hours} onChange={(e) => setForm({ ...form, click_collect_hours: e.target.value })} className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>Horaires (italien)</label>
            <input type="text" value={form.click_collect_hours_it} onChange={(e) => setForm({ ...form, click_collect_hours_it: e.target.value })} placeholder="ex: Lun-Sab: 9h-20h" className={INPUT_CLS} />
          </div>
        </div>
      </div>

      <footer className="flex justify-end border-t border-[#E8E4FF] bg-[#FCFBFF] px-4 py-3 dark:border-gray-800 dark:bg-gray-900/80">
        <Button onClick={handleSave} loading={isSaving}>Enregistrer</Button>
      </footer>
    </section>
  );
}
