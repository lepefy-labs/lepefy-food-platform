'use client';

import { useState } from 'react';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

interface LegalInfoSectionProps {
  legal_name: string | null;
  legal_address: string | null;
  legal_email: string | null;
}

export function LegalInfoSection({ legal_name, legal_address, legal_email }: LegalInfoSectionProps) {
  const [form, setForm] = useState({
    legal_name: legal_name ?? '',
    legal_address: legal_address ?? '',
    legal_email: legal_email ?? '',
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
      <h2 className="text-sm font-semibold text-gray-700 mb-1">Données légales</h2>
      <p className="text-xs text-gray-400 mb-4">
        Ces informations apparaissent sur les étiquettes produits imprimées — vérifiez leur exactitude avant modification.
      </p>

      {toast && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-xs ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {toast.msg}
        </div>
      )}

      <div className="space-y-4 mb-4">
        <div>
          <label className={LABEL_CLS}>Raison sociale</label>
          <input
            type="text"
            value={form.legal_name}
            onChange={(e) => setForm({ ...form, legal_name: e.target.value })}
            className={INPUT_CLS}
          />
        </div>

        <div>
          <label className={LABEL_CLS}>Adresse légale</label>
          <textarea
            value={form.legal_address}
            onChange={(e) => setForm({ ...form, legal_address: e.target.value })}
            rows={2}
            className={`${INPUT_CLS} resize-none`}
          />
        </div>

        <div>
          <label className={LABEL_CLS}>Email légal</label>
          <input
            type="text"
            value={form.legal_email}
            onChange={(e) => setForm({ ...form, legal_email: e.target.value })}
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
