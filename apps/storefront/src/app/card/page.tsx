import type { Metadata } from 'next';
import { Manrope, DM_Sans } from 'next/font/google';
import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantSocialLinks } from '@/lib/tenant/getTenantSocialLinks';
import { getTenantPaymentMethods } from '@/lib/tenant/getTenantPaymentMethods';
import { DigitalCard } from '@/components/card/DigitalCard';

const manrope = Manrope({ subsets: ['latin'], weight: ['700', '800'], variable: '--font-card-heading', display: 'swap' });
const dmSans  = DM_Sans({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-card-body', display: 'swap' });

export const revalidate = 300;

export const metadata: Metadata = {
  manifest: '/api/card/manifest',
};

export default async function CardPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const [socialLinks, allPaymentMethods] = await Promise.all([
    getTenantSocialLinks(tenant.id),
    getTenantPaymentMethods(tenant.id),
  ]);
  const paymentMethods = allPaymentMethods.filter((m) => m.enabled_modules.includes('card'));

  return (
    <div className={`${manrope.variable} ${dmSans.variable}`}>
      <DigitalCard
        tenant={{
          name: tenant.name,
          tagline: tenant.tagline,
          logo_url: tenant.logo_url,
          primary_color: tenant.primary_color,
          secondary_color: tenant.secondary_color,
          accent_light: tenant.accent_light,
          click_collect_address: tenant.click_collect_address,
          google_maps_url: tenant.google_maps_url,
          click_collect_hours: tenant.click_collect_hours,
          click_collect_hours_it: tenant.click_collect_hours_it,
          whatsapp_number: tenant.whatsapp_number,
          storefront_ready: tenant.storefront_ready,
          currency: tenant.currency,
        }}
        socialLinks={socialLinks}
        paymentMethods={paymentMethods}
      />
    </div>
  );
}
