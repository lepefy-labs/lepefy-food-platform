import { IconClockPause } from '@tabler/icons-react';

/**
 * Public page shown instead of a suspended module (shop, events, digital card,
 * pay link). Deliberately says nothing about billing: customers only learn the
 * service is temporarily unavailable.
 */
export function ServiceSuspendedPage({ tenantName, logoUrl }: { tenantName: string; logoUrl?: string | null }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-16">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={tenantName} className="mx-auto mb-5 h-14 w-auto object-contain" />
        ) : (
          <p className="mb-5 text-lg font-bold text-gray-900">{tenantName}</p>
        )}
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-500">
          <IconClockPause size={24} stroke={1.6} aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold text-gray-900">Service temporairement indisponible</h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          Ce service de {tenantName} est momentanément indisponible. Merci de réessayer un peu plus tard.
        </p>
      </div>
    </main>
  );
}
