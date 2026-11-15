'use client';

import { useMemo, useState } from 'react';
import { IconBrandWhatsapp, IconCopy, IconMail, IconPhone } from '@tabler/icons-react';
import { lintMessageText, MESSAGE_CHANNEL_LIMITS } from '@/lib/growth/engine';
import {
  CHANNEL_LABEL, OUTCOME_LABEL, internationalDigits, isLikelyMobile, mailtoLink, whatsappDecision, whatsappLink, withOptOut,
} from '@/lib/growth/contactPolicy';
import { TOUCH_CHANNELS, TOUCH_OUTCOMES, type GrowthProspectRow, type GrowthTouchRow, type TouchChannel, type TouchOutcome } from '@/lib/growth/types';
import { shopLocalToIso } from '@/lib/time/shopTime';
import { parisDay } from '@/lib/growth/dates';
import Button, { ButtonAnchor } from '../../../../_components/ui/Button';
import ConfirmDialog from '../../../../_components/ui/ConfirmDialog';
import { FormField, Input, Select, Textarea } from '../../../../_components/ui/Form';
import InlineAlert, { ErrorText } from '../../../../_components/ui/InlineAlert';
import { Panel } from '../../../../_components/ui/Panel';
import { useAdminMutation } from '../../../../_components/ui/useAdminMutation';
import { useAdminToast } from '../../../../_components/ui/Toaster';

const WRITTEN = new Set(['whatsapp', 'email', 'instagram_dm', 'contact_form']);
const DRAFT_CHANNELS: { value: string; label: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'E-mail' },
  { value: 'contact_form', label: 'Formulaire du site' },
  { value: 'instagram_dm', label: 'Message Instagram' },
  { value: 'visit_opening', label: 'Phrase d’ouverture (visite, appel)' },
];
/** Channel of a recorded contact for a draft channel. */
const TOUCH_FOR_DRAFT: Record<string, TouchChannel> = { whatsapp: 'whatsapp', email: 'email', contact_form: 'modulo', instagram_dm: 'instagram', visit_opening: 'visita' };

function inDays(days: number): string {
  const d = new Date(`${parisDay()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return shopLocalToIso(`${d.toISOString().slice(0, 10)}T09:00`) ?? new Date(Date.now() + days * 86_400_000).toISOString();
}

interface PendingSend { channel: TouchChannel; text: string }

export function ContactPanel({ prospect, touches, whatsappSentToday }: { prospect: GrowthProspectRow; touches: GrowthTouchRow[]; whatsappSentToday: number }) {
  const d = prospect.dossier;
  const toast = useAdminToast();
  const draftMutation = useAdminMutation();
  const touchMutation = useAdminMutation();
  const [channel, setChannel] = useState<string>(WRITTEN.has(d.message.channel) ? d.message.channel : 'whatsapp');
  const [text, setText] = useState(prospect.message_draft ?? d.message.text);
  const [pending, setPending] = useState<PendingSend | null>(null);
  const [followUpDays, setFollowUpDays] = useState(5);

  const written = WRITTEN.has(channel);
  const finalText = written ? withOptOut(text, d.message.language) : text;
  const issues = useMemo(() => lintMessageText(d, finalText, channel), [d, finalText, channel]);
  const decision = whatsappDecision({
    country: prospect.country, doNotContact: prospect.do_not_contact, stage: prospect.sales_stage,
    touches: touches.length, whatsappTouches: touches.filter((t) => t.channel === 'whatsapp').length,
    whatsappSentToday, chatOrdersConfirmed: prospect.evaluation?.signals?.chatOrders === 'confirmed',
  });
  const phones = (d.phones ?? []).map((raw) => {
    const digits = internationalDigits(raw, prospect.country);
    return { raw, digits, mobile: digits ? isLikelyMobile(digits) : false };
  });
  const mail = d.email ? mailtoLink(d.email, `Lepefy · ${d.name}`, finalText) : null;
  const blockedByLint = issues.length > 0;
  const closed = prospect.do_not_contact || prospect.sales_stage === 'perso' || prospect.sales_stage === 'cliente';

  async function saveDraft() {
    await draftMutation.run(`/api/admin/platform/prospection/${prospect.id}`, {
      method: 'PATCH', body: { expectedUpdatedAt: prospect.updated_at, messageDraft: text }, successMessage: 'Brouillon enregistré.',
    });
  }

  function openWhatsApp(digits: string) {
    window.open(whatsappLink(digits, finalText), '_blank', 'noopener,noreferrer');
    setPending({ channel: 'whatsapp', text: finalText });
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(finalText);
      toast.success('Message copié.');
      setPending({ channel: TOUCH_FOR_DRAFT[channel] ?? 'altro', text: finalText });
    } catch { toast.error('Copie impossible : sélectionnez le texte à la main.'); }
  }

  async function confirmSent() {
    if (!pending) return;
    const ok = await touchMutation.run(`/api/admin/platform/prospection/${prospect.id}/touches`, {
      withKey: true,
      body: { channel: pending.channel, outcome: 'contattato', messageText: pending.text, nextActionAt: inDays(followUpDays) },
      successMessage: 'Contact enregistré.',
    });
    if (ok) setPending(null);
  }

  return (
    <Panel title="Contacter" description="Lepefy n’envoie rien : le message s’ouvre dans votre application, vous l’envoyez, puis vous confirmez ici.">
      <div className="flex flex-col gap-4">
        {closed && <InlineAlert tone="neutral" title="Plus de premier message">Ce commerce a refusé, est client, ou ne veut plus être contacté.</InlineAlert>}
        <FormField label="Canal du message">
          <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
            {DRAFT_CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </FormField>
        <FormField
          label={`Message (${d.message.language})`}
          hint={`${finalText.length}/${MESSAGE_CHANNEL_LIMITS[channel] ?? '?'} caractères${written ? ' · la phrase pour ne plus être recontacté est ajoutée à l’envoi' : ''}`}
        >
          <Textarea rows={9} value={text} onChange={(e) => setText(e.target.value)} />
        </FormField>
        {issues.length > 0 ? (
          <InlineAlert tone="warning" title="À corriger avant l’envoi">
            <ul className="list-disc pl-5">{issues.map((i) => <li key={i}>{i}</li>)}</ul>
          </InlineAlert>
        ) : (
          <p className="text-sm text-a-text-3">Contrôle du message : aucun problème (faits sourcés, une seule question, aucune promesse).</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={saveDraft} loading={draftMutation.pending} disabled={text === (prospect.message_draft ?? d.message.text)}>Enregistrer le brouillon</Button>
          <Button variant="ghost" size="sm" onClick={() => setText(d.message.text)}>Revenir au message de la fiche</Button>
        </div>
        <ErrorText message={draftMutation.error} />

        <div className="flex flex-col gap-2 border-t border-a-border pt-4">
          <p className="text-sm font-semibold text-a-text">Coordonnées publiques</p>
          {phones.length === 0 && !mail && <p className="text-sm text-a-text-3">Aucun numéro ni e-mail dans la fiche.</p>}
          {phones.map((p) => (
            <div key={p.raw} className="flex flex-wrap items-center gap-2">
              <span className="text-sm tabular-nums text-a-text">{p.raw}</span>
              {p.digits && <ButtonAnchor size="sm" variant="outline" href={`tel:+${p.digits}`}><IconPhone size={16} aria-hidden /> Appeler</ButtonAnchor>}
              {p.digits && p.mobile && channel === 'whatsapp' && (
                <Button size="sm" variant="primary" disabled={closed || !decision.allowed || blockedByLint} onClick={() => openWhatsApp(p.digits!)}>
                  <IconBrandWhatsapp size={16} aria-hidden /> Ouvrir WhatsApp
                </Button>
              )}
              {p.digits && !p.mobile && <span className="text-xs text-a-text-3">ligne fixe : pas de WhatsApp</span>}
            </div>
          ))}
          {mail && channel === 'email' && (
            <ButtonAnchor size="sm" variant="primary" href={blockedByLint || closed ? undefined : mail} aria-disabled={blockedByLint || closed || undefined}
              onClick={() => { if (!blockedByLint && !closed) setPending({ channel: 'email', text: finalText }); }}>
              <IconMail size={16} aria-hidden /> Préparer l’e-mail
            </ButtonAnchor>
          )}
          {(channel === 'contact_form' || channel === 'instagram_dm') && (
            <Button size="sm" variant="primary" disabled={closed || blockedByLint} onClick={copyMessage}><IconCopy size={16} aria-hidden /> Copier le message</Button>
          )}
          {channel === 'whatsapp' && !decision.allowed && decision.blockedReason && <p className="text-sm text-tone-danger-fg">{decision.blockedReason}</p>}
          {channel === 'whatsapp' && decision.warnings.map((w) => <p key={w} className="text-sm text-tone-warning-fg">{w}</p>)}
        </div>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title="Le message est-il parti ?"
        description={`Confirmez seulement si vous avez envoyé le message (${pending ? CHANNEL_LABEL[pending.channel] : ''}). Il sera enregistré tel quel.`}
        confirmLabel="Oui, enregistrer"
        cancelLabel="Non, pas envoyé"
        loading={touchMutation.pending}
        error={touchMutation.error}
        onConfirm={confirmSent}
        onCancel={() => { setPending(null); touchMutation.setError(null); }}
      >
        <FormField label="Relance prévue dans">
          <Select value={String(followUpDays)} onChange={(e) => setFollowUpDays(Number(e.target.value))}>
            {[3, 5, 7, 14].map((n) => <option key={n} value={n}>{n} jours</option>)}
          </Select>
        </FormField>
      </ConfirmDialog>
    </Panel>
  );
}

export function TouchForm({ prospectId, closed }: { prospectId: string; closed: boolean }) {
  const mutation = useAdminMutation();
  const [channel, setChannel] = useState<TouchChannel>('visita');
  const [outcome, setOutcome] = useState<TouchOutcome>('contattato');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [messageText, setMessageText] = useState('');
  const [nextDate, setNextDate] = useState('');
  const [stop, setStop] = useState(false);
  const refusal = outcome === 'rifiuto';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const ok = await mutation.run(`/api/admin/platform/prospection/${prospectId}/touches`, {
      withKey: true,
      body: {
        channel, outcome, reason: reason || null, note: note || null, messageText: messageText || null,
        nextActionAt: nextDate ? shopLocalToIso(`${nextDate}T09:00`) : null, doNotContact: refusal && stop,
      },
      successMessage: 'Échange enregistré.',
    });
    if (ok) { setReason(''); setNote(''); setMessageText(''); setNextDate(''); setStop(false); }
  }

  return (
    <Panel title="Enregistrer un échange" description="Visite, appel, réponse, démo, refus : chaque étape fait avancer la fiche.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Canal">
            <Select value={channel} onChange={(e) => setChannel(e.target.value as TouchChannel)}>
              {TOUCH_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
            </Select>
          </FormField>
          <FormField label="Résultat">
            <Select value={outcome} onChange={(e) => setOutcome(e.target.value as TouchOutcome)}>
              {TOUCH_OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
            </Select>
          </FormField>
        </div>
        {refusal && (
          <FormField label="Motif du refus" required>
            <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Ex. a déjà un site, pas le temps, prix" />
          </FormField>
        )}
        {(channel === 'whatsapp' || channel === 'email' || channel === 'instagram' || channel === 'modulo') && outcome === 'contattato' && (
          <FormField label="Message envoyé" required hint="Collez le texte exact ; il doit proposer de ne plus être recontacté.">
            <Textarea rows={4} value={messageText} maxLength={2000} onChange={(e) => setMessageText(e.target.value)} />
          </FormField>
        )}
        <FormField label="Note" optional>
          <Textarea rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
        </FormField>
        {!refusal && outcome !== 'tenant_pagante' && (
          <FormField label="Prochaine action le" optional>
            <Input type="date" value={nextDate} min={parisDay()} onChange={(e) => setNextDate(e.target.value)} />
          </FormField>
        )}
        {refusal && (
          <label className="flex items-start gap-2 text-sm text-a-text">
            <input type="checkbox" className="mt-1" checked={stop} onChange={(e) => setStop(e.target.checked)} />
            Ne plus jamais contacter ce commerce (il ne sera plus proposé par la recherche)
          </label>
        )}
        <ErrorText message={mutation.error} />
        <div><Button type="submit" loading={mutation.pending} disabled={closed && outcome === 'contattato'}>Enregistrer</Button></div>
      </form>
    </Panel>
  );
}

export function DoNotContactPanel({ prospect }: { prospect: GrowthProspectRow }) {
  const mutation = useAdminMutation();
  const [open, setOpen] = useState(false);

  async function update(doNotContact: boolean, reason?: string) {
    const ok = await mutation.run(`/api/admin/platform/prospection/${prospect.id}`, {
      method: 'PATCH',
      body: { expectedUpdatedAt: prospect.updated_at, doNotContact, doNotContactReason: reason ?? null },
      successMessage: doNotContact ? 'Ce commerce ne sera plus contacté.' : 'Contact de nouveau possible.',
    });
    if (ok) setOpen(false);
  }

  return (
    <Panel title="Ne plus contacter">
      {prospect.do_not_contact ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-a-text">Motif : {prospect.do_not_contact_reason}</p>
          <div><Button variant="outline" size="sm" loading={mutation.pending} onClick={() => update(false)}>Autoriser de nouveau le contact</Button></div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-a-text-2">À utiliser dès qu’un commerce le demande : la fiche sort des listes et la recherche ne le propose plus, même sous un autre nom.</p>
          <div><Button variant="danger" size="sm" onClick={() => setOpen(true)}>Ne plus contacter</Button></div>
        </div>
      )}
      <ErrorText message={mutation.error} />
      <ConfirmDialog
        open={open}
        title="Ne plus contacter ce commerce ?"
        destructive
        confirmLabel="Ne plus contacter"
        loading={mutation.pending}
        error={mutation.error}
        reason={{ label: 'Motif', required: true, maxLength: 500, placeholder: 'Ex. a demandé à ne plus être contacté' }}
        onConfirm={(reason) => update(true, reason)}
        onCancel={() => setOpen(false)}
      />
    </Panel>
  );
}
