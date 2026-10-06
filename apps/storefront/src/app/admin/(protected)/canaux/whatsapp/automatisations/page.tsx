import { createServiceClient } from '@/lib/supabase/server';
import { resolveRules, RULE_DEFINITIONS, type AutomationRuleRow } from '@/lib/whatsapp/automation/rules';
import { requireWhatsAppPage } from '@/lib/whatsapp/server/featureGate';
import AdminPageHeader from '../../../../_components/ui/AdminPageHeader';
import WhatsAppTabs from '../_components/WhatsAppTabs';
import { loadNeedsHumanCount } from '../_components/loadNeedsHumanCount';
import RulesEditor, { type EditableRule } from './RulesEditor';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function WhatsAppAutomationsPage() {
  const { tenant, can } = await requireWhatsAppPage('whatsapp.view');
  const [{ data }, needsHuman] = await Promise.all([
    createServiceClient().from('whatsapp_automation_rules').select('code, enabled, priority, configuration').eq('tenant_id', tenant.id),
    loadNeedsHumanCount(tenant.id),
  ]);
  const rules: EditableRule[] = resolveRules((data ?? []) as AutomationRuleRow[]).map((rule) => {
    const definition = RULE_DEFINITIONS.find((candidate) => candidate.code === rule.code)!;
    return { code: rule.code, enabled: rule.enabled, priority: rule.priority, configuration: rule.configuration, label: definition.label, description: definition.description };
  });

  return (
    <div className="mx-auto max-w-5xl">
      <AdminPageHeader
        title="WhatsApp"
        description="Réponses déterministes, toujours prioritaires sur Nala. Les informations (horaires, adresse, livraison, stock, commandes) viennent des réglages de la boutique : rien n’est recopié ici."
      />
      <WhatsAppTabs active="automations" needsHumanCount={needsHuman} />
      <RulesEditor initial={rules} canManage={can('whatsapp.manage')} />
    </div>
  );
}
