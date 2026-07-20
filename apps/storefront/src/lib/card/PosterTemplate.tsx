import { PAYMENT_METHOD_REGISTRY, SOCIAL_PLATFORM_REGISTRY, type TenantPaymentMethod, type TenantSocialLink } from '@lepefy/types';
import {
  IconBuildingBank,
  IconCash,
  IconBrandPaypal,
  IconQrcode,
  IconWallet,
  IconBrandInstagram,
  IconBrandFacebook,
  IconBrandTiktok,
  IconBrandYoutube,
  IconBrandLinkedin,
  IconBrandX,
} from '@tabler/icons-react';

const ICONS = { IconBuildingBank, IconCash, IconBrandPaypal, IconQrcode, IconWallet };

const ICONS_SOCIAL = {
  IconBrandInstagram, IconBrandFacebook, IconBrandTiktok,
  IconBrandYoutube, IconBrandLinkedin, IconBrandX,
};

// Colori brand a livello di piattaforma (non tenant-specific): PayPal blu
// ufficiale, contanti verde, Satispay coral, virement/altro nel colore
// primario del tenant (nessun brand fisso a cui ancorarsi). Migliora il
// riconoscimento a colpo d'occhio rispetto a icone tutte in grigio.
function methodColor(method: TenantPaymentMethod['method'], tenantPrimary: string): string {
  switch (method) {
    case 'paypal':   return '#003087';
    case 'cash':     return '#2E7D32';
    case 'satispay': return '#FF3B30';
    default:         return tenantPrimary; // bank_transfer, other
  }
}

interface PosterTemplateProps {
  tenant: {
    name: string;
    logo_url: string | null;
    primary_color: string;
    click_collect_address: string | null;
    click_collect_hours: string | null;
  };
  paymentMethods: TenantPaymentMethod[];
  socialLinks: TenantSocialLink[];
  qrUrl: string;
}

export function PosterTemplate({ tenant, paymentMethods, socialLinks, qrUrl }: PosterTemplateProps) {
  return (
    <div className="poster">
      <div className="header" style={{ backgroundColor: tenant.primary_color }}>
        {tenant.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tenant.logo_url} alt="" className="logo" />
        )}
        <h1>{tenant.name}</h1>
      </div>

      <div className="body">
        <p className="headline">Scannez pour nous contacter &amp; payer</p>
        <p className="headline-it">Scansiona per contattarci e pagare</p>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrUrl} alt="QR code" className="qr" />

        {paymentMethods.length > 0 && (
          <div className="methods">
            {paymentMethods.map((pm) => {
              const meta = PAYMENT_METHOD_REGISTRY[pm.method];
              const Icon = ICONS[meta.iconName];
              return (
                <div className="method" key={pm.id}>
                  <Icon size={28} stroke={1.5} color={methodColor(pm.method, tenant.primary_color)} />
                  <span>{pm.label ?? meta.label}</span>
                </div>
              );
            })}
          </div>
        )}

        {socialLinks.length > 0 && (
          <div className="social-row">
            {socialLinks.map((link) => {
              const meta = SOCIAL_PLATFORM_REGISTRY[link.platform];
              const Icon = ICONS_SOCIAL[meta.iconName];
              return (
                <div className="social-badge" key={link.id} style={{ background: meta.badgeBackground }}>
                  <Icon size={16} stroke={1.5} color="#ffffff" />
                </div>
              );
            })}
          </div>
        )}

        {(tenant.click_collect_address || tenant.click_collect_hours) && (
          <div className="footer">
            {tenant.click_collect_address && <p>{tenant.click_collect_address}</p>}
            {tenant.click_collect_hours && <p>{tenant.click_collect_hours}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
