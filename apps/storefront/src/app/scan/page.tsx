import { redirect } from 'next/navigation';
import { EVENTS_SCAN_PATH } from '@/lib/auth/adminRoutePermissions';

export const dynamic = 'force-dynamic';

// The scanner moved under /admin/ (scope of the installed Lepefy Admin app).
// Old QR codes, bookmarks and notifications keep working through this alias.
export default function LegacyScanPage({ searchParams }: { searchParams?: { event_id?: string } }) {
  const query = searchParams?.event_id ? `?event_id=${encodeURIComponent(searchParams.event_id)}` : '';
  redirect(`${EVENTS_SCAN_PATH}${query}`);
}
