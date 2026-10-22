'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SUPPORT_CATEGORY_LABELS, SUPPORT_CHANNEL_LABELS, SUPPORT_LIMITS, SUPPORT_MANUAL_CHANNELS, SUPPORT_PRIORITIES, type SupportManualChannel } from '@/lib/support/domain';
import { SUPPORT_PRIORITY_META } from '@/lib/admin/statusRegistry';
import { deriveTitle, isMeaningfulText } from '@/lib/support/rules';
import Button, { ButtonLink } from '../../../../_components/ui/Button';
import { FormField, Input, Select, Textarea } from '../../../../_components/ui/Form';
import InlineAlert from '../../../../_components/ui/InlineAlert';
import { Card } from '../../../../_components/ui/Panel';
import { useAdminToast } from '../../../../_components/ui/Toaster';
import AttachmentStrip from '../../../../_components/support/AttachmentStrip';
import { useSupportUploads } from '../../../../_components/support/useSupportUploads';
import { newClientKey, supportFetch } from '../../../../_components/support/supportClient';

// [14/10/2026 18:32] Chloé : … or 14/10/2026, 18:32 - Chloé : … (pasted WhatsApp conversation)
const WHATSAPP_LINE = /^\s*\[?(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),?\s+(\d{1,2})[:h](\d{2})(?::\d{2})?\]?\s*(?:[-–]\s*)?([^:\n]{1,40}):/m;

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Date and sender of the first line of a pasted WhatsApp conversation (suggestion only). */
function guessFromPaste(text: string): { reportedAt: string | null; contact: string | null } {
  const match = WHATSAPP_LINE.exec(text);
  if (!match) return { reportedAt: null, contact: null };
  const [, d, m, y, h, min, name] = match;
  const year = Number(y) < 100 ? 2000 + Number(y) : Number(y);
  const date = new Date(year, Number(m) - 1, Number(d), Number(h), Number(min));
  return { reportedAt: Number.isNaN(date.getTime()) || date > new Date() ? null : toLocalInput(date), contact: name?.trim() || null };
}

export default function ManualTicketForm({ tenants, preselectedTenant }: { tenants: Array<{ id: string; name: string; isTest: boolean }>; preselectedTenant: string | null }) {
  const router = useRouter();
  const toast = useAdminToast();
  const [tenantId, setTenantId] = useState(preselectedTenant ?? '');
  const [channel, setChannel] = useState<SupportManualChannel>('whatsapp');
  const [category, setCategory] = useState('problem');
  const [priority, setPriority] = useState('normal');
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [contact, setContact] = useState('');
  const [reportedAt, setReportedAt] = useState(() => toLocalInput(new Date()));
  const [reference, setReference] = useState('');
  const [visible, setVisible] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientKey = useRef(newClientKey());
  const extra = useMemo(() => ({ tenantId }), [tenantId]);
  const uploads = useSupportUploads('/api/admin/platform/assistance/attachments', extra);
  const canSubmit = Boolean(tenantId) && isMeaningfulText(text, SUPPORT_LIMITS.bodyMin) && !uploads.busy && !sending;

  function onTextChange(value: string) {
    // First paste of a WhatsApp conversation: suggest its date and sender (still editable).
    if (!text && value.length > 20) {
      const guess = guessFromPaste(value);
      if (guess.reportedAt) setReportedAt(guess.reportedAt);
      if (guess.contact && !contact) setContact(guess.contact);
    }
    setText(value);
  }

  async function submit() {
    if (!canSubmit) return;
    setSending(true);
    setError(null);
    try {
      const data = await supportFetch<{ ticket: { id: string; number: number } }>('/api/admin/platform/assistance/tickets', {
        body: {
          tenantId, channel, category, priority, text, title: title.trim() || null, requesterLabel: contact.trim() || null,
          reportedAt: reportedAt ? new Date(reportedAt).toISOString() : null, externalReference: reference.trim() || null,
          visible, attachmentIds: uploads.readyIds, clientKey: clientKey.current,
        },
      });
      toast.success(`Demande n° ${data.ticket.number} créée.`);
      router.push(`/admin/platform/assistance/${data.ticket.id}`);
    } catch (caught) {
      setError((caught as Error).message);
      setSending(false);
    }
  }

  return (
    <Card className="p-4 sm:p-5">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <FormField label="Boutique" required>
          <Select value={tenantId} onChange={(event) => { setTenantId(event.target.value); uploads.reset(); }}>
            <option value="">Choisir…</option>
            {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}{tenant.isTest ? ' (test)' : ''}</option>)}
          </Select>
        </FormField>
        <FormField label="Canal d’origine" required>
          <Select value={channel} onChange={(event) => setChannel(event.target.value as SupportManualChannel)}>
            {SUPPORT_MANUAL_CHANNELS.map((value) => <option key={value} value={value}>{SUPPORT_CHANNEL_LABELS[value]}</option>)}
          </Select>
        </FormField>
        <FormField label="Message reçu" required className="sm:col-span-2" hint="Collez la conversation WhatsApp ou résumez l’appel. La date et l’expéditeur de la première ligne sont repris automatiquement.">
          <Textarea value={text} rows={7} maxLength={SUPPORT_LIMITS.bodyMax} onChange={(event) => onTextChange(event.target.value)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'));
              if (files.length && tenantId) { event.preventDefault(); uploads.add(files); }
            }} />
        </FormField>
        <FormField label="Titre" optional className="sm:col-span-2" hint={text ? `Proposé : « ${deriveTitle(text)} »` : undefined}>
          <Input value={title} maxLength={140} onChange={(event) => setTitle(event.target.value)} placeholder={text ? deriveTitle(text) : 'Déduit du message'} />
        </FormField>
        <FormField label="Contact" optional hint="Nom de la personne qui a écrit ou appelé.">
          <Input value={contact} maxLength={120} onChange={(event) => setContact(event.target.value)} />
        </FormField>
        <FormField label="Date de la demande" required>
          <Input type="datetime-local" value={reportedAt} max={toLocalInput(new Date())} onChange={(event) => setReportedAt(event.target.value)} />
        </FormField>
        <FormField label="Type">
          <Select value={category} onChange={(event) => setCategory(event.target.value)}>
            {Object.entries(SUPPORT_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </FormField>
        <FormField label="Priorité">
          <Select value={priority} onChange={(event) => setPriority(event.target.value)}>
            {SUPPORT_PRIORITIES.map((value) => <option key={value} value={value}>{SUPPORT_PRIORITY_META[value]?.label}</option>)}
          </Select>
        </FormField>
        <FormField label="Référence externe" optional hint="Ex. lien ou identifiant du message, numéro d’appel.">
          <Input value={reference} maxLength={200} onChange={(event) => setReference(event.target.value)} />
        </FormField>
        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-a-text">Captures</p>
          {tenantId ? <AttachmentStrip uploads={uploads} /> : <p className="text-xs text-a-text-3">Choisissez d’abord la boutique.</p>}
        </div>
        <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm font-semibold text-a-text sm:col-span-2">
          <input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} className="h-5 w-5 rounded border-a-field accent-a-brand" />
          Visible tout de suite par la boutique dans « Mes demandes »
        </label>
        {error && <InlineAlert tone="danger" className="sm:col-span-2">{error}</InlineAlert>}
        <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
          <ButtonLink href="/admin/platform/assistance" variant="secondary">Annuler</ButtonLink>
          <Button type="submit" loading={sending} disabled={!canSubmit}>Créer la demande</Button>
        </div>
      </form>
    </Card>
  );
}
