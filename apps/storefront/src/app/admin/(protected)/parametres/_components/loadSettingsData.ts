import 'server-only';
import type { Tenant, TenantNotificationRecipient, TenantSocialLink } from '@lepefy/types';
import { createServiceClient } from '@/lib/supabase/server';
import { dailyDigestModule, DAILY_DIGEST_FEATURE_KEY } from '@/lib/notifications/dailyDigestConfig';
import type { DailyDigestSettingsInitial } from '../DailyDigestSettingsSection';
import { isModuleRegistered, readModuleConfig } from '@/lib/tenantConfig/moduleConfig';
import type { SettingsStatusMap } from './settingsRegistry';
import { loadIntegrationStatuses } from './integrationsStatus';

type Db = ReturnType<typeof createServiceClient>;

// Fails closed: before migration 129 (or on read error) the automation is read-only.
export async function loadDailyDigestSettings(db: Db, tenantId: string): Promise<{ available: boolean; initial: DailyDigestSettingsInitial | null }> {
  try {
    if (!(await isModuleRegistered(db, DAILY_DIGEST_FEATURE_KEY))) return { available: false, initial: null };
    const state = await readModuleConfig(db, dailyDigestModule, tenantId);
    return { available: true, initial: { status: state.status, enabled: state.enabled, config: state.config } };
  } catch (error) {
    console.error('[parametres] daily digest settings unavailable', error);
    return { available: false, initial: null };
  }
}

export async function loadSocialLinks(db: Db, tenantId: string): Promise<TenantSocialLink[]> {
  const { data } = await db.from('tenant_social_links').select('*').eq('tenant_id', tenantId).order('sort_order', { ascending: true });
  return (data ?? []) as TenantSocialLink[];
}

export async function loadNotificationRecipients(db: Db, tenantId: string): Promise<TenantNotificationRecipient[]> {
  const { data } = await db.from('tenant_notification_recipients').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: true });
  return (data ?? []) as TenantNotificationRecipient[];
}

const plural = (count: number, singular: string, pluralForm: string) => `${count} ${count > 1 ? pluralForm : singular}`;

/** Card statuses of the Settings Hub, derived from real tenant data only. */
export async function loadSettingsStatuses(tenant: Tenant): Promise<SettingsStatusMap> {
  const db = createServiceClient();
  const [socialLinks, recipients, payments, digest] = await Promise.all([
    loadSocialLinks(db, tenant.id),
    loadNotificationRecipients(db, tenant.id),
    db.from('tenant_payment_methods').select('active').eq('tenant_id', tenant.id),
    loadDailyDigestSettings(db, tenant.id),
  ]);

  const profileComplete = Boolean(tenant.storefront_url && tenant.whatsapp_number);
  const pickupConfigured = Boolean(tenant.click_collect_address);
  const activeSocial = socialLinks.filter((link) => link.active).length;
  const activeRecipients = recipients.filter((recipient) => recipient.active).length;
  const paymentRows = (payments.data ?? []) as Array<{ active: boolean }>;
  const activePayments = paymentRows.filter((row) => row.active).length;
  const integrations = loadIntegrationStatuses(tenant).filter((item) => item.state === 'connected' || item.state === 'configured').length;
  const legalComplete = Boolean(tenant.legal_name && tenant.legal_address && tenant.legal_email);

  const presenceParts = [activeSocial > 0 ? plural(activeSocial, 'réseau', 'réseaux') : null, tenant.google_review_url ? 'avis Google' : null].filter(Boolean);

  return {
    boutique: profileComplete ? { label: 'Configuré', tone: 'ok' } : { label: 'À compléter', tone: 'warning' },
    retrait: !tenant.click_collect_enabled
      ? { label: pickupConfigured ? '1 point · retrait désactivé' : 'Retrait désactivé', tone: 'neutral' }
      : pickupConfigured ? { label: '1 point configuré', tone: 'ok' } : { label: 'Adresse à compléter', tone: 'warning' },
    apparence: tenant.app_icon_url
      ? { label: 'Configuré', tone: 'ok' }
      : tenant.logo_url ? { label: 'Logo utilisé comme icône', tone: 'neutral' } : { label: 'À configurer', tone: 'warning' },
    presence: presenceParts.length > 0 ? { label: presenceParts.join(' · '), tone: 'ok' } : { label: 'Aucun lien public', tone: 'neutral' },
    notifications: activeRecipients > 0 ? { label: plural(activeRecipients, 'destinataire', 'destinataires'), tone: 'ok' } : { label: 'Aucun destinataire', tone: 'warning' },
    automatisations: !digest.available || !digest.initial
      ? { label: 'Indisponible', tone: 'neutral' }
      : digest.initial.status === 'invalid'
        ? { label: 'Configuration invalide', tone: 'warning' }
        : digest.initial.enabled ? { label: 'Rapport quotidien actif', tone: 'ok' } : { label: 'Rapport quotidien inactif', tone: 'neutral' },
    paiements: activePayments > 0 ? { label: plural(activePayments, 'moyen actif', 'moyens actifs'), tone: 'ok' } : { label: 'Aucun moyen actif', tone: 'warning' },
    integrations: integrations > 0 ? { label: plural(integrations, 'service connecté', 'services connectés'), tone: 'ok' } : { label: 'Aucun service', tone: 'neutral' },
    legal: legalComplete ? { label: 'Complet', tone: 'ok' } : { label: 'À compléter', tone: 'warning' },
  };
}
