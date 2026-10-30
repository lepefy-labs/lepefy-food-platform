import { EngineeringChrome } from '../_components/EngineeringChrome';
import AccessClient from './AccessClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Platform Owner only (platform/layout.tsx); the APIs behind it call requireEngineeringApi.
export default function EngineeringAccessPage() {
  return (
    <EngineeringChrome active="accessi" title="Accessi e impostazioni" description="Interruttore dell’assistente AI, limiti di spesa e credenziali per CI e strumenti interni.">
      <AccessClient />
    </EngineeringChrome>
  );
}
