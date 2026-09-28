import 'server-only';
import type { Tenant } from '@lepefy/types';
import { configuredEmailTransport } from '@/lib/notifications/emailTransport';
import { getWalletAvailability } from '@/lib/loyalty/wallet/config';

export type IntegrationState = 'connected' | 'configured' | 'inactive' | 'missing';

export interface IntegrationStatus {
  key: 'stripe' | 'packlink' | 'n8n' | 'brevo' | 'wallet';
  name: string;
  description: string;
  state: IntegrationState;
  stateLabel: string;
  details: string[];
  manageHref?: string;
  manageLabel?: string;
  /** Admin permission required by manageHref when it leaves Paramètres. */
  managePermission?: string;
}

const STRIPE_MODULES = [['SHOP', 'Boutique'], ['CARD', 'Carte'], ['EVENT', 'Événements'], ['RENTAL', 'Location']] as const;

/**
 * Real integrations of this deployment, reported as present/absent only.
 * Never returns a key, secret, URL or account identifier.
 */
export function loadIntegrationStatuses(tenant: Tenant): IntegrationStatus[] {
  const env = process.env;

  const stripeModules = STRIPE_MODULES.filter(([suffix]) => Boolean(env[`STRIPE_SECRET_KEY_${suffix}`] || env.STRIPE_SECRET_KEY));
  const stripeDedicated = STRIPE_MODULES.filter(([suffix]) => Boolean(env[`STRIPE_SECRET_KEY_${suffix}`]));
  const stripe: IntegrationStatus = {
    key: 'stripe',
    name: 'Stripe',
    description: 'Paiements en ligne par carte, Apple Pay et Google Pay.',
    state: stripeModules.length > 0 ? 'connected' : 'missing',
    stateLabel: stripeModules.length > 0 ? 'Connecté' : 'Non configuré',
    details: stripeModules.length > 0
      ? [
        `Services couverts : ${stripeModules.map(([, label]) => label).join(', ')}`,
        stripeDedicated.length > 0 ? `Compte dédié : ${stripeDedicated.map(([, label]) => label).join(', ')}` : 'Un compte partagé par tous les services',
      ]
      : ['Aucune clé Stripe n’est configurée sur ce déploiement.'],
    manageHref: '/admin/parametres/paiements',
    manageLabel: 'Moyens de paiement',
  };

  const packlinkKey = tenant.packlink_api_key ? 'tenant' : env.PACKLINK_API_KEY ? 'platform' : null;
  const packlinkActive = tenant.shipping_provider === 'packlink';
  const packlink: IntegrationStatus = {
    key: 'packlink',
    name: 'Packlink',
    description: 'Devis transporteurs et suivi des expéditions.',
    state: !packlinkKey ? 'missing' : packlinkActive ? 'configured' : 'inactive',
    stateLabel: !packlinkKey ? 'Non configuré' : packlinkActive ? 'Configuré' : 'Inactif',
    details: [
      packlinkKey === 'tenant' ? 'Clé API propre à la boutique' : packlinkKey === 'platform' ? 'Clé API de la plateforme' : 'Aucune clé API disponible',
      packlinkActive ? 'Utilisé pour les devis de livraison' : `Mode de livraison actuel : ${tenant.shipping_provider === 'flat_rate' ? 'forfait' : 'retrait uniquement'}`,
    ],
    manageHref: '/admin/livraison',
    manageLabel: 'Livraison',
    managePermission: 'shipping.view',
  };

  const n8nUrl = Boolean(env.N8N_WEBHOOK_URL);
  const n8nSecret = Boolean(env.N8N_NOTIFICATION_WEBHOOK_SECRET);
  const n8n: IntegrationStatus = {
    key: 'n8n',
    name: 'n8n',
    description: 'Automatisations, rapports programmés et notifications.',
    state: n8nUrl ? 'configured' : 'missing',
    stateLabel: n8nUrl ? 'Configuré' : 'Non configuré',
    details: [
      n8nUrl ? 'Webhooks de notification configurés' : 'Aucune URL de webhook configurée',
      n8nSecret ? 'Webhooks signés' : 'Webhooks non signés',
    ],
    manageHref: '/admin/parametres/automatisations',
    manageLabel: 'Automatisations',
  };

  const statuses = [stripe, packlink, n8n];

  if (configuredEmailTransport() === 'brevo') {
    const brevoKey = Boolean(env.BREVO_API_KEY);
    statuses.push({
      key: 'brevo',
      name: 'Brevo',
      description: 'Envoi des emails transactionnels.',
      state: brevoKey ? 'configured' : 'missing',
      stateLabel: brevoKey ? 'Configuré' : 'Clé manquante',
      details: ['Transport des emails de la boutique'],
    });
  }

  const wallet = getWalletAvailability(tenant.slug, tenant.logo_url);
  if (wallet.apple || wallet.google) {
    statuses.push({
      key: 'wallet',
      name: 'Apple Wallet / Google Wallet',
      description: 'Cartes de fidélité ajoutées au téléphone des clients.',
      state: 'configured',
      stateLabel: 'Configuré',
      details: [[wallet.apple && 'Apple Wallet', wallet.google && 'Google Wallet'].filter(Boolean).join(' · ')],
      manageHref: '/admin/loyalty',
      manageLabel: 'Fidélité',
      managePermission: 'loyalty.manage',
    });
  }

  return statuses;
}
