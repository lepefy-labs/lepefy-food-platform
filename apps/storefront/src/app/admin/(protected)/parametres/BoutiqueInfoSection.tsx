'use client';

import { useState } from 'react';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

interface BoutiqueInfoSectionProps {
  tagline: string | null;
  whatsapp_number: string | null;
  click_collect_address: string | null;
  click_collect_hours: string | null;
}

export function BoutiqueInfoSection({
  tagline,
  whatsapp_number,
  click_collect_address,
  click_collect_hours,
}: BoutiqueInfoSectionProps) {
  const [form, setForm] = useState({
    tagline: tagline ?? '',
    whatsapp_number: whatsapp_number ?? '',
    click_collect_address: click_collect_address ?? '',
    click_collect_hours: click_collect_hours ?? '',
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
      if (!res.ok) throw new Error();
      showToast('Enregistré', 'success');
    } catch {
      showToast('Erreur lors de l\'enregistrement', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-700 mb-1">Infos boutique</h2>
      <p className="text-xs text-gray-400 mb-4">
        Affichées sur la boutique et la carte digitale.
      </p>

      {toast && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-xs ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {toast.msg}
        </div>
      )}

      <div className="space-y-4 mb-4">
        <div>
          <label className={LABEL_CLS}>Slogan</label>
          <input
            type="text"
            value={form.tagline}
            onChange={(e) => setForm({ ...form, tagline: e.target.value })}
            placeholder="ex: Les saveurs de chez nous"
            className={INPUT_CLS}
          />
        </div>

        <div>
          <label className={LABEL_CLS}>Numéro WhatsApp</label>
          <input
            type="text"
            value={form.whatsapp_number}
            onChange={(e) => setForm({ ...form, whatsapp_number: e.target.value })}
            className={INPUT_CLS}
          />
          <p className="text-xs text-gray-400 mt-1">
            Format international sans espaces ni symboles, ex: 393296958822
          </p>
        </div>

        <div>
          <label className={LABEL_CLS}>Adresse click & collect</label>
          <textarea
            value={form.click_collect_address}
            onChange={(e) => setForm({ ...form, click_collect_address: e.target.value })}
            rows={2}
            className={`${INPUT_CLS} resize-none`}
          />
        </div>

        <div>
          <label className={LABEL_CLS}>Horaires click & collect</label>
          <input
            type="text"
            value={form.click_collect_hours}
            onChange={(e) => setForm({ ...form, click_collect_hours: e.target.value })}
            className={INPUT_CLS}
          />
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={isSaving}
        className="px-3 py-1.5 text-xs rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50"
      >
        Enregistrer
      </button>
    </section>
  );
}
