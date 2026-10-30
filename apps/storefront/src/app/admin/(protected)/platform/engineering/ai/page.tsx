import { createServiceClient } from '@/lib/supabase/server';
import { getActiveRun } from '@/lib/engineering/server/activeRun';
import { loadSettings } from '@/lib/engineering/server/metrics';
import InlineAlert from '../../../../_components/ui/InlineAlert';
import { EngineeringChrome, IndexBanner, IndexGate } from '../_components/EngineeringChrome';
import AskClient from './AskClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function EngineeringAiPage() {
  const gate = IndexGate({ result: await getActiveRun() });
  if (!gate.run) return <EngineeringChrome active="ai" title="Engineering AI">{gate.fallback}</EngineeringChrome>;
  const run = gate.run;

  let enabled = false;
  let reason = 'Impostazioni non leggibili: verifica che la migration 176 sia applicata.';
  try {
    const settings = await loadSettings(run.repositoryId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: policy } = await (createServiceClient() as any).from('ai_routing_policies').select('enabled').eq('consumer', 'engineering').eq('capability', 'structured_chat').maybeSingle();
    if (settings) {
      const routing = policy?.enabled === true;
      enabled = settings.aiEnabled && routing;
      reason = enabled ? '' : !settings.aiEnabled && !routing
        ? 'L’assistente è spento: servono l’impostazione AI (scheda Accessi) e la policy di routing «engineering» (Piattaforma › Intelligenza artificiale › Routage).'
        : !settings.aiEnabled ? 'L’assistente è spento nelle impostazioni (scheda Accessi).' : 'La policy di routing «engineering» è disabilitata (Piattaforma › Intelligenza artificiale › Routage).';
    }
  } catch { /* keep the "unreadable" reason */ }

  return (
    <EngineeringChrome active="ai" title="Engineering AI" description="Risponde solo con ciò che trova nell’indice, citando file e righe al commit indicizzato.">
      <IndexBanner run={run} />
      {!enabled && <InlineAlert tone="warning" title="Assistente non attivo">{reason}</InlineAlert>}
      <AskClient enabled={enabled} />
    </EngineeringChrome>
  );
}
