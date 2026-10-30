'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { IconAlertTriangle, IconBulb, IconCheck, IconCircleCheck, IconHelpCircle, IconLifebuoy, IconMapPin, IconSparkles, IconX } from '@tabler/icons-react';
import { SUPPORT_CATEGORY_CHOICES, SUPPORT_LIMITS, supportReference, type SupportCategory } from '@/lib/support/domain';
import { isMeaningfulText, pageLabelForPath, resourceFromPath } from '@/lib/support/rules';
import { SUPPORT_TENANT_STATUS_META } from '@/lib/admin/statusRegistry';
import { cn } from '@/lib/utils/cn';
import { Drawer } from '../ui/Dialog';
import Button, { ButtonLink } from '../ui/Button';
import Badge from '../ui/Badge';
import InlineAlert from '../ui/InlineAlert';
import { Select, Textarea, labelClasses } from '../ui/Form';
import AttachmentStrip from './AttachmentStrip';
import { useSupportUploads } from './useSupportUploads';
import { clearDraft, newClientKey, readDraft, supportFetch, writeDraft } from './supportClient';

const CHOICE_ICON = { problem: IconAlertTriangle, improvement: IconBulb, question: IconHelpCircle } as const;

let improveAvailability: Promise<boolean> | null = null;
function improveAvailable(): Promise<boolean> {
  improveAvailability ??= supportFetch<{ available: boolean }>('/api/admin/assistance/improve')
    .then((data) => data.available === true).catch(() => false);
  return improveAvailability;
}

interface Similar { id: string; number: number; title: string; tenant_status: string }

/**
 * Quick panel « Comment pouvons-nous vous aider ? »: one text is enough. The
 * category, the urgency, the screenshots and the page are optional; the page
 * is added automatically and can be changed or removed.
 */
export default function SupportComposer({ open, onClose, pathname, initialCategory, initialText, pageLabels, readOnly, helpArticle = null }: {
  open: boolean;
  onClose: () => void;
  pathname: string;
  initialCategory: SupportCategory | null;
  initialText: string | null;
  pageLabels: string[];
  readOnly: boolean;
  /** Help Center guide read just before (reference sent with the request). */
  helpArticle?: string | null;
}) {
  const formId = useId();
  const textId = useId();
  const draft = useMemo(() => (typeof window === 'undefined' ? null : readDraft()), []);
  const [category, setCategory] = useState<SupportCategory | null>(initialCategory ?? (draft?.category as SupportCategory | null) ?? null);
  const [text, setText] = useState(initialText ?? draft?.text ?? '');
  const [urgent, setUrgent] = useState(draft?.urgent ?? false);
  const derivedLabel = useMemo(() => pageLabelForPath(pathname), [pathname]);
  const [page, setPage] = useState<{ include: boolean; label: string }>({ include: !pathname.startsWith('/admin/assistance'), label: derivedLabel });
  const [changingPage, setChangingPage] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ id: string; number: number } | null>(null);
  const [similar, setSimilar] = useState<Similar[]>([]);
  const [canImprove, setCanImprove] = useState(false);
  const [improving, setImproving] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [improveError, setImproveError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const clientKey = useRef(newClientKey());
  const uploads = useSupportUploads('/api/admin/assistance/attachments');
  const resource = resourceFromPath(pathname);
  const meaningful = isMeaningfulText(text, SUPPORT_LIMITS.bodyMin);

  useEffect(() => { if (open && !readOnly) void improveAvailable().then(setCanImprove); }, [open, readOnly]);

  // Draft on this device (text only): closing the panel or changing page never loses it.
  useEffect(() => {
    if (sent) return;
    const timer = window.setTimeout(() => writeDraft({ text, category, urgent }), 400);
    return () => window.clearTimeout(timer);
  }, [text, category, urgent, sent]);

  // Similar open requests of this shop, while writing (never blocking).
  useEffect(() => {
    if (!open || sent || text.trim().length < SUPPORT_LIMITS.similarMinChars) { setSimilar([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      supportFetch<{ similar: Similar[] }>(`/api/admin/assistance/similar?q=${encodeURIComponent(text.slice(0, 600))}`, { signal: controller.signal })
        .then((data) => setSimilar(data.similar ?? [])).catch(() => {});
    }, 700);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [text, open, sent]);

  async function submit() {
    if (sending || readOnly) return;
    if (!meaningful) { setError('Écrivez quelques mots pour expliquer la situation.'); return; }
    if (uploads.busy) { setError('Les images sont encore en cours d’envoi, un instant.'); return; }
    setSending(true);
    setError(null);
    try {
      const data = await supportFetch<{ ticket: { id: string; number: number } }>('/api/admin/assistance/tickets', {
        body: {
          text,
          category: category ?? 'unspecified',
          urgent,
          includePage: page.include,
          pathname: page.include ? pathname : null,
          pageLabel: page.include && page.label !== derivedLabel ? page.label : null,
          locale: typeof navigator !== 'undefined' ? navigator.language : null,
          viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : null,
          attachmentIds: uploads.readyIds,
          clientKey: clientKey.current,
          helpArticle,
        },
      });
      clearDraft();
      uploads.reset();
      setSent(data.ticket);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function improve() {
    setImproving(true);
    setImproveError(null);
    setSuggestion(null);
    try {
      const data = await supportFetch<{ text: string }>('/api/admin/assistance/improve', { body: { text } });
      setSuggestion(data.text);
    } catch (caught) {
      setImproveError((caught as Error).message);
    } finally {
      setImproving(false);
    }
  }

  function onPaste(event: React.ClipboardEvent) {
    const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'));
    if (files.length) { event.preventDefault(); uploads.add(files); }
  }

  const pageOptions = useMemo(() => Array.from(new Set([derivedLabel, ...pageLabels])), [derivedLabel, pageLabels]);

  if (sent) {
    return (
      <Drawer open={open} onClose={onClose} title="Demande envoyée" icon={<IconLifebuoy size={20} className="text-a-brand-fg" />}
        footer={<><Button variant="secondary" onClick={onClose}>Fermer</Button><ButtonLink href={`/admin/assistance/${sent.id}`} variant="primary" onClick={onClose}>Voir la conversation</ButtonLink></>}>
        <div className="flex flex-col items-center px-2 py-8 text-center" role="status">
          <span aria-hidden="true" className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-tone-success-bg text-tone-success-fg"><IconCircleCheck size={30} /></span>
          <p className="text-base font-semibold text-a-text">Votre demande a bien été envoyée.</p>
          <p className="mt-2 text-sm text-a-text-2">Référence <strong className="text-a-text">{supportReference(sent.number)}</strong>. Nous vous répondons ici et vous prévenons par e-mail.</p>
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      dismissible={!sending}
      title="Comment pouvons-nous vous aider ?"
      description="Une phrase suffit. L’équipe Lepefy vous répond ici."
      icon={<IconLifebuoy size={20} className="text-a-brand-fg" />}
      footer={(
        <>
          <ButtonLink href="/admin/assistance" variant="ghost" onClick={onClose}>Mes demandes</ButtonLink>
          <Button type="submit" form={formId} loading={sending} disabled={readOnly || uploads.busy || !meaningful}>
            {uploads.busy ? 'Envoi des images…' : 'Envoyer'}
          </Button>
        </>
      )}
    >
      <form id={formId} className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}
        onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }}
        onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
        onDrop={(event) => { event.preventDefault(); setDragging(false); uploads.add(event.dataTransfer.files); }}>
        {readOnly && <InlineAlert tone="info">Vous êtes connecté avec un compte Lepefy : ce formulaire est réservé à l’équipe de la boutique. Répondez aux boutiques depuis la console « Assistance tenants ».</InlineAlert>}

        {/* A Lepefy account only previews the panel: every control is disabled (and looks it). */}
        <fieldset disabled={readOnly} className="min-w-0 space-y-4 disabled:opacity-50">
        <fieldset>
          <legend className={labelClasses}>De quoi s’agit-il ? <span className="font-normal text-a-text-3">(facultatif)</span></legend>
          <div className="grid gap-2">
            {SUPPORT_CATEGORY_CHOICES.map((choice) => {
              const Icon = CHOICE_ICON[choice.key];
              const active = category === choice.key;
              return (
                <button key={choice.key} type="button" aria-pressed={active} onClick={() => setCategory(active ? null : choice.key)}
                  className={cn('group flex min-h-12 items-center gap-3 rounded-xl border-2 px-3 text-left text-sm font-semibold shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-a-focus disabled:cursor-not-allowed disabled:shadow-none',
                    active ? 'border-a-brand bg-a-brand-soft text-a-brand-fg' : 'border-a-border-strong bg-a-surface text-a-text hover:border-a-brand hover:bg-a-hover disabled:hover:border-a-border-strong disabled:hover:bg-a-surface')}>
                  <span aria-hidden="true" className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', active ? 'bg-a-brand text-a-on-brand' : 'bg-a-surface-2 text-a-text-2 group-hover:text-a-brand-fg')}>
                    <Icon size={20} />
                  </span>
                  <span className="min-w-0 flex-1">{choice.label}</span>
                  <span aria-hidden="true" className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2', active ? 'border-a-brand bg-a-brand text-a-on-brand' : 'border-a-field bg-a-surface')}>
                    {active && <IconCheck size={12} stroke={3} />}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className={cn('rounded-xl', dragging && 'outline outline-2 outline-offset-4 outline-a-focus')}>
          <label htmlFor={textId} className={labelClasses}>Votre message</label>
          <Textarea id={textId} value={text} rows={5} maxLength={SUPPORT_LIMITS.bodyMax} autoFocus
            placeholder="Expliquez-nous ce qui se passe…" onChange={(event) => { setText(event.target.value); setSuggestion(null); }} onPaste={onPaste}
            className="min-h-32 resize-y text-base sm:text-sm" />
          <p className="mt-1.5 text-xs text-a-text-3">
            <span className="sm:hidden">Astuce : le micro de votre clavier permet de dicter. </span>
            <span className="hidden sm:inline">Collez une capture (Ctrl V) ou glissez-la ici. </span>
          </p>
        </div>

        {similar.length > 0 && (
          <InlineAlert tone="info" title="Vous avez déjà une demande similaire.">
            <ul className="mt-1 space-y-1">
              {similar.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{supportReference(item.number)} · {item.title}</span>
                  <Badge tone={SUPPORT_TENANT_STATUS_META[item.tenant_status]?.tone ?? 'info'} dot>{SUPPORT_TENANT_STATUS_META[item.tenant_status]?.label ?? 'En cours'}</Badge>
                  <Link href={`/admin/assistance/${item.id}`} onClick={onClose} className="font-semibold text-a-brand-fg underline underline-offset-2">Voir la conversation</Link>
                </li>
              ))}
            </ul>
          </InlineAlert>
        )}

        <AttachmentStrip uploads={uploads} disabled={readOnly} />

        <div className="space-y-2">
          {page.include ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-a-border bg-a-surface-2 px-3 py-2 text-sm">
              <IconMapPin size={16} aria-hidden="true" className="text-a-text-3" />
              <span className="min-w-0 flex-1 text-a-text-2">Page concernée : <strong className="text-a-text">{page.label}</strong>{resource && page.label === derivedLabel ? <span className="text-a-text-3"> · fiche ouverte</span> : null}</span>
              <button type="button" className="text-sm font-semibold text-a-brand-fg underline-offset-2 hover:underline" onClick={() => setChangingPage((value) => !value)}>Changer</button>
              <button type="button" aria-label="Retirer la page concernée" className="flex h-7 w-7 items-center justify-center rounded-md text-a-text-2 hover:bg-a-hover"
                onClick={() => { setPage((current) => ({ ...current, include: false })); setChangingPage(false); }}><IconX size={15} aria-hidden="true" /></button>
            </div>
          ) : (
            <button type="button" className="text-sm font-semibold text-a-brand-fg underline-offset-2 hover:underline"
              onClick={() => setPage({ include: true, label: derivedLabel })}>Indiquer la page concernée</button>
          )}
          {changingPage && page.include && (
            <Select aria-label="Page concernée" value={page.label} onChange={(event) => { setPage({ include: true, label: event.target.value }); setChangingPage(false); }}>
              {pageOptions.map((label) => <option key={label} value={label}>{label}</option>)}
            </Select>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm font-semibold text-a-text">
            <input type="checkbox" checked={urgent} disabled={readOnly} onChange={(event) => setUrgent(event.target.checked)} className="h-5 w-5 rounded border-a-field accent-a-brand" />
            C’est urgent
          </label>
          {canImprove && text.trim().length >= SUPPORT_LIMITS.improveMinChars && !suggestion && (
            <Button variant="ghost" size="sm" onClick={() => void improve()} loading={improving}><IconSparkles size={16} aria-hidden="true" />Améliorer mon message</Button>
          )}
        </div>
        </fieldset>
        {improveError && <p className="text-sm text-a-text-2" role="status">{improveError}</p>}
        {suggestion && (
          <div className="rounded-xl border border-a-brand bg-a-brand-soft p-3" role="region" aria-label="Message proposé">
            <p className="text-xs font-semibold text-a-brand-fg">Proposition (rien n’est envoyé sans vous)</p>
            <p className="mt-1.5 whitespace-pre-wrap text-sm text-a-text">{suggestion}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => { setText(suggestion); setSuggestion(null); }}>Utiliser ce texte</Button>
              <Button size="sm" variant="secondary" onClick={() => setSuggestion(null)}>Garder mon texte</Button>
            </div>
          </div>
        )}

        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </form>
    </Drawer>
  );
}
