'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { IconChevronDown, IconLock, IconLogout } from '@tabler/icons-react';

interface AdminUserMenuProps {
  adminEmail: string;
}

// Reconstruit à partir du style de `_tailadmin-staging/components/header/
// UserDropdown.tsx` (déclencheur avatar + panneau, click-outside via
// Dropdown.tsx du staging) mais avec des classes de production — le staging
// dépend d'une config Tailwind isolée (classes `brand-*`) non réutilisable
// ici, d'où `var(--color-primary)`/dérivés comme dans AdminSidebar.tsx.
export default function AdminUserMenu({ adminEmail }: AdminUserMenuProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false);
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  async function handleLogout() {
    // Même logique/appel exact que LogoutButton.tsx (toujours utilisé tel
    // quel sur loyalty/scan et evenementiel/scan, hors du groupe protégé) —
    // non dupliquée différemment ici.
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    await supabase.auth.signOut();
    router.push('/admin/login');
    router.refresh();
  }

  const initial = adminEmail.charAt(0).toUpperCase() || '?';

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Menu du compte"
        aria-expanded={isOpen}
        className="flex items-center gap-1.5 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <span
          className="flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold shrink-0"
          style={{ backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary-dark)' }}
        >
          {initial}
        </span>
        <IconChevronDown
          size={16}
          stroke={1.5}
          className={`text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-64 rounded-xl border border-gray-200 dark:border-gray-800
                     bg-white dark:bg-gray-900 shadow-lg p-2 z-20"
        >
          <p className="px-2 py-1.5 text-xs text-gray-500 dark:text-gray-400 truncate">{adminEmail}</p>

          <div className="my-1 border-t border-gray-100 dark:border-gray-800" />

          <Link
            href="/admin/securite"
            onClick={() => setIsOpen(false)}
            className="flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-gray-700 dark:text-gray-300
                       hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <IconLock size={16} stroke={1.5} />
            Sécurité
          </Link>

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-gray-700 dark:text-gray-300
                       hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <IconLogout size={16} stroke={1.5} />
            Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}
