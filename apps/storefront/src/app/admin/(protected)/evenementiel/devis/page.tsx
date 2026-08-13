import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import InquiriesClient from './InquiriesClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface InquiryWithService {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  date_souhaitee: string | null;
  nombre_invites: number | null;
  message: string | null;
  status: 'nouveau' | 'contacte' | 'clos';
  created_at: string;
  service_offerings: { title: string; slug: string } | null;
}

export default async function AdminInquiriesPage() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();
  const { data: inquiries } = await supabase
    .from('service_inquiries')
    .select('*, service_offerings(title, slug)')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false });

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Demandes de devis</h1>
      <p className="text-sm text-gray-500 mb-6">
        Demandes envoyées depuis les pages de service en mode « devis » (ex. Traiteur).
      </p>

      <InquiriesClient initialInquiries={(inquiries ?? []) as InquiryWithService[]} />
    </div>
  );
}
