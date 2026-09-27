import { redirect } from 'next/navigation';

// Section entry point (and former URL of the test console).
export default function PlatformNotificationsIndex() {
  redirect('/admin/platform/notifications/historique');
}
