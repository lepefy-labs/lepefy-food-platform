import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import ModuleSettingsToggle from '../ModuleSettingsToggle';
import EventsListClient from './EventsListClient';
import type { EventRow } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function AdminEventsPage() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();
  const { data: events } = await supabase
    .from('events')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('date_start', { ascending: false });

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h1 className="text-xl font-semibold text-gray-900">Événements</h1>
        <ModuleSettingsToggle field="events_enabled" label="Module événementiel" initialValue={tenant.events_enabled} />
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Créez vos soirées barbecue, définissez les formules et suivez les réservations.
      </p>

      <EventsListClient initialEvents={(events ?? []) as EventRow[]} />
    </div>
  );
}
