'use client';

import { usePathname } from 'next/navigation';
import { ChatWidget } from './ChatWidget';

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
  const hidden = pathname.startsWith('/o/') || pathname === '/avis/donner' || pathname === '/cart' || pathname.startsWith('/checkout') || pathname.startsWith('/order-confirmation');

  const raiseForProductPurchaseBar = pathname.startsWith('/products/');

  if (hidden) return null;
  return <ChatWidget {...props} raiseForProductPurchaseBar={raiseForProductPurchaseBar} />;
}
