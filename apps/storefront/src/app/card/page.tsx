import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantSocialLinks } from '@/lib/tenant/getTenantSocialLinks';
import { DigitalCard } from '@/components/card/DigitalCard';

export const dynamic = 'force-dynamic';

export default async function CardPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const socialLinks = await getTenantSocialLinks(tenant.id);

  return (
    <DigitalCard
      tenant={{
        name: tenant.name,
        tagline: tenant.tagline,
        logo_url: tenant.logo_url,
        primary_color: tenant.primary_color,
        secondary_color: tenant.secondary_color,
        accent_light: tenant.accent_light,
        click_collect_address: tenant.click_collect_address,
        click_collect_hours: tenant.click_collect_hours,
        whatsapp_number: tenant.whatsapp_number,
      }}
      socialLinks={socialLinks}
    />
  );
}
