'use client';

import { useState } from 'react';
import { IconInfoCircle, IconShieldCheck } from '@tabler/icons-react';
import Button from '../../_components/ui/Button';

const INPUT_CLS = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-transparent focus:ring-2 focus:ring-[var(--admin-primary)] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const LABEL_CLS = 'mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300';

interface LegalInfoSectionProps {
  legal_name: string | null;
  legal_address: string | null;
  legal_email: string | null;
}

export function LegalInfoSection({ legal_name, legal_address, legal_email }: LegalInfoSectionProps) {
  const [form, setForm] = useState({ legal_name: legal_name ?? '', legal_address: legal_address ?? '', legal_email: legal_email ?? '' });
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  function showToast(msg: string, type: 'success' | 'error') { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); }

  async function handleSave() {
    setIsSaving(true);
    try {
      const res = await fetch('/api/admin/tenant', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!res.ok) throw new Error();
      showToast('Enregistré', 'success');
    } catch { showToast('Erreur lors de l\'enregistrement', 'error'); } finally { setIsSaving(false); }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-amber-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <header className="flex items-start gap-3 border-b border-amber-100 bg-amber-50/75 px-4 py-3.5 dark:border-gray-800 dark:bg-gray-900">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/80 text-amber-700 shadow-sm dark:bg-gray-800 dark:text-amber-300"><IconShieldCheck size={19} stroke={1.7} /></div>
        <div><h2 className="text-sm font-semibold text-amber-800 dark:text-amber-200">Informations légales</h2><p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Données sensibles utilisées sur vos documents</p></div>
      </header>

      <div className="p-4 sm:p-5">
        {toast && <div className={`mb-4 rounded-lg px-3 py-2 text-xs ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{toast.msg}</div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className={LABEL_CLS}>Raison sociale</label><input type="text" value={form.legal_name} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} className={INPUT_CLS} /></div>
          <div><label className={LABEL_CLS}>Email légal</label><input type="email" value={form.legal_email} onChange={(e) => setForm({ ...form, legal_email: e.target.value })} className={INPUT_CLS} /></div>
          <div className="sm:col-span-2"><label className={LABEL_CLS}>Adresse légale</label><textarea value={form.legal_address} onChange={(e) => setForm({ ...form, legal_address: e.target.value })} rows={2} className={`${INPUT_CLS} resize-none`} /></div>
        </div>
        <div className="mt-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"><IconInfoCircle size={16} className="mt-0.5 shrink-0" />Ces informations apparaissent sur les étiquettes produits imprimées. Vérifiez leur exactitude avant modification.</div>
      </div>

      <footer className="flex justify-end border-t border-amber-100 bg-amber-50/30 px-4 py-3 dark:border-gray-800 dark:bg-gray-900/80"><Button onClick={handleSave} loading={isSaving}>Enregistrer</Button></footer>
    </section>
  );
}
