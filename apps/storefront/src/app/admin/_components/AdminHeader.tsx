import { Suspense } from 'react';
import Image from 'next/image';
import AdminMobileNav from './AdminMobileNav';
import AdminGlobalSearch from './AdminGlobalSearch';
import ThemeToggleButton from './ThemeToggleButton';
import NotificationBell from './ui/NotificationBell';
import AdminUserMenu from './AdminUserMenu';

interface AdminHeaderProps {
  tenantName: string;
  tenantLogoUrl: string | null;
  categories: { id: string; name: string; slug: string }[];
  isPlatformOwner?: boolean;
  adminEmail: string;
}

/**
 * Extrait de `(protected)/layout.tsx` — même markup/props qu'avant, juste
 * isolé dans son propre composant (comme AdminSidebar l'était déjà) pour
 * pouvoir en retravailler la présentation (espacement, typo) sans alourdir
 * le layout qui porte la logique d'auth/données.
 */
export default function AdminHeader({ tenantName, tenantLogoUrl, categories, isPlatformOwner = false, adminEmail }: AdminHeaderProps) {
  return (
    <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-3 md:px-6 py-3 flex items-center gap-3 sticky top-0 z-10">
      <Suspense fallback={<div className="w-9 h-9 md:hidden" />}>
        <AdminMobileNav categories={categories} isPlatformOwner={isPlatformOwner} />
      </Suspense>
      {tenantLogoUrl && (
        <Image
          src={tenantLogoUrl}
          alt={tenantName}
          width={140}
          height={32}
          className="h-8 w-auto object-contain"
          priority
        />
      )}
      <div className="flex-shrink-0">
        <span className="font-bold text-gray-900 dark:text-gray-100 text-sm">{tenantName}</span>
        <span className="ml-2 text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide">
          Administration
        </span>
      </div>

      {/* Zone flexible entre le bloc tenant et le cluster d'icônes : sur
          desktop la barre de recherche s'y étale (plafonnée à max-w-lg) ;
          sur mobile le composant ne rend qu'une icône compacte (voir
          AdminGlobalSearch), qu'on colle au cluster d'icônes via
          justify-end plutôt que de la laisser flotter à gauche de la zone. */}
      <div className="flex-1 min-w-0 flex justify-end md:justify-start md:max-w-lg md:mx-4">
        <AdminGlobalSearch />
      </div>

      <div className="ml-auto flex items-center gap-1">
        <NotificationBell />
        <ThemeToggleButton />
        <AdminUserMenu adminEmail={adminEmail} />
      </div>
    </header>
  );
}
