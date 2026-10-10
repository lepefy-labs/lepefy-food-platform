'use client';

import { useMemo, useState } from 'react';
import { IconBell, IconSend, IconShieldLock } from '@tabler/icons-react';

type TestEvent =
  | 'order-confirmed'
  | 'order-shipped'
  | 'order-ready-for-pickup'
  | 'order-completed'
  | 'order-cancelled'
  | 'order-stock-conflict'
  | 'payment-reminder'
  | 'external-payment-awaiting-verification'
  | 'event-external-payment-awaiting-verification'
  | 'event-reservation-confirmed'
  | 'review-invite'
  | 'tester-feedback-invite'
  | 'card-quick-payment-customer'
  | 'card-quick-payment-customer-app-live';

type FulfillmentType = 'delivery' | 'pickup';
type ReviewInviteKind = 'initial' | 'reminder';

const EVENTS: { value: TestEvent; label: string; description: string }[] = [
  { value: 'order-confirmed', label: 'Commande confirmée', description: 'Confirmation après paiement.' },
  { value: 'order-shipped', label: 'Commande expédiée', description: 'Email avec suivi transporteur.' },
  { value: 'order-ready-for-pickup', label: 'Prête au retrait', description: 'Click & Collect prêt.' },
  { value: 'order-completed', label: 'Commande terminée', description: 'Livrée ou retirée.' },
  { value: 'order-cancelled', label: 'Commande annulée', description: 'Annulation sans promesse de remboursement.' },
  { value: 'card-quick-payment-customer', label: 'Paiement carte confirmé (client)', description: 'Confirmation client après un paiement /card, avec la configuration réelle (boutique, app Android), sans paiement réel.' },
  { value: 'card-quick-payment-customer-app-live', label: 'Paiement carte confirmé (client) · app publiée', description: 'Même e-mail en simulant l’app Android publique : badge Google Play et lien vers la fiche Play Store du package du tenant.' },
  { value: 'payment-reminder', label: 'Rappel paiement', description: 'Rappel prudent pour un paiement externe non encore confirmé.' },
  { value: 'external-payment-awaiting-verification', label: 'Paiement externe à vérifier', description: 'Alerte interne au tenant pour vérification et confirmation.' },
  { value: 'order-stock-conflict', label: 'Conflit de stock', description: 'Notification opérationnelle de test.' },
  { value: 'event-external-payment-awaiting-verification', label: 'Événement · Paiement externe à vérifier', description: 'Alerte tenant Événementiel avec contexte réel et payload synthétique.' },
  { value: 'event-reservation-confirmed', label: 'Événement · Réservation confirmée', description: 'Confirmation client Événementiel sans créer de réservation.' },
  { value: 'review-invite', label: 'Avis · Invitation', description: 'Teste l’e-mail initial ou le rappel de demande d’avis sans créer d’invitation ni de token réel.' },
  { value: 'tester-feedback-invite', label: 'Invitation testeur · Feedback', description: 'Teste l’e-mail d’invitation avec les CTA Google Play et feedback sans créer d’invitation réelle.' },
];

interface Props {
  defaultEmail: string;
  tenantName: string;
  tenantSlug: string;
  defaultGooglePlayTestUrl?: string;
}

interface TestResult {
  ok?: boolean;
  status?: number;
  webhookPath?: string;
  response?: string | null;
  payload?: Record<string, unknown>;
  error?: string;
}

export default function NotificationTestConsole({ defaultEmail, tenantName, tenantSlug, defaultGooglePlayTestUrl }: Props) {
  const [event, setEvent] = useState<TestEvent>('order-confirmed');
  const [email, setEmail] = useState(defaultEmail);
  const [fullName, setFullName] = useState('Robertin');
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>('delivery');
  const [reviewInviteKind, setReviewInviteKind] = useState<ReviewInviteKind>('initial');
  const [total, setTotal] = useState('79.90');
  const [shippingTotal, setShippingTotal] = useState('8.90');
  const [trackingCode, setTrackingCode] = useState('TEST-TRACKING-001');
  const [trackingCarrier, setTrackingCarrier] = useState('Transporteur test');
  // Empty = no estimate (e-mail identical to a shipment without provider date).
  const [estimatedDeliveryDate, setEstimatedDeliveryDate] = useState(
    () => new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
  const [line1, setLine1] = useState('Adresse de test');
  const [postalCode, setPostalCode] = useState('00000');
  const [city, setCity] = useState('Reggio Emilia');
  const [country, setCountry] = useState('IT');
  const [googlePlayTestUrl, setGooglePlayTestUrl] = useState(
    defaultGooglePlayTestUrl || 'https://play.google.com/store/apps/details?id=com.lepefy.notification-test',
  );
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const eventDescription = useMemo(
    () => EVENTS.find(item => item.value === event)?.description ?? '',
    [event],
  );
  const isConfirmed = event === 'order-confirmed';
  const isShipped = event === 'order-shipped';
  const isPaymentReminder = event === 'payment-reminder';
  const isShopExternalPaymentTenantAlert = event === 'external-payment-awaiting-verification';
  const isEventExternalPaymentTenantAlert = event === 'event-external-payment-awaiting-verification';
  const isEventReservationConfirmed = event === 'event-reservation-confirmed';
  const isReviewInvite = event === 'review-invite';
  const isTesterFeedbackInvite = event === 'tester-feedback-invite';
  const isTenantAlert = isShopExternalPaymentTenantAlert || isEventExternalPaymentTenantAlert;
  const isEventTest = isEventExternalPaymentTenantAlert || isEventReservationConfirmed;
  const needsFulfillment = event === 'order-confirmed'
    || event === 'order-completed'
    || event === 'order-cancelled'
    || isShopExternalPaymentTenantAlert;

  async function sendTest() {
    setSending(true);
    setResult(null);
    try {
      const response = await fetch('/api/admin/platform/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event,
          email,
          fullName,
          fulfillmentType,
          reviewInviteKind,
          total: Number(total),
          shippingTotal: Number(shippingTotal),
          trackingCode,
          trackingCarrier,
          shippingEstimatedDeliveryDate: estimatedDeliveryDate,
          googlePlayTestUrl,
          address: {
            line1,
            postal_code: postalCode,
            city,
            country,
          },
        }),
      });
      const data = await response.json() as TestResult;
      setResult(data);
    } catch {
      setResult({ error: 'Impossible d’exécuter le test.' });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-a-brand-fg">
            <IconShieldLock size={16} /> Platform owner
          </div>
          <h2 className="text-xl font-semibold text-a-text">Tests des modèles</h2>
          <p className="mt-1 max-w-2xl text-sm text-a-text-2">
            Envoie un email de test réel, rendu avec le modèle de production et transmis par le transport actif, sans créer de commande, réservation, invitation d’avis ou invitation testeur, ni modifier le stock, la capacité, la fidélité ou un paiement.
          </p>
        </div>
        <div className="rounded-xl border border-a-border bg-a-brand-soft px-4 py-3 text-sm text-a-brand-fg">
          <div className="font-semibold">Tenant courant</div>
          <div>{tenantName} <span className="text-a-brand-fg">({tenantSlug})</span></div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]">
        <section className="rounded-2xl border border-a-border bg-a-surface p-5 shadow-sm">
          <div className="mb-5 flex items-center gap-2">
            <IconBell size={20} className="text-a-brand-fg" />
            <h2 className="font-semibold text-a-text">Préparer le test</h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2 text-sm font-medium text-a-text-2">
              Événement
              <select value={event} onChange={e => setEvent(e.target.value as TestEvent)} className="mt-1.5 min-h-11 w-full rounded-xl border border-a-border-strong bg-a-surface px-3 text-sm">
                {EVENTS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <span className="mt-1 block text-xs font-normal text-a-text-3">{eventDescription}</span>
            </label>

            <label className="text-sm font-medium text-a-text-2">
              {isTesterFeedbackInvite ? 'Destinataire testeur de test' : isTenantAlert ? 'Destinataire tenant de test' : 'Destinataire de test'}
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-a-border-strong px-3" />
            </label>

            {!isTesterFeedbackInvite && (
              <label className="text-sm font-medium text-a-text-2">
                Nom client
                <input value={fullName} onChange={e => setFullName(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-a-border-strong px-3" />
              </label>
            )}

            {isTesterFeedbackInvite && (
              <label className="sm:col-span-2 text-sm font-medium text-a-text-2">
                URL du test fermé Google Play
                <input type="url" value={googlePlayTestUrl} onChange={e => setGooglePlayTestUrl(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-a-border-strong px-3" />
              </label>
            )}

            {isReviewInvite && (
              <label className="sm:col-span-2 text-sm font-medium text-a-text-2">
                Type d’invitation
                <select value={reviewInviteKind} onChange={e => setReviewInviteKind(e.target.value as ReviewInviteKind)} className="mt-1.5 min-h-11 w-full rounded-xl border border-a-border-strong bg-a-surface px-3">
                  <option value="initial">Invitation initiale</option>
                  <option value="reminder">Rappel</option>
                </select>
              </label>
            )}

            {needsFulfillment && (
              <label className="text-sm font-medium text-a-text-2">
                Remise
                <select value={fulfillmentType} onChange={e => setFulfillmentType(e.target.value as FulfillmentType)} className="mt-1.5 min-h-11 w-full rounded-xl border border-a-border-strong bg-a-surface px-3">
                  <option value="delivery">Livraison</option>
                  <option value="pickup">Click & Collect</option>
                </select>
              </label>
            )}

            {(isConfirmed || isPaymentReminder || isShopExternalPaymentTenantAlert || isEventTest || event === 'order-stock-conflict') && (
              <label className="text-sm font-medium text-a-text-2">
                Total
                <input inputMode="decimal" value={total} onChange={e => setTotal(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-a-border-strong px-3" />
              </label>
            )}

            {isConfirmed && fulfillmentType === 'delivery' && (
              <>
                <label className="text-sm font-medium text-a-text-2">
                  Frais de livraison
                  <input inputMode="decimal" value={shippingTotal} onChange={e => setShippingTotal(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-a-border-strong px-3" />
                </label>
                <label className="sm:col-span-2 text-sm font-medium text-a-text-2">
                  Adresse
                  <input value={line1} onChange={e => setLine1(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-a-border-strong px-3" />
                </label>
                <label className="text-sm font-medium text-a-text-2">
                  Code postal
                  <input value={postalCode} onChange={e => setPostalCode(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-a-border-strong px-3" />
                </label>
                <label className="text-sm font-medium text-a-text-2">
                  Ville
                  <input value={city} onChange={e => setCity(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-a-border-strong px-3" />
                </label>
                <label className="text-sm font-medium text-a-text-2">
                  Pays
                  <input value={country} onChange={e => setCountry(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-a-border-strong px-3" />
                </label>
              </>
            )}

            {isShopExternalPaymentTenantAlert && fulfillmentType === 'delivery' && (
              <>
                <label className="sm:col-span-2 text-sm font-medium text-a-text-2">
                  Adresse client
                  <input value={line1} onChange={e => setLine1(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-a-border-strong px-3" />
                </label>
                <label className="text-sm font-medium text-a-text-2">
                  Code postal
                  <input value={postalCode} onChange={e => setPostalCode(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-a-border-strong px-3" />
                </label>
                <label className="text-sm font-medium text-a-text-2">
                  Ville
                  <input value={city} onChange={e => setCity(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-a-border-strong px-3" />
                </label>
              </>
            )}

            {isShipped && (
              <>
                <label className="text-sm font-medium text-a-text-2">
                  Transporteur
                  <input value={trackingCarrier} onChange={e => setTrackingCarrier(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-a-border-strong px-3" />
                </label>
                <label className="text-sm font-medium text-a-text-2">
                  Tracking
                  <input value={trackingCode} onChange={e => setTrackingCode(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-a-border-strong px-3" />
                </label>
                <label className="text-sm font-medium text-a-text-2">
                  Livraison estimée
                  <input type="date" value={estimatedDeliveryDate} onChange={e => setEstimatedDeliveryDate(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-a-border-strong px-3" />
                  <span className="mt-1 block text-xs font-normal text-a-text-3">Laisser vide pour tester l’e-mail sans date estimée.</span>
                </label>
              </>
            )}

            {isPaymentReminder && (
              <div className="sm:col-span-2 rounded-xl border border-tone-warning-border bg-tone-warning-bg p-3 text-xs leading-5 text-tone-warning-fg">
                Le test simule un paiement PayPal déjà transmis au prestataire. Le vrai lien de reprise n’est pas utilisé : le payload reçoit un token factice de test.
              </div>
            )}

            {isShopExternalPaymentTenantAlert && (
              <div className="sm:col-span-2 rounded-xl border border-tone-info-border bg-tone-info-bg p-3 text-xs leading-5 text-tone-info-fg">
                Ce test simule l’alerte interne envoyée au tenant. L’adresse de test remplace temporairement la liste réelle <code>tenant_notification_recipients</code> et aucune checkout session n’est créée.
              </div>
            )}

            {isEventExternalPaymentTenantAlert && (
              <div className="sm:col-span-2 rounded-xl border border-tone-info-border bg-tone-info-bg p-3 text-xs leading-5 text-tone-info-fg">
                Ce test envoie uniquement le webhook Événementiel. Aucune demande de paiement, réservation ou capacité événement n’est créée ou modifiée.
              </div>
            )}

            {isEventReservationConfirmed && (
              <div className="sm:col-span-2 rounded-xl border border-tone-success-border bg-tone-success-bg p-3 text-xs leading-5 text-tone-success-fg">
                Le payload reprend le contrat réel de confirmation Événementiel avec billet factice. Aucune réservation n’est enregistrée et aucune capacité n’est consommée.
              </div>
            )}

            {isReviewInvite && (
              <div className="sm:col-span-2 rounded-xl border border-a-border bg-a-brand-soft p-3 text-xs leading-5 text-a-brand-fg">
                L’email est rendu avec le template réel de l’invitation (envoi via <code>send-email</code>), avec commande et token entièrement synthétiques. Aucun <code>review_invite</code>, token ou avis n’est créé ou modifié.
              </div>
            )}

            {isTesterFeedbackInvite && (
              <div className="sm:col-span-2 rounded-xl border border-a-border bg-a-brand-soft p-3 text-xs leading-5 text-a-brand-fg">
                L’e-mail réutilise le template réel avec une campagne et un lien feedback non autorisant entièrement synthétiques. Aucun invite, token, feedback ou état de campagne n’est créé ou modifié.
              </div>
            )}
          </div>

          <div className="mt-6 rounded-xl border border-tone-warning-border bg-tone-warning-bg p-3 text-xs leading-5 text-tone-warning-fg">
            Le payload est marqué <strong>testMode=true</strong>. Le webhook, le branding et les coordonnées du tenant sont résolus côté serveur et ne peuvent pas être remplacés depuis ce formulaire.
          </div>

          <button type="button" onClick={sendTest} disabled={sending || !email.trim() || (isTesterFeedbackInvite && !googlePlayTestUrl.trim())} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-a-brand px-5 text-sm font-semibold text-a-on-brand transition-opacity disabled:cursor-not-allowed disabled:opacity-50">
            <IconSend size={18} /> {sending ? 'Envoi…' : 'Envoyer le test'}
          </button>
        </section>

        <section className="rounded-2xl border border-a-border bg-a-surface p-5 shadow-sm">
          <h2 className="font-semibold text-a-text">Résultat</h2>
          {!result ? (
            <p className="mt-3 text-sm text-a-text-3">Le statut n8n et le payload réellement envoyé apparaîtront ici.</p>
          ) : (
            <div className="mt-4 space-y-4">
              <div className={`rounded-xl border p-3 text-sm ${result.ok ? 'border-tone-success-border bg-tone-success-bg text-tone-success-fg' : 'border-tone-danger-border bg-tone-danger-bg text-tone-danger-fg'}`}>
                <div className="font-semibold">{result.ok ? 'Test transmis à n8n' : 'Échec du test'}</div>
                {result.status && <div>HTTP {result.status}</div>}
                {result.webhookPath && <div className="break-all">{result.webhookPath}</div>}
                {result.error && <div>{result.error}</div>}
              </div>

              {result.payload && (
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-a-text-3">Payload envoyé</div>
                  <pre className="max-h-[560px] overflow-auto rounded-xl bg-a-inverse p-3 text-xs leading-5 text-a-text-3">{JSON.stringify(result.payload, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
