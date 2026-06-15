'use client';
import { useTenant } from '@/providers/TenantProvider';

export function Footer() {
  const tenant = useTenant();

  return (
    <footer className="bg-gray-50 border-t border-gray-200 mt-auto">
      <div
        className="max-w-7xl mx-auto px-4 pt-8 text-center text-sm text-gray-500"
        style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <p>© {new Date().getFullYear()} {tenant.name}. Tous droits réservés.</p>
        {tenant.show_powered_by && (
          <p className="mt-3 text-xs text-gray-400">
            Propulsé par{' '}
            <span className="font-medium text-gray-500">Lepefy Labs</span>
          </p>
        )}
      </div>
    </footer>
  );
}
