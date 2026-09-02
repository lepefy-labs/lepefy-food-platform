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
  const hidden = pathname === '/cart' || pathname.startsWith('/checkout') || pathname.startsWith('/order-confirmation');

  if (hidden) return null;
  return <ChatWidget {...props} />;
}
