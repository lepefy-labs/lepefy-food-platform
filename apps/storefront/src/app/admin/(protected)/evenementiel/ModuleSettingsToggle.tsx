'use client';

import { useState } from 'react';

interface Props {
  field:         'events_enabled' | 'services_enabled';
  label:         string;
  initialValue:  boolean;
}

export default function ModuleSettingsToggle({ field, label, initialValue }: Props) {
  const [enabled, setEnabled] = useState(initialValue);
  const [saving, setSaving]   = useState(false);

  async function toggle() {
    const next = !enabled;
    setSaving(true);
    setEnabled(next);
    try {
      const res = await fetch('/api/admin/evenementiel/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: next }),
      });
      if (!res.ok) setEnabled(!next);
    } catch {
      setEnabled(!next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={saving}
      className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-xl border disabled:opacity-50"
      style={{
        borderColor: enabled ? 'var(--color-primary)' : '#E5E7EB',
        color: enabled ? 'var(--color-primary)' : '#6B7280',
        backgroundColor: enabled ? 'var(--color-primary-light)' : 'white',
      }}
    >
      <span
        className="w-8 h-4 rounded-full relative transition-colors"
        style={{ backgroundColor: enabled ? 'var(--color-primary)' : '#D1D5DB' }}
      >
        <span
          className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
          style={{ left: enabled ? 18 : 2 }}
        />
      </span>
      {label} — {enabled ? 'activé' : 'désactivé'}
    </button>
  );
}
