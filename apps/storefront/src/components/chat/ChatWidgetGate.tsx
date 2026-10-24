'use client';

import { usePathname } from 'next/navigation';
import { ChatWidget } from './ChatWidget';
import { isOrderTrackingPath } from '@/lib/storefront/shopChrome';

interface ChatWidgetGateProps {
  enabled: boolean;
  tenantName: string;
  tenantLocales: string[];
  tenantLocale: string;
  whatsappNumber: string | null;
}

export function ChatWidgetGate(props: ChatWidgetGateProps) {
  const pathname = usePathname();
  // /o/[token] : le jeton du portail ne doit jamais partir dans les analytics Nala (sourcePath).
  const hidden = pathname.startsWith('/o/') || pathname === '/avis/donner' || pathname.startsWith('/checkout') || pathname.startsWith('/order-confirmation')
    // Suivi de commande : l'aide est en bas de page, aucun bouton flottant sur le statut ou le suivi.
    || isOrderTrackingPath(pathname);

  const raiseForProductPurchaseBar = pathname.startsWith('/products/') || pathname === '/cart';

  if (hidden) return null;
  return <ChatWidget {...props} raiseForProductPurchaseBar={raiseForProductPurchaseBar} inlineOnly={pathname === '/cart'} proactiveOffer={pathname.startsWith('/products/')} />;
}
