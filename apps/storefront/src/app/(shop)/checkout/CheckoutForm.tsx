'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { useCartStore } from '@/stores/cartStore';
import { formatPrice } from '@/lib/utils/format';
import type { Tenant } from '@lepefy/types';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

const formSchema = z.object({
  firstName:   z.string().min(1, 'Prénom requis'),
  lastName:    z.string().min(1, 'Nom requis'),
  email:       z.string().email('Email invalide'),
  phone:       z.string().optional(),
  line1:       z.string().optional(),
  city:        z.string().optional(),
  postal_code: z.string().optional(),
  country:     z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface CheckoutShipping {
  shippingTotal:   number;
  shippingDetails: Record<string, unknown> | null;
  fulfillmentType: 'delivery' | 'pickup';
  country:         string | null;
  postalCode:      string | null;
}

function PaymentStep({
  clientSecret,
  total,
  tenant,
  onError,
}: {
  clientSecret: string;
  total:        number;
  tenant:       Tenant;
  onError:      (msg: string) => void;
}) {
  const stripe   = useStripe();
  const elements = useElements();
  const router   = useRouter();
  const { clearCart } = useCartStore();
  const [isConfirming, setIsConfirming] = useState(false);

  const handleConfirm = async () => {
    if (!stripe || !elements) return;
    setIsConfirming(true);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/order-confirmation`,
      },
      redirect: 'if_required',
    });

    if (error) {
      onError(error.message ?? 'Erreur lors du paiement.');
      setIsConfirming(false);
    } else {
      clearCart();
      const intentId = paymentIntent?.id ?? '';
      router.push(`/order-confirmation?payment_intent=${intentId}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
        <p className="text-sm font-semibold text-gray-700 mb-4">Paiement sécurisé</p>
        <PaymentElement />
      </div>
      <button
        onClick={handleConfirm}
        disabled={isConfirming || !stripe || !elements}
        className="w-full py-4 rounded-2xl font-bold text-white text-base disabled:opacity-50 transition-opacity"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        {isConfirming ? 'Traitement en cours…' : `Payer ${formatPrice(total, tenant.currency)}`}
      </button>
    </div>
  );
}

export default function CheckoutForm({ tenant }: { tenant: Tenant }) {
  const { items, totalPrice } = useCartStore();
  const router = useRouter();

  const [shippingInfo, setShippingInfo]   = useState<CheckoutShipping | null>(null);
  const [step, setStep]                   = useState<'form' | 'payment'>('form');
  const [clientSecret, setClientSecret]   = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting]   = useState(false);
  const [submitError, setSubmitError]     = useState<string | null>(null);

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
  });

  useEffect(() => {
    const stored = sessionStorage.getItem('lepefy-checkout-shipping');
    if (stored) {
      try {
        const info: CheckoutShipping = JSON.parse(stored);
        setShippingInfo(info);
        if (info.country)    setValue('country',     info.country);
        if (info.postalCode) setValue('postal_code', info.postalCode);
      } catch {
        router.push('/cart');
      }
    } else {
      router.push('/cart');
    }
    if (items.length === 0) router.push('/cart');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const subtotal       = totalPrice();
  const shippingTotal  = shippingInfo?.fulfillmentType === 'pickup' ? 0 : (shippingInfo?.shippingTotal ?? 0);
  const total          = subtotal + shippingTotal;
  const fulfillmentType = shippingInfo?.fulfillmentType ?? 'delivery';

  const onSubmit = async (data: FormValues) => {
    if (fulfillmentType === 'delivery' && (!data.line1 || !data.city || !data.postal_code)) {
      setSubmitError('Veuillez compléter votre adresse de livraison.');
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((i) => ({
            productId: i.product.id,
            name:      i.product.name,
            price:     i.product.price,
            quantity:  i.quantity,
          })),
          shippingAddress:
            fulfillmentType === 'delivery'
              ? {
                  full_name:   `${data.firstName} ${data.lastName}`,
                  line1:       data.line1,
                  city:        data.city,
                  postal_code: data.postal_code,
                  country:     data.country ?? shippingInfo?.country ?? 'IT',
                }
              : null,
          fulfillmentType,
          email:           data.email,
          phone:           data.phone ?? null,
          fullName:        `${data.firstName} ${data.lastName}`,
          shippingTotal,
          shippingDetails: shippingInfo?.shippingDetails ?? null,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        setSubmitError(result.error ?? 'Une erreur est survenue.');
        return;
      }
      setClientSecret(result.clientSecret);
      setStep('payment');
    } catch {
      setSubmitError('Une erreur est survenue. Veuillez réessayer.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!shippingInfo) return null;

  const inputClass =
    'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-8">
      <h1 className="text-2xl font-bold mb-6">Finaliser la commande</h1>

      {/* Order summary */}
      <div className="bg-gray-50 rounded-2xl p-4 mb-6">
        <p className="text-sm font-semibold text-gray-700 mb-3">Récapitulatif</p>
        <div className="space-y-1.5">
          {items.map((item) => (
            <div key={item.product.id} className="flex justify-between text-sm">
              <span className="text-gray-600 line-clamp-1 mr-2">
                {item.product.name} × {item.quantity}
              </span>
              <span className="font-medium flex-shrink-0">
                {formatPrice(item.product.price * item.quantity, tenant.currency)}
              </span>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-200 mt-3 pt-3 space-y-1.5">
          <div className="flex justify-between text-sm text-gray-500">
            <span>Sous-total</span>
            <span>{formatPrice(subtotal, tenant.currency)}</span>
          </div>
          <div className="flex justify-between text-sm text-gray-500">
            <span>Livraison</span>
            <span>
              {shippingTotal === 0 ? (
                <span className="text-green-600 font-medium">Gratuit</span>
              ) : (
                formatPrice(shippingTotal, tenant.currency)
              )}
            </span>
          </div>
          <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-2 mt-1">
            <span>Total</span>
            <span>{formatPrice(total, tenant.currency)}</span>
          </div>
        </div>
      </div>

      {/* Step 1: Contact + address form */}
      {step === 'form' && (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
          {/* Customer info */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-3">Vos informations</p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <input {...register('firstName')} placeholder="Prénom" className={inputClass} />
                  {errors.firstName && (
                    <p className="text-red-500 text-xs mt-1">{errors.firstName.message}</p>
                  )}
                </div>
                <div>
                  <input {...register('lastName')} placeholder="Nom" className={inputClass} />
                  {errors.lastName && (
                    <p className="text-red-500 text-xs mt-1">{errors.lastName.message}</p>
                  )}
                </div>
              </div>
              <div>
                <input
                  {...register('email')}
                  type="email"
                  inputMode="email"
                  placeholder="Email"
                  className={inputClass}
                />
                {errors.email && (
                  <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>
                )}
              </div>
              <input
                {...register('phone')}
                type="tel"
                inputMode="tel"
                placeholder="Téléphone (optionnel)"
                className={inputClass}
              />
            </div>
          </div>

          {/* Shipping address */}
          {fulfillmentType === 'delivery' && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-3">Adresse de livraison</p>
              <div className="space-y-3">
                <input {...register('line1')} placeholder="Adresse" className={inputClass} />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    {...register('postal_code')}
                    placeholder="Code postal"
                    inputMode="numeric"
                    className={inputClass}
                  />
                  <input {...register('city')} placeholder="Ville" className={inputClass} />
                </div>
                <input {...register('country')} placeholder="Pays" className={inputClass} />
              </div>
            </div>
          )}

          {/* Click & Collect address */}
          {fulfillmentType === 'pickup' && tenant.click_collect_address && (
            <div className="bg-blue-50 rounded-2xl p-4 text-sm">
              <p className="font-semibold text-blue-800 mb-1">📍 Adresse de retrait</p>
              <p className="text-blue-700">{tenant.click_collect_address}</p>
            </div>
          )}

          {submitError && (
            <p className="text-red-500 text-sm bg-red-50 rounded-xl px-4 py-3">{submitError}</p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 rounded-2xl font-bold text-white text-base disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {isSubmitting ? 'Traitement…' : 'Continuer vers le paiement'}
          </button>
        </form>
      )}

      {/* Step 2: Stripe Payment */}
      {step === 'payment' && clientSecret && (
        <div>
          {submitError && (
            <p className="text-red-500 text-sm bg-red-50 rounded-xl px-4 py-3 mb-4">
              {submitError}
            </p>
          )}
          <Elements stripe={stripePromise} options={{ clientSecret, locale: 'fr' }}>
            <PaymentStep
              clientSecret={clientSecret}
              total={total}
              tenant={tenant}
              onError={(msg) => setSubmitError(msg)}
            />
          </Elements>
        </div>
      )}
    </div>
  );
}
