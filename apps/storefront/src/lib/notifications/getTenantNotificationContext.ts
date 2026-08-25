import { createServiceClient } from '@/lib/supabase/server';

export interface TenantNotificationContext {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  storefrontUrl: string;
  locale: string;
  currency: string;
  branding: {
    logoUrl: string | null;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
  };
  emailBranding: {
    fromName: string;
    fromEmail: string;
    supportEmail: string | null;
    whatsappNumber: string | null;
  };
  business: {
    city: string | null;
    country: string;
    legalAddress: string | null;
  };
  pickup: {
    address: string | null;
    mapsUrl: string | null;
    hours: string | null;
  };
}

interface TenantNotificationRow {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  accent_light: string;
  city: string | null;
  country: string;
  currency: string;
  locale: string;
  storefront_url: string | null;
  legal_email: string | null;
  legal_website: string | null;
  legal_address: string | null;
  whatsapp_number: string | null;
  click_collect_address: string | null;
  google_maps_url: string | null;
  click_collect_hours: string | null;
  click_collect_hours_it: string | null;
}

export async function getTenantNotificationContext(
  tenantId: string,
): Promise<TenantNotificationContext | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('tenants')
      .select(
        'id, slug, name, logo_url, primary_color, secondary_color, accent_light, city, country, currency, locale, storefront_url, legal_email, legal_website, legal_address, whatsapp_number, click_collect_address, google_maps_url, click_collect_hours, click_collect_hours_it',
      )
      .eq('id', tenantId)
      .eq('active', true)
      .maybeSingle();

    if (error || !data) {
      console.error('[notifications] unable to resolve tenant context:', error, '— tenant_id:', tenantId);
      return null;
    }

    const tenant = data as TenantNotificationRow;
    // Tenant data is canonical; deployment-global values are retained only for legacy compatibility.
    const tenantStorefront = tenant.storefront_url?.replace(/\/$/, '') ?? null;
    const legalWebsite = tenant.legal_website?.replace(/\/$/, '') ?? null;
    const legacyConfiguredStorefront = process.env.NEXT_PUBLIC_STOREFRONT_URL?.replace(/\/$/, '') ?? null;
    const pickupHours = tenant.locale.toLowerCase().startsWith('it')
      ? tenant.click_collect_hours_it ?? tenant.click_collect_hours
      : tenant.click_collect_hours ?? tenant.click_collect_hours_it;

    return {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      storefrontUrl: tenantStorefront || legalWebsite || legacyConfiguredStorefront || '',
      locale: tenant.locale,
      currency: tenant.currency,
      branding: {
        logoUrl: tenant.logo_url,
        primaryColor: tenant.primary_color,
        secondaryColor: tenant.secondary_color,
        accentColor: tenant.accent_light,
      },
      emailBranding: {
        fromName: tenant.name,
        fromEmail: process.env.ORDER_NOTIFICATION_FROM_EMAIL ?? 'noreply@lepefy.com',
        supportEmail: tenant.legal_email,
        whatsappNumber: tenant.whatsapp_number,
      },
      business: {
        city: tenant.city,
        country: tenant.country,
        legalAddress: tenant.legal_address,
      },
      pickup: {
        address: tenant.click_collect_address,
        mapsUrl: tenant.google_maps_url,
        hours: pickupHours,
      },
    };
  } catch (error) {
    console.error('[notifications] tenant context lookup failed:', error, '— tenant_id:', tenantId);
    return null;
  }
}
