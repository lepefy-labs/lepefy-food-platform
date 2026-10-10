'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { IconDeviceDesktop, IconDeviceMobile, IconSend } from '@tabler/icons-react';
import type { TemplatePreview } from '@/lib/notifications/templateCatalog';

const AUDIENCE_CLS: Record<TemplatePreview['audience'], string> = {
  Client: 'bg-tone-info-bg text-tone-info-fg ring-tone-info-border',
  'Équipe du tenant': 'bg-tone-warning-bg text-tone-warning-fg ring-tone-warning-border',
  Plateforme: 'bg-a-brand-soft text-a-brand-fg ring-a-border',
};

export default function TemplatePreviewBrowser({ previews, tenantName }: { previews: TemplatePreview[]; tenantName: string }) {
  const [selectedId, setSelectedId] = useState(previews[0]?.id ?? '');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const selected = previews.find((preview) => preview.id === selectedId) ?? previews[0];
  const groups = useMemo(() => {
    const map = new Map<string, TemplatePreview[]>();
    for (const preview of previews) map.set(preview.group, [...(map.get(preview.group) ?? []), preview]);
    return [...map.entries()];
  }, [previews]);

  if (!selected) return null;

  return (
    <section className="rounded-2xl border border-a-border bg-a-surface p-4 shadow-sm sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-a-text">Modèles d’emails</h2>
          <p className="mt-1 text-sm text-a-text-3">
            {previews.length} emails rendus avec les modèles de production et l’identité de {tenantName}, sur des données fictives. Aucun envoi.
          </p>
        </div>
        <Link href="/admin/platform/notifications/tests" className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-a-brand-fg hover:opacity-80">
          <IconSend size={17} />Envoyer un test réel
        </Link>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="lg:hidden">
          <select value={selected.id} onChange={(e) => setSelectedId(e.target.value)} className="h-10 w-full rounded-lg border border-a-border bg-a-surface px-3 text-sm" aria-label="Modèle">
            {groups.map(([group, items]) => (
              <optgroup key={group} label={group}>
                {items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </optgroup>
            ))}
          </select>
        </div>

        <nav className="hidden max-h-[760px] overflow-y-auto rounded-xl border border-a-border lg:block" aria-label="Modèles">
          {groups.map(([group, items]) => (
            <div key={group}>
              <p className="sticky top-0 border-b border-a-border bg-a-surface-2 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-a-text-3">{group}</p>
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  aria-current={item.id === selected.id ? 'true' : undefined}
                  className={`block w-full border-b border-a-border px-3 py-2.5 text-left text-sm transition last:border-b-0 ${item.id === selected.id
                    ? 'bg-a-brand-soft font-semibold text-a-brand-fg shadow-[inset_3px_0_0_var(--admin-primary)]'
                    : 'text-a-text-2 hover:bg-a-surface-2'}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="min-w-0">
          <div className="flex flex-col gap-3 rounded-xl border border-a-border p-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs text-a-text-3">Objet</p>
              <p className="break-words font-semibold text-a-text">{selected.subject}</p>
              <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${AUDIENCE_CLS[selected.audience]}`}>Destinataire : {selected.audience}</span>
            </div>
            <div className="flex shrink-0 rounded-lg border border-a-border p-0.5" role="group" aria-label="Largeur d’aperçu">
              {(['desktop', 'mobile'] as const).map((value) => (
                <button key={value} type="button" onClick={() => setDevice(value)} aria-pressed={device === value}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${device === value ? 'bg-a-inverse text-a-on-inverse' : 'text-a-text-2'}`}>
                  {value === 'desktop' ? <IconDeviceDesktop size={15} /> : <IconDeviceMobile size={15} />}
                  {value === 'desktop' ? 'Ordinateur' : 'Mobile'}
                </button>
              ))}
            </div>
          </div>
          {/* mx-auto (not justify-center) so a preview wider than the panel scrolls instead of being clipped on the left. */}
          <div className="mt-4 overflow-x-auto rounded-xl bg-a-hover p-4">
            {/* No scripts, no same-origin access: the preview is inert HTML. */}
            <iframe
              key={`${selected.id}-${device}`}
              title={`Aperçu : ${selected.label}`}
              srcDoc={selected.html}
              sandbox=""
              className="mx-auto block h-[720px] rounded-lg border-0 bg-white shadow-sm"
              style={{ width: device === 'desktop' ? 680 : 375 }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
