import { redirect } from 'next/navigation';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import FeedbackAdminClient from './FeedbackAdminClient';

export const dynamic = 'force-dynamic';

export default async function PlatformFeedbackPage() {
  if (await requirePlatformOwner()) redirect('/admin');
  return <FeedbackAdminClient />;
}
