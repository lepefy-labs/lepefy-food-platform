'use client';

import { useState } from 'react';
import type { ShippingProvider } from '@lepefy/types';
import { PacklinkDiagnostic, type DiagnosticRequest } from './PacklinkDiagnostic';
import { PacklinkShipmentList } from './PacklinkShipmentList';

export function PacklinkWorkspace({ shippingProvider }: { shippingProvider: ShippingProvider }) {
  const [request, setRequest] = useState<DiagnosticRequest | null>(null);

  return (
    <div className="space-y-8">
      {shippingProvider === 'packlink' && (
        <PacklinkShipmentList
          onInspect={(reference) => setRequest({ reference, nonce: Date.now() })}
        />
      )}

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Diagnostic par référence</h2>
        <PacklinkDiagnostic shippingProvider={shippingProvider} request={request} />
      </div>
    </div>
  );
}
