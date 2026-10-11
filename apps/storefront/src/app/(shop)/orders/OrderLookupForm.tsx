'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TextField } from '@/components/ui/form';
import { FORM_COPY } from '@/lib/storefrontCopy/copy';

interface OrderLookupFormProps {
  /** `full` = page dédiée (icône + titre) ; `compact` = intégré dans OrdersLoginPrompt. */
  variant?: 'full' | 'compact';
}

export function OrderLookupForm({ variant = 'full' }: OrderLookupFormProps) {
  const router = useRouter();
  const [orderId, setOrderId] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<{ orderId?: string; email?: string }>({});

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const next: { orderId?: string; email?: string } = {};
    if (!orderId.trim()) next.orderId = 'Écrivez le numéro de commande. Il est dans l\'e-mail de confirmation.';
    if (!email.trim()) next.email = 'Écrivez votre e-mail.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = FORM_COPY.emailInvalid;
    setErrors(next);
    if (next.orderId || next.email) {
      document.getElementById(next.orderId ? 'order-lookup-id' : 'order-lookup-email')?.focus();
      return;
    }
    router.push(`/orders/${orderId.trim()}?email=${encodeURIComponent(email.trim())}`);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className={variant === 'full' ? 'w-full flex flex-col gap-5' : 'w-full flex flex-col gap-4'}>
      <TextField
        id="order-lookup-id"
        label="Numéro de commande"
        type="text"
        autoComplete="off"
        autoCapitalize="characters"
        placeholder="Ex. : A1B2C3D4"
        value={orderId}
        error={errors.orderId}
        onChange={(e) => setOrderId(e.target.value)}
      />
      <TextField
        id="order-lookup-email"
        label="E-mail utilisé pour la commande"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="Ex. : nom@gmail.com"
        value={email}
        error={errors.email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button
        type="submit"
        className="min-h-12 w-full rounded-xl text-base font-bold text-white transition-colors hover:brightness-95"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        Voir ma commande
      </button>
    </form>
  );
}
