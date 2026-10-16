'use client';

import Link from 'next/link';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { IconBrandWhatsapp, IconDeviceDesktop, IconDeviceMobile, IconMail, IconSend, IconSearch, IconCopy } from '@tabler/icons-react';
import type { TemplatePreview, WhatsappTemplatePreview } from '@/lib/notifications/templateCatalog';

const AUDIENCE_CLS: Record<TemplatePreview['audience'], string> = {
  Client: 'bg-tone-info-bg text-tone-info-fg ring-tone-info-border',
  'Équipe du tenant': 'bg-tone-warning-bg text-tone-warning-fg ring-tone-warning-border',
  Plateforme: 'bg-a-brand-soft text-a-brand-fg ring-a-border',
};

type Channel = 'email' | 'whatsapp';

export default function TemplatePreviewBrowser({ previews, whatsappPreviews, tenantName }: {
  previews: TemplatePreview[];
  whatsappPreviews: WhatsappTemplatePreview[];
  tenantName: string;
}) {
  const [channel, setChannel] = useState<Channel>('email');
  return channel === 'whatsapp'
    ? <WhatsappBrowser previews={whatsappPreviews} tenantName={tenantName} onChannel={setChannel} />
    : <EmailBrowser previews={previews} tenantName={tenantName} onChannel={setChannel} />;
}

function ChannelSwitch({ value, onChange }: { value: Channel; onChange: (value: Channel) => void }) {
  return (
    <div className="flex shrink-0 rounded-lg border border-a-border p-0.5" role="group" aria-label="Canal">
      {(['email', 'whatsapp'] as const).map((item) => (
        <button key={item} type="button" onClick={() => onChange(item)} aria-pressed={value === item}
          className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium ${value === item ? 'bg-a-inverse text-a-on-inverse' : 'text-a-text-2'}`}>
          {item === 'email' ? <IconMail size={16} aria-hidden="true" /> : <IconBrandWhatsapp size={16} aria-hidden="true" />}
          {item === 'email' ? 'Emails' : 'WhatsApp'}
        </button>
      ))}
    </div>
  );
}

function useGroups<T extends { group: string }>(items: T[]): Array<[string, T[]]> {
  return useMemo(() => {
    const map = new Map<string, T[]>();
    for (const item of items) map.set(item.group, [...(map.get(item.group) ?? []), item]);
    return [...map.entries()];
  }, [items]);
}

function TemplateList<T extends { id: string; label: string }>({ groups, selectedId, onSelect }: { groups: Array<[string, T[]]>; selectedId: string; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<string[]>([]);
  const filtered = groups.map(([group, items]) => [group, items.filter((item) => item.label.toLocaleLowerCase('fr').includes(query.toLocaleLowerCase('fr')))] as [string, T[]])
    .filter(([, items]) => items.length > 0);
  return (
    <div className="min-w-0 space-y-3">
      <label className="flex min-h-10 items-center gap-2 rounded-lg border border-a-field bg-a-surface px-3 text-a-text-3">
        <IconSearch size={18} aria-hidden="true" />
        <span className="sr-only">Rechercher un modèle</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un modèle…" type="search"
          className="min-w-0 flex-1 bg-transparent text-sm text-a-text outline-none placeholder:text-a-text-3" />
      </label>
      <p className="text-xs text-a-text-3">{filtered.reduce((sum, [, items]) => sum + items.length, 0)} modèles affichés</p>
      <div className="lg:hidden">
        <select value={filtered.some(([, items]) => items.some((item) => item.id === selectedId)) ? selectedId : ''}
          onChange={(e) => onSelect(e.target.value)} className="h-10 w-full rounded-lg border border-a-field bg-a-surface px-3 text-sm" aria-label="Modèle">
          <option value="" disabled>Choisir un modèle</option>
          {filtered.map(([group, items]) => <optgroup key={group} label={group}>
            {items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </optgroup>)}
        </select>
      </div>
      <nav className="hidden overflow-hidden rounded-xl border border-a-border lg:block" aria-label="Modèles">
        {filtered.length === 0 && <p className="p-4 text-sm text-a-text-3">Aucun modèle trouvé.</p>}
        {filtered.map(([group, items]) => {
          const isClosed = !query && closed.includes(group);
          return <div key={group}>
            <button type="button" aria-expanded={!isClosed}
              onClick={() => setClosed((current) => current.includes(group) ? current.filter((g) => g !== group) : [...current, group])}
              className="flex w-full items-center justify-between border-b border-a-border bg-a-surface-2 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-a-text-2">
              <span>{group}</span><span className="font-normal">{items.length} {isClosed ? '▸' : '▾'}</span>
            </button>
            {!isClosed && items.map((item) => (
              <button key={item.id} type="button" onClick={() => onSelect(item.id)} aria-current={item.id === selectedId ? 'true' : undefined}
                className={`block w-full border-b border-a-border px-3 py-2.5 text-left text-sm transition last:border-b-0 ${item.id === selectedId
                  ? 'bg-a-brand-soft font-semibold text-a-brand-fg shadow-[inset_3px_0_0_var(--admin-primary)]'
                  : 'text-a-text-2 hover:bg-a-surface-2'}`}>
                {item.label}
              </button>
            ))}
          </div>;
        })}
      </nav>
    </div>
  );
}

/** WhatsApp rendering of the exact text: *bold*, line breaks, links. */
const INLINE = /(\*[^*\n]+\*|https?:\/\/\S+)/g;

function whatsappInline(line: string): ReactNode[] {
  return line.split(INLINE).filter(Boolean).map((part, index) => {
    if (/^\*[^*]+\*$/.test(part)) return <strong key={index}>{part.slice(1, -1)}</strong>;
    if (/^https?:\/\//.test(part)) return <span key={index} className="break-all text-tone-info-fg underline">{part}</span>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function WhatsappBubble({ preview, tenantName }: { preview: WhatsappTemplatePreview; tenantName: string }) {
  return (
    <div className="mx-auto w-full max-w-[400px] overflow-hidden rounded-2xl border border-a-border shadow-sm">
      <div className="flex items-center gap-2 bg-a-inverse px-4 py-3 text-a-on-inverse">
        <IconBrandWhatsapp size={20} aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">Lepefy</p>
          <p className="text-xs opacity-80">Notifications · {tenantName}</p>
        </div>
      </div>
      <div className="bg-a-surface-2 px-3 py-4">
        <div className="max-w-[92%] rounded-xl rounded-tl-sm bg-a-surface px-3 py-2 text-sm leading-6 text-a-text shadow-sm">
          {preview.text.split('\n').map((line, index) => (
            <p key={index} className={line ? 'whitespace-pre-wrap break-words' : 'h-3'}>{whatsappInline(line)}</p>
          ))}
          <p className="mt-1 text-right text-xs text-a-text-3">10:42</p>
        </div>
      </div>
    </div>
  );
}

function WhatsappBrowser({ previews, tenantName, onChannel }: { previews: WhatsappTemplatePreview[]; tenantName: string; onChannel: (value: Channel) => void }) {
  const [selectedId, setSelectedId] = useState(previews[0]?.id ?? '');
  const [view, setView] = useState<'preview' | 'raw'>('preview');
  const selected = previews.find((preview) => preview.id === selectedId) ?? previews[0];
  const groups = useGroups(previews);
  if (!selected) return null;
  return (
    <section className="rounded-2xl border border-a-border bg-a-surface p-4 shadow-sm sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-a-text">Modèles WhatsApp</h2>
          <p className="mt-1 text-sm text-a-text-3">
            {previews.length} messages internes envoyés depuis le numéro Lepefy aux destinataires confirmés de {tenantName}, rendus avec les modèles de production sur des données fictives. Aucun envoi.
          </p>
        </div>
        <ChannelSwitch value="whatsapp" onChange={onChannel} />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <TemplateList groups={groups} selectedId={selected.id} onSelect={setSelectedId} />
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-a-border p-4">
            <div>
              <p className="font-semibold text-a-text">{selected.label}</p>
              <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${AUDIENCE_CLS['Équipe du tenant']}`}>Destinataire : Équipe du tenant</span>
            </div>
            <p className="text-xs text-a-text-3">{selected.length} / {selected.maxLength} caractères</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex rounded-lg border border-a-border p-0.5" role="group" aria-label="Mode d’aperçu">
              {(['preview', 'raw'] as const).map((mode) => <button key={mode} type="button" onClick={() => setView(mode)} aria-pressed={view === mode}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === mode ? 'bg-a-inverse text-a-on-inverse' : 'text-a-text-2'}`}>
                {mode === 'preview' ? 'Aperçu WhatsApp' : 'Texte brut'}
              </button>)}
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${selected.priority === 'urgent' ? 'bg-tone-danger-bg text-tone-danger-fg' : selected.priority === 'high' ? 'bg-tone-urgent-bg text-tone-urgent-fg' : 'bg-tone-info-bg text-tone-info-fg'}`}>
              {selected.priority === 'urgent' ? 'Urgent' : selected.priority === 'high' ? 'Prioritaire' : 'Information'}
            </span>
          </div>
          {view === 'preview'
            ? <div className="rounded-xl bg-a-hover p-4"><WhatsappBubble preview={selected} tenantName={tenantName} /></div>
            : <div className="rounded-xl border border-a-border bg-a-surface-2 p-4"><pre className="whitespace-pre-wrap break-words font-mono text-xs text-a-text-2">{selected.text}</pre></div>}
          <button type="button" onClick={() => navigator.clipboard.writeText(selected.text)}
            className="inline-flex items-center gap-2 rounded-lg border border-a-border px-3 py-2 text-sm font-medium text-a-text-2 hover:bg-a-hover">
            <IconCopy size={16} /> Copier le texte
          </button>
        </div>
      </div>
    </section>
  );
}

function EmailBrowser({ previews, tenantName, onChannel }: { previews: TemplatePreview[]; tenantName: string; onChannel: (value: Channel) => void }) {
  const [selectedId, setSelectedId] = useState(previews[0]?.id ?? '');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const selected = previews.find((preview) => preview.id === selectedId) ?? previews[0];
  const groups = useGroups(previews);

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
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <ChannelSwitch value="email" onChange={onChannel} />
          <Link href="/admin/platform/notifications/tests" className="inline-flex items-center gap-1.5 text-sm font-semibold text-a-brand-fg hover:opacity-80">
            <IconSend size={17} />Envoyer un test réel
          </Link>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <TemplateList groups={groups} selectedId={selected.id} onSelect={setSelectedId} />

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
