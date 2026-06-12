'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconTruckDelivery } from '@tabler/icons-react';

export default function OrdersPage() {
  const router = useRouter();
  const [orderId, setOrderId] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  function handleSubmit() {
    if (!orderId.trim() || !email.trim()) {
      setError('Veuillez remplir tous les champs.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Adresse email invalide.');
      return;
    }
    setError('');
    router.push(`/orders/${orderId.trim()}?email=${encodeURIComponent(email.trim())}`);
  }

  return (
    <div className="max-w-sm mx-auto px-4 pt-10 pb-4 flex flex-col items-center gap-6">
      <IconTruckDelivery size={56} stroke={1.2} color="#1D9E75" />
      <div className="text-center">
        <h1 className="text-xl font-bold text-gray-900">Suivez votre commande</h1>
        <p className="text-sm text-gray-400 mt-2">
          Entrez votre numéro de commande et votre email pour voir le statut
        </p>
      </div>
      <div className="w-full flex flex-col gap-4">
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">
            Numéro de commande
          </label>
          <input
            type="text"
            placeholder="ex: A1B2C3D4"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1D9E75]/30"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">
            Email utilisé lors de la commande
          </label>
          <input
            type="email"
            placeholder="votre@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1D9E75]/30"
          />
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <button
          onClick={handleSubmit}
          className="w-full bg-[#1D9E75] text-white font-medium py-3 rounded-xl text-sm hover:bg-[#0F6E56] transition-colors"
        >
          Voir ma commande
        </button>
      </div>
    </div>
  );
}
