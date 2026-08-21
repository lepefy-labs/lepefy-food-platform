import { getTenant } from '@/lib/tenant/getTenant';
import { EventsHeader } from './_components/EventsHeader';
import { EventsFooter } from './_components/EventsFooter';

export default async function EvenementielLayout({ children }: { children: React.ReactNode }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  return (
    <div className="flex min-h-screen flex-col bg-[#f7f3eb]">
      <EventsHeader tenant={tenant} />
      <main className="flex-1 pt-[68px]">{children}</main>
      <EventsFooter tenant={tenant} />
    </div>
  );
}
