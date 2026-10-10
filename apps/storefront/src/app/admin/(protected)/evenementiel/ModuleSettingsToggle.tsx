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
      className={`flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-xl border disabled:opacity-50 ${enabled
        ? 'border-a-brand bg-a-brand-soft text-a-brand-fg'
        : 'border-a-border bg-a-surface text-a-text-3'}`}
    >
      <span
        className="w-8 h-4 rounded-full relative transition-colors"
        style={{ backgroundColor: enabled ? 'var(--admin-primary)' : '#D1D5DB' }}
      >
        <span
          className="absolute top-0.5 w-3 h-3 rounded-full bg-a-surface transition-all"
          style={{ left: enabled ? 18 : 2 }}
        />
      </span>
      {label} — {enabled ? 'activé' : 'désactivé'}
    </button>
  );
}
