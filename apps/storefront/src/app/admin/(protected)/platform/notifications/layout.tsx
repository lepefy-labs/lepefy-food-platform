import PlatformSectionTabs from '../../../_components/PlatformSectionTabs';

export default function PlatformNotificationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Notifications</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Emails automatiques de la plateforme : suivi des envois, modèles, tests et état du transport.</p>
        <PlatformSectionTabs groupId="notifications" />
      </header>
      {children}
    </div>
  );
}
