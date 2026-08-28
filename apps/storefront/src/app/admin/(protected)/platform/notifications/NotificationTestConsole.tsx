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
  | 'event-reservation-confirmed';

type FulfillmentType = 'delivery' | 'pickup';

const EVENTS: { value: TestEvent; label: string; description: string }[] = [
  { value: 'order-confirmed', label: 'Commande confirmée', description: 'Confirmation après paiement.' },
  { value: 'order-shipped', label: 'Commande expédiée', description: 'Email avec suivi transporteur.' },
  { value: 'order-ready-for-pickup', label: 'Prête au retrait', description: 'Click & Collect prêt.' },
  { value: 'order-completed', label: 'Commande terminée', description: 'Livrée ou retirée.' },
  { value: 'order-cancelled', label: 'Commande annulée', description: 'Annulation sans promesse de remboursement.' },
  { value: 'payment-reminder', label: 'Rappel paiement', description: 'Rappel prudent pour un paiement externe non encore confirmé.' },
  { value: 'external-payment-awaiting-verification', label: 'Paiement externe à vérifier', description: 'Alerte interne au tenant pour vérification et confirmation.' },
  { value: 'order-stock-conflict', label: 'Conflit de stock', description: 'Notification opérationnelle de test.' },
  { value: 'event-external-payment-awaiting-verification', label: 'Événement · Paiement externe à vérifier', description: 'Alerte tenant Événementiel avec contexte réel et payload synthétique.' },
  { value: 'event-reservation-confirmed', label: 'Événement · Réservation confirmée', description: 'Confirmation client Événementiel sans créer de réservation.' },
];

interface Props {
  defaultEmail: string;
  tenantName: string;
  tenantSlug: string;
}

interface TestResult {
  ok?: boolean;
  status?: number;
  webhookPath?: string;
  response?: string | null;
  payload?: Record<string, unknown>;
  error?: string;
}

export default function NotificationTestConsole({ defaultEmail, tenantName, tenantSlug }: Props) {
  const [event, setEvent] = useState<TestEvent>('order-confirmed');
  const [email, setEmail] = useState(defaultEmail);
  const [fullName, setFullName] = useState('Robertin');
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>('delivery');
  const [total, setTotal] = useState('79.90');
  const [shippingTotal, setShippingTotal] = useState('8.90');
  const [trackingCode, setTrackingCode] = useState('TEST-TRACKING-001');
  const [trackingCarrier, setTrackingCarrier] = useState('Transporteur test');
  const [line1, setLine1] = useState('Adresse de test');
  const [postalCode, setPostalCode] = useState('00000');
  const [city, setCity] = useState('Reggio Emilia');
  const [country, setCountry] = useState('IT');
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
          total: Number(total),
          shippingTotal: Number(shippingTotal),
          trackingCode,
          trackingCarrier,
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
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-violet-700 dark:text-violet-300">
            <IconShieldLock size={16} /> Platform owner
          </div>
          <h1 className="text-2xl font-bold text-gray-950 dark:text-white">Console de test des notifications</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-400">
            Envoie un payload de test au vrai workflow n8n sans créer de commande, réservation, modifier le stock, la capacité, la fidélité ou un paiement.
          </p>
        </div>
        <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900 dark:border-violet-900/50 dark:bg-violet-950/30 dark:text-violet-200">
          <div className="font-semibold">Tenant courant</div>
          <div>{tenantName} <span className="text-violet-600 dark:text-violet-400">({tenantSlug})</span></div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]">
        <section className="rounded-2xl border border-[var(--admin-border)] bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-5 flex items-center gap-2">
            <IconBell size={20} className="text-violet-600" />
            <h2 className="font-semibold text-gray-950 dark:text-white">Préparer le test</h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              Événement
              <select value={event} onChange={e => setEvent(e.target.value as TestEvent)} className="mt-1.5 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-950">
                {EVENTS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <span className="mt-1 block text-xs font-normal text-gray-500">{eventDescription}</span>
            </label>

            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {isTenantAlert ? 'Destinataire tenant de test' : 'Destinataire de test'}
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-gray-300 px-3 dark:border-gray-700 dark:bg-gray-950" />
            </label>

            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Nom client
              <input value={fullName} onChange={e => setFullName(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-gray-300 px-3 dark:border-gray-700 dark:bg-gray-950" />
            </label>

            {needsFulfillment && (
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Remise
                <select value={fulfillmentType} onChange={e => setFulfillmentType(e.target.value as FulfillmentType)} className="mt-1.5 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 dark:border-gray-700 dark:bg-gray-950">
                  <option value="delivery">Livraison</option>
                  <option value="pickup">Click & Collect</option>
                </select>
              </label>
            )}

            {(isConfirmed || isPaymentReminder || isShopExternalPaymentTenantAlert || isEventTest || event === 'order-stock-conflict') && (
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Total
                <input inputMode="decimal" value={total} onChange={e => setTotal(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-gray-300 px-3 dark:border-gray-700 dark:bg-gray-950" />
              </label>
            )}

            {isConfirmed && fulfillmentType === 'delivery' && (
              <>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Frais de livraison
                  <input inputMode="decimal" value={shippingTotal} onChange={e => setShippingTotal(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-gray-300 px-3 dark:border-gray-700 dark:bg-gray-950" />
                </label>
                <label className="sm:col-span-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  Adresse
                  <input value={line1} onChange={e => setLine1(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-gray-300 px-3 dark:border-gray-700 dark:bg-gray-950" />
                </label>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Code postal
                  <input value={postalCode} onChange={e => setPostalCode(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-gray-300 px-3 dark:border-gray-700 dark:bg-gray-950" />
                </label>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Ville
                  <input value={city} onChange={e => setCity(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-gray-300 px-3 dark:border-gray-700 dark:bg-gray-950" />
                </label>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Pays
                  <input value={country} onChange={e => setCountry(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-gray-300 px-3 dark:border-gray-700 dark:bg-gray-950" />
                </label>
              </>
            )}

            {isShopExternalPaymentTenantAlert && fulfillmentType === 'delivery' && (
              <>
                <label className="sm:col-span-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  Adresse client
                  <input value={line1} onChange={e => setLine1(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-gray-300 px-3 dark:border-gray-700 dark:bg-gray-950" />
                </label>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Code postal
                  <input value={postalCode} onChange={e => setPostalCode(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-gray-300 px-3 dark:border-gray-700 dark:bg-gray-950" />
                </label>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Ville
                  <input value={city} onChange={e => setCity(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-gray-300 px-3 dark:border-gray-700 dark:bg-gray-950" />
                </label>
              </>
            )}

            {isShipped && (
              <>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Transporteur
                  <input value={trackingCarrier} onChange={e => setTrackingCarrier(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-gray-300 px-3 dark:border-gray-700 dark:bg-gray-950" />
                </label>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Tracking
                  <input value={trackingCode} onChange={e => setTrackingCode(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-gray-300 px-3 dark:border-gray-700 dark:bg-gray-950" />
                </label>
              </>
            )}

            {isPaymentReminder && (
              <div className="sm:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                Le test simule un paiement PayPal déjà transmis au prestataire. Le vrai lien de reprise n’est pas utilisé : le payload reçoit un token factice de test.
              </div>
            )}

            {isShopExternalPaymentTenantAlert && (
              <div className="sm:col-span-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-200">
                Ce test simule l’alerte interne envoyée au tenant. L’adresse de test remplace temporairement la liste réelle <code>tenant_notification_recipients</code> et aucune checkout session n’est créée.
              </div>
            )}

            {isEventExternalPaymentTenantAlert && (
              <div className="sm:col-span-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-200">
                Ce test envoie uniquement le webhook Événementiel. Aucune demande de paiement, réservation ou capacité événement n’est créée ou modifiée.
              </div>
            )}

            {isEventReservationConfirmed && (
              <div className="sm:col-span-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
                Le payload reprend le contrat réel de confirmation Événementiel avec billet factice. Aucune réservation n’est enregistrée et aucune capacité n’est consommée.
              </div>
            )}
          </div>

          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            Le payload est marqué <strong>testMode=true</strong>. Le webhook, le branding et les coordonnées du tenant sont résolus côté serveur et ne peuvent pas être remplacés depuis ce formulaire.
          </div>

          <button type="button" onClick={sendTest} disabled={sending || !email.trim()} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--admin-primary)] px-5 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50">
            <IconSend size={18} /> {sending ? 'Envoi…' : 'Envoyer le test'}
          </button>
        </section>

        <section className="rounded-2xl border border-[var(--admin-border)] bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h2 className="font-semibold text-gray-950 dark:text-white">Résultat</h2>
          {!result ? (
            <p className="mt-3 text-sm text-gray-500">Le statut n8n et le payload réellement envoyé apparaîtront ici.</p>
          ) : (
            <div className="mt-4 space-y-4">
              <div className={`rounded-xl border p-3 text-sm ${result.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200' : 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200'}`}>
                <div className="font-semibold">{result.ok ? 'Test transmis à n8n' : 'Échec du test'}</div>
                {result.status && <div>HTTP {result.status}</div>}
                {result.webhookPath && <div className="break-all">{result.webhookPath}</div>}
                {result.error && <div>{result.error}</div>}
              </div>

              {result.payload && (
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Payload envoyé</div>
                  <pre className="max-h-[560px] overflow-auto rounded-xl bg-gray-950 p-3 text-xs leading-5 text-gray-100">{JSON.stringify(result.payload, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
