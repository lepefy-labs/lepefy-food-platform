'use client';

import { useState } from 'react';
import { Modal } from './Modal';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-1 block';

interface ProfileEditModalProps {
  fullName: string | null;
  phone:    string | null;
  onClose:  () => void;
  onSaved:  (next: { fullName: string | null; phone: string | null }) => void;
}

export function ProfileEditModal({ fullName, phone, onClose, onSaved }: ProfileEditModalProps) {
  const [name, setName]         = useState(fullName ?? '');
  const [phoneValue, setPhone]  = useState(phone ?? '');
  const [error, setError]       = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length === 0) {
      setError('Le nom ne peut pas être vide.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const res  = await fetch('/api/customers/me', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ fullName: name.trim(), phone: phoneValue.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Erreur lors de l\'enregistrement.');
        return;
      }
      onSaved({ fullName: data.fullName, phone: data.phone });
    } catch {
      setError('Erreur lors de l\'enregistrement.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal title="Informations personnelles" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className={LABEL_CLS}>Nom</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={INPUT_CLS}
            placeholder="Ton nom"
            autoFocus
          />
        </div>
        <div>
          <label className={LABEL_CLS}>Téléphone</label>
          <input
            value={phoneValue}
            onChange={(e) => setPhone(e.target.value)}
            type="tel"
            inputMode="tel"
            className={INPUT_CLS}
            placeholder="+33 6 12 34 56 78"
          />
        </div>
        {error && <p className="text-red-500 text-xs">{error}</p>}
        <button
          type="submit"
          disabled={isSaving}
          className="w-full py-2.5 rounded-xl font-semibold text-white text-sm disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          {isSaving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </form>
    </Modal>
  );
}
