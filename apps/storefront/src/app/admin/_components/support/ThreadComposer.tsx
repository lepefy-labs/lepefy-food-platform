'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { IconSend } from '@tabler/icons-react';
import { SUPPORT_LIMITS } from '@/lib/support/domain';
import { isMeaningfulText } from '@/lib/support/rules';
import { cn } from '@/lib/utils/cn';
import Button from '../ui/Button';
import InlineAlert from '../ui/InlineAlert';
import { Textarea } from '../ui/Form';
import AttachmentStrip from './AttachmentStrip';
import { useSupportUploads } from './useSupportUploads';
import { newClientKey } from './supportClient';

/**
 * Message field of a conversation (shop and console). The text stays until
 * the server confirms it was saved; a failed send keeps the same key, so
 * « Réessayer » can never create a second message.
 */
export default function ThreadComposer({ onSend, uploadEndpoint, uploadExtra, placeholder = 'Écrire un message…', label = 'Votre message', submitLabel = 'Envoyer', tone = 'default', children, className }: {
  onSend: (input: { text: string; attachmentIds: string[]; clientKey: string }) => Promise<void>;
  uploadEndpoint: string;
  uploadExtra?: Record<string, string>;
  placeholder?: string;
  label?: string;
  submitLabel?: string;
  tone?: 'default' | 'note';
  /** Extra options above the send button (console: « J'attends une réponse »). */
  children?: ReactNode;
  className?: string;
}) {
  const textId = useId();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientKey = useRef(newClientKey());
  const uploads = useSupportUploads(uploadEndpoint, uploadExtra);
  const ready = isMeaningfulText(text, 1) && !uploads.busy;

  async function send() {
    if (!ready || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend({ text, attachmentIds: uploads.readyIds, clientKey: clientKey.current });
      setText('');
      uploads.reset();
      clientKey.current = newClientKey();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <form className={cn('space-y-2', className)} onSubmit={(event) => { event.preventDefault(); void send(); }}
      onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
      onDrop={(event) => { event.preventDefault(); uploads.add(event.dataTransfer.files); }}>
      <label htmlFor={textId} className="sr-only">{label}</label>
      <Textarea id={textId} value={text} rows={2} maxLength={SUPPORT_LIMITS.bodyMax} placeholder={placeholder} readOnly={sending}
        onChange={(event) => setText(event.target.value)}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'));
          if (files.length) { event.preventDefault(); uploads.add(files); }
        }}
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); } }}
        className={cn('max-h-60 min-h-12 resize-y text-base sm:text-sm', sending && 'text-a-text-3', tone === 'note' && 'border-dashed border-tone-warning-border bg-tone-warning-bg')} />
      {error && (
        <InlineAlert tone="danger" title="Message non envoyé." action={<Button size="sm" variant="secondary" onClick={() => void send()}>Réessayer</Button>}>
          {error}
        </InlineAlert>
      )}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <AttachmentStrip uploads={uploads} compact disabled={sending} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {children}
          <Button type="submit" loading={sending} disabled={!ready}>
            <IconSend size={16} aria-hidden="true" />{sending ? 'Envoi…' : uploads.busy ? 'Images en cours…' : submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
