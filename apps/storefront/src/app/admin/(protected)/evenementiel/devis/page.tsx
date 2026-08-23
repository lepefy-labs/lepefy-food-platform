import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import InquiriesClient from './InquiriesClient';
import type { InquiryWithService } from './inquiryTypes';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function AdminInquiriesPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();
  const { data: inquiries } = await supabase
    .from('service_inquiries')
    .select('*, service_offerings(title, slug)')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false });

  return (
    <div className="mx-auto w-full max-w-[1500px]">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">Demandes</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Suivez les demandes événementielles et concentrez-vous sur celles qui nécessitent une action.
        </p>
      </header>

      <InquiriesClient initialInquiries={(inquiries ?? []) as unknown as InquiryWithService[]} />
    </div>
  );
}
