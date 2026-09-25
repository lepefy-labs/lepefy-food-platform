'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconAlertTriangle, IconBrandWhatsapp, IconBuildingBank, IconBuildingStore, IconCheck, IconCircleCheck,
  IconClock, IconCopy, IconCreditCard, IconExternalLink, IconLoader2, IconMapPin, IconWallet, IconX,
} from '@tabler/icons-react';
import { StripePaymentStep } from '@/components/payments/StripePaymentStep';
import { formatPrice } from '@/lib/utils/format';
import type { PublicPaymentMethod, PublicPreorderView } from '@/lib/orders/assisted/payLinkPublic';

interface TenantBrand {
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  whatsappNumber: string | null;
  currency: string;
}

type Choice = { kind: 'card' } | { kind: 'external'; method: PublicPaymentMethod };

const POLL_INTERVAL_MS = 2500;
const POLL_MAX_ATTEMPTS = 48;

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso));
}

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
        <p className="break-all font-mono text-sm text-gray-900">{value}</p>
      </div>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          } catch { /* presse-papiers indisponible : la valeur reste sélectionnable */ }
        }}
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-200 focus-visible:outline focus-visible:outline-2"
        aria-label={`Copier ${label.toLowerCase()}`}
      >
        {copied ? <IconCheck size={18} className="text-emerald-600" /> : <IconCopy size={18} />}
      </button>
    </div>
  );
}

function StatusPanel({ tone, icon, title, children }: {
  tone: 'success' | 'info' | 'warning' | 'neutral';
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  const toneClass = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    neutral: 'border-gray-200 bg-gray-50 text-gray-800',
  }[tone];
  return (
    <section className={`rounded-2xl border p-4 ${toneClass}`} role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0 space-y-2">
          <h2 className="text-base font-semibold">{title}</h2>
          {children && <div className="text-sm leading-6">{children}</div>}
        </div>
      </div>
    </section>
  );
}

export default function PayPreorderClient({
  token,
  initialView,
  returnedFromPayment,
  tenant,
}: {
  token: string;
  initialView: PublicPreorderView | null;
  returnedFromPayment: boolean;
  tenant: TenantBrand;
}) {
  const [view, setView] = useState<PublicPreorderView | null>(initialView);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(returnedFromPayment && initialView?.status === 'open');
  const [pollExhausted, setPollExhausted] = useState(false);
  const [declaring, setDeclaring] = useState(false);
  const [transferReference, setTransferReference] = useState('');
  const pollAttempts = useRef(0);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/pay/${encodeURIComponent(token)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = await res.json() as { preorder: PublicPreorderView };
    setView(body.preorder);
    return body.preorder;
  }, [token]);

  // Après un paiement carte, le succès affiché vient du serveur (webhook Stripe
  // → commande créée), jamais de la seule confirmation navigateur.
  useEffect(() => {
    if (!confirming) return;
    pollAttempts.current = 0;
    const timer = window.setInterval(async () => {
      pollAttempts.current += 1;
      const next = await refresh().catch(() => null);
      if (next && next.status !== 'open') {
        setConfirming(false);
        window.clearInterval(timer);
      } else if (pollAttempts.current >= POLL_MAX_ATTEMPTS) {
        setPollExhausted(true);
        window.clearInterval(timer);
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [confirming, refresh]);

  const contactHref = tenant.whatsappNumber
    ? `https://wa.me/${tenant.whatsappNumber.replace(/\D/g, '')}?text=${encodeURIComponent(`Bonjour, au sujet de ma précommande ${view?.reference ?? ''}`)}`
    : null;

  async function declareExternal(method: PublicPaymentMethod, reference?: string) {
    setDeclaring(true);
    setError(null);
    // La fenêtre est ouverte avant l'appel réseau (sinon bloquée par Safari/iOS).
    const popup = method.kind === 'link' ? window.open('about:blank', '_blank') : null;
    try {
      const res = await fetch(`/api/pay/${encodeURIComponent(token)}/external`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ methodId: method.id, reference: reference || undefined }),
      });
      const body = await res.json().catch(() => null) as { error?: string; link?: string | null } | null;
      if (!res.ok) {
        popup?.close();
        setError(body?.error ?? 'Impossible d\'enregistrer ce choix. Réessayez.');
        await refresh().catch(() => null);
        return;
      }
      if (popup && body?.link) popup.location.href = body.link;
      else popup?.close();
      await refresh();
      setChoice(null);
    } catch {
      popup?.close();
      setError('Connexion impossible. Vérifiez votre réseau et réessayez.');
    } finally {
      setDeclaring(false);
    }
  }

  const header = (
    <header className="flex items-center gap-3 py-4">
      {tenant.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={tenant.logoUrl} alt={tenant.name} width={44} height={44} className="h-11 w-11 rounded-xl object-contain" />
      ) : (
        <span className="flex h-11 w-11 items-center justify-center rounded-xl text-lg font-bold text-white" style={{ backgroundColor: tenant.primaryColor }}>
          {tenant.name.slice(0, 1)}
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-base font-semibold text-gray-900">{tenant.name}</p>
        <p className="text-xs text-gray-500">Paiement sécurisé de votre précommande</p>
      </div>
    </header>
  );

  if (!view) {
    return (
      <main className="mx-auto min-h-screen max-w-xl bg-white px-4 pb-10">
        {header}
        <StatusPanel tone="neutral" icon={<IconX size={22} />} title="Ce lien n’est pas ou plus valide">
          <p>Il a peut-être été remplacé par un lien plus récent après une modification de votre précommande.</p>
          {contactHref && <a href={contactHref} className="mt-3 inline-flex min-h-11 items-center gap-2 font-semibold underline"><IconBrandWhatsapp size={18} /> Contacter {tenant.name}</a>}
        </StatusPanel>
      </main>
    );
  }

  const currency = view.currency || tenant.currency;
  const total = formatPrice(view.totals.total, currency);
  const firstName = view.customerName?.trim().split(/\s+/)[0];

  return (
    <main className="mx-auto min-h-screen max-w-xl bg-white px-4 pb-32 lg:pb-12">
      {header}

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Précommande</p>
            <h1 className="font-mono text-xl font-bold text-gray-950">{view.reference}</h1>
            {firstName && <p className="mt-1 text-sm text-gray-600">Bonjour {firstName}, voici le récapitulatif préparé pour vous.</p>}
          </div>
          <p className="text-right text-2xl font-bold text-gray-950">{total}</p>
        </div>

        <ul className="mt-4 divide-y divide-gray-100" aria-label="Articles">
          {view.items.map((item, index) => (
            <li key={`${item.name}-${index}`} className="flex items-center gap-3 py-3">
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.imageUrl} alt="" width={48} height={48} loading="lazy" className="h-12 w-12 shrink-0 rounded-lg bg-gray-50 object-cover" />
              ) : <span className="h-12 w-12 shrink-0 rounded-lg bg-gray-100" aria-hidden="true" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900">{item.name}</p>
                <p className="text-xs text-gray-500">{item.quantity} × {formatPrice(item.price, currency)}</p>
              </div>
              <p className="text-sm font-semibold text-gray-900">{formatPrice(item.lineTotal, currency)}</p>
            </li>
          ))}
        </ul>

        <dl className="mt-2 space-y-1.5 border-t border-gray-100 pt-3 text-sm">
          <div className="flex justify-between"><dt className="text-gray-600">Articles</dt><dd>{formatPrice(view.totals.subtotal, currency)}</dd></div>
          {view.totals.discount > 0 && <div className="flex justify-between text-emerald-700"><dt>Remise</dt><dd>−{formatPrice(view.totals.discount, currency)}</dd></div>}
          <div className="flex justify-between">
            <dt className="text-gray-600">{view.fulfillmentType === 'pickup' ? 'Retrait en magasin' : 'Livraison'}</dt>
            <dd>{view.fulfillmentType === 'pickup' || view.totals.shippingTotal === 0 ? 'Offert' : formatPrice(view.totals.shippingTotal, currency)}</dd>
          </div>
          <div className="flex justify-between border-t border-gray-100 pt-2 text-base font-bold"><dt>Total</dt><dd>{total}</dd></div>
        </dl>

        <div className="mt-3 flex items-start gap-2 rounded-xl bg-gray-50 p-3 text-sm text-gray-700">
          {view.fulfillmentType === 'pickup' ? <IconBuildingStore size={18} className="mt-0.5 shrink-0" /> : <IconMapPin size={18} className="mt-0.5 shrink-0" />}
          {view.fulfillmentType === 'pickup' || !view.shippingAddress ? (
            <p>Retrait en magasin chez {tenant.name}.</p>
          ) : (
            <p>
              {view.shippingAddress.full_name}<br />
              {view.shippingAddress.line1}{view.shippingAddress.line2 ? `, ${view.shippingAddress.line2}` : ''}<br />
              {view.shippingAddress.postal_code} {view.shippingAddress.city} · {view.shippingAddress.country}
            </p>
          )}
        </div>
      </section>

      <div className="mt-4 space-y-4">
        {error && (
          <p className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            <IconAlertTriangle size={18} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}

        {view.status === 'completed' && (
          <StatusPanel tone="success" icon={<IconCircleCheck size={22} />} title="Paiement reçu — commande confirmée">
            <p>Merci ! {tenant.name} prépare votre commande.</p>
            {view.trackingLink && (
              <a href={view.trackingLink} className="mt-2 inline-flex min-h-11 items-center gap-2 font-semibold underline">
                Suivre ma commande <IconExternalLink size={16} />
              </a>
            )}
          </StatusPanel>
        )}

        {view.status === 'cancelled' && (
          <StatusPanel tone="neutral" icon={<IconX size={22} />} title="Précommande annulée">
            <p>Aucun paiement n’est plus possible sur ce lien.</p>
          </StatusPanel>
        )}

        {view.status === 'expired' && (
          <StatusPanel tone="warning" icon={<IconClock size={22} />} title="Ce lien a expiré">
            <p>Les prix et la disponibilité doivent être revérifiés. Demandez un nouveau lien à {tenant.name}.</p>
            {contactHref && <a href={contactHref} className="mt-2 inline-flex min-h-11 items-center gap-2 font-semibold underline"><IconBrandWhatsapp size={18} /> Demander un nouveau lien</a>}
          </StatusPanel>
        )}

        {view.status === 'awaiting_verification' && (
          <StatusPanel tone="info" icon={<IconClock size={22} />} title="Paiement en cours de vérification">
            <p>
              Vous avez choisi {view.declaredPayment?.label ?? 'un paiement externe'}. {tenant.name} confirmera la commande dès réception du paiement de {total}.
            </p>
            <p className="text-xs">Référence à indiquer : <strong className="font-mono">{view.reference}</strong></p>
            {view.declaredPayment?.link && (
              <a href={view.declaredPayment.link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 font-semibold underline">
                Rouvrir le lien de paiement <IconExternalLink size={16} />
              </a>
            )}
          </StatusPanel>
        )}

        {view.status === 'draft' && (
          <StatusPanel tone="neutral" icon={<IconClock size={22} />} title="Précommande en cours de préparation">
            <p>Le magasin finalise votre précommande. Vous recevrez un nouveau lien.</p>
          </StatusPanel>
        )}

        {view.status === 'open' && confirming && (
          <StatusPanel tone="info" icon={<IconLoader2 size={22} className="animate-spin motion-reduce:animate-none" />} title="Confirmation du paiement en cours…">
            {pollExhausted
              ? <p>La confirmation prend plus de temps que prévu. Vous pouvez fermer cette page : {tenant.name} vous confirmera la commande. Ne payez pas une seconde fois.</p>
              : <p>Merci de patienter quelques secondes, ne payez pas une seconde fois.</p>}
          </StatusPanel>
        )}

        {view.status === 'open' && !confirming && (
          <section aria-labelledby="payment-title" className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="payment-title" className="text-base font-semibold text-gray-900">Choisissez votre paiement</h2>
              {view.expiresAt && <p className="text-xs text-gray-500">Valable jusqu’au {formatDateTime(view.expiresAt)}</p>}
            </div>

            <div className="grid gap-2" role="radiogroup" aria-label="Moyens de paiement">
              {view.card && (
                <button
                  type="button" role="radio" aria-checked={choice?.kind === 'card'}
                  onClick={() => { setChoice({ kind: 'card' }); setError(null); }}
                  className={`flex min-h-14 items-center gap-3 rounded-2xl border px-4 text-left text-sm font-semibold ${choice?.kind === 'card' ? 'border-2' : 'border-gray-200'}`}
                  style={choice?.kind === 'card' ? { borderColor: tenant.primaryColor } : undefined}
                >
                  <IconCreditCard size={20} /> Carte bancaire / Google Pay
                </button>
              )}
              {view.externalMethods.map((method) => {
                const active = choice?.kind === 'external' && choice.method.id === method.id;
                return (
                  <button
                    key={method.id} type="button" role="radio" aria-checked={active}
                    onClick={() => { setChoice({ kind: 'external', method }); setError(null); }}
                    className={`flex min-h-14 items-center gap-3 rounded-2xl border px-4 text-left text-sm font-semibold ${active ? 'border-2' : 'border-gray-200'}`}
                    style={active ? { borderColor: tenant.primaryColor } : undefined}
                  >
                    {method.kind === 'transfer' ? <IconBuildingBank size={20} /> : <IconWallet size={20} />} {method.label}
                  </button>
                );
              })}
            </div>

            {choice?.kind === 'card' && (
              <StripePaymentStep
                module="shop"
                amount={view.totals.total}
                currency={currency}
                color={tenant.primaryColor}
                returnUrl={`${window.location.origin}/pay/${token}?paid=1`}
                referenceId={null}
                payLabel={`Payer ${total}`}
                processingLabel="Paiement en cours…"
                billingCountryHint="Si un pays est demandé, indiquez celui associé à votre carte bancaire."
                createIntent={async () => {
                  const res = await fetch(`/api/pay/${encodeURIComponent(token)}/intent`, { method: 'POST' });
                  const body = await res.json().catch(() => null) as { clientSecret?: string; referenceId?: string; error?: string } | null;
                  if (!res.ok || !body?.clientSecret) {
                    await refresh().catch(() => null);
                    return { error: body?.error ?? 'Paiement indisponible. Réessayez.' };
                  }
                  return { clientSecret: body.clientSecret, reference_id: body.referenceId ?? null };
                }}
                onError={setError}
                onSucceeded={() => { setError(null); setConfirming(true); }}
              />
            )}

            {choice?.kind === 'external' && choice.method.kind === 'transfer' && (
              <div className="space-y-2 rounded-2xl border border-gray-200 p-4">
                <p className="text-sm text-gray-700">Effectuez un virement de <strong>{total}</strong> avec la référence ci-dessous, puis confirmez-le ici.</p>
                {choice.method.beneficiary && <CopyValue label="Bénéficiaire" value={choice.method.beneficiary} />}
                {choice.method.value && <CopyValue label="IBAN" value={choice.method.value} />}
                {choice.method.bic && <CopyValue label="BIC" value={choice.method.bic} />}
                <CopyValue label="Référence (motif)" value={view.reference} />
                <label className="block pt-1 text-sm">
                  <span className="text-gray-700">Référence de votre virement (facultatif)</span>
                  <input
                    value={transferReference} onChange={(event) => setTransferReference(event.target.value.slice(0, 120))}
                    className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 px-3 text-base" autoComplete="off"
                  />
                </label>
                <button
                  type="button" disabled={declaring} onClick={() => declareExternal(choice.method, transferReference)}
                  className="min-h-12 w-full rounded-2xl px-5 text-base font-bold text-white disabled:opacity-50"
                  style={{ backgroundColor: tenant.primaryColor }}
                >
                  {declaring ? 'Enregistrement…' : 'J’ai effectué le virement'}
                </button>
                <p className="text-xs text-gray-500">Votre commande sera confirmée par {tenant.name} à réception des fonds.</p>
              </div>
            )}

            {choice?.kind === 'external' && choice.method.kind !== 'transfer' && (
              <div className="space-y-2 rounded-2xl border border-gray-200 p-4">
                {choice.method.kind === 'instructions' && choice.method.value && <CopyValue label={choice.method.label} value={choice.method.value} />}
                <p className="text-sm text-gray-700">
                  Montant : <strong>{total}</strong> · Référence : <strong className="font-mono">{view.reference}</strong>
                </p>
                <button
                  type="button" disabled={declaring} onClick={() => declareExternal(choice.method)}
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-5 text-base font-bold text-white disabled:opacity-50"
                  style={{ backgroundColor: tenant.primaryColor }}
                >
                  {declaring ? 'Enregistrement…' : choice.method.kind === 'link' ? <>Payer avec {choice.method.label} <IconExternalLink size={18} /></> : `J’ai payé avec ${choice.method.label}`}
                </button>
                <p className="text-xs text-gray-500">Le paiement sera vérifié par {tenant.name} avant la confirmation de la commande.</p>
              </div>
            )}
          </section>
        )}

        {contactHref && view.status !== 'completed' && (
          <a href={contactHref} className="flex min-h-11 items-center justify-center gap-2 text-sm font-semibold text-gray-600 underline">
            <IconBrandWhatsapp size={18} /> Une question ? Écrire à {tenant.name}
          </a>
        )}
      </div>
    </main>
  );
}
