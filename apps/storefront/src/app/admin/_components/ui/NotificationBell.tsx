'use client';

import { useEffect, useState } from 'react';
import { IconBell, IconBellRinging, IconBellOff } from '@tabler/icons-react';

/**
 * Bouton pour activer les notifications système (Notification API) quand
 * l'onglet admin est en arrière-plan. Ne gère aucune logique de polling —
 * l'événement "nouvelle commande" est déclenché ailleurs (AdminOrdersPoller
 * + OrdersTable) ; ce composant se limite à demander/afficher la permission.
 */
export default function NotificationBell() {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported');
      return;
    }
    setPermission(Notification.permission);
  }, []);

  if (permission === 'unsupported') return null;

  async function handleClick() {
    if (permission !== 'default') return;
    const result = await Notification.requestPermission();
    setPermission(result);
  }

  const title =
    permission === 'granted'
      ? 'Notifications activées'
      : permission === 'denied'
      ? 'Notifications bloquées (autorisez-les dans les réglages du navigateur)'
      : 'Activer les notifications de nouvelle commande';

  const Icon =
    permission === 'granted' ? IconBellRinging
    : permission === 'denied' ? IconBellOff
    : IconBell;

  return (
    <button
      onClick={handleClick}
      disabled={permission !== 'default'}
      title={title}
      aria-label={title}
      className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800
                 disabled:cursor-default transition-colors"
    >
      <Icon size={18} />
    </button>
  );
}
