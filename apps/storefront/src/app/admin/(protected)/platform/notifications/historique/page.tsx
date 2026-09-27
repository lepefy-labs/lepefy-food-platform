import { NotificationDeliveriesSection } from '../NotificationDeliveriesSection';

// Platform-owner access is enforced by app/admin/(protected)/platform/layout.tsx
// and by the platform API routes (requirePlatformOwner).
export default function PlatformNotificationHistoryPage() {
  return <NotificationDeliveriesSection />;
}
