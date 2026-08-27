'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { IconChevronDown, IconLock, IconLogout, IconUser } from '@tabler/icons-react';

interface AdminUserMenuProps {
  adminEmail: string;
  adminDisplayName?: string;
}

export default function AdminUserMenu({ adminEmail, adminDisplayName }: AdminUserMenuProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setIsOpen(false);
    }
    function handleEscape(e: KeyboardEvent) { if (e.key === 'Escape') setIsOpen(false); }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  async function handleLogout() {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    await supabase.auth.signOut();
    router.push('/admin/login');
    router.refresh();
  }

  const label = adminDisplayName?.trim() || adminEmail;
  const initial = label.charAt(0).toUpperCase() || '?';

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Menu du compte"
        aria-expanded={isOpen}
        className="flex items-center gap-1.5 rounded-lg p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold" style={{ backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary-dark)' }}>{initial}</span>
        <IconChevronDown size={16} stroke={1.5} className={`text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-800 dark:bg-gray-900">
          <div className="px-2 py-1.5">
            <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{label}</p>
            <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{adminEmail}</p>
          </div>
          <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
          <Link href="/admin/onboarding?edit=1" onClick={() => setIsOpen(false)} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">
            <IconUser size={16} stroke={1.5} />Mon profil
          </Link>
          <Link href="/admin/securite" onClick={() => setIsOpen(false)} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">
            <IconLock size={16} stroke={1.5} />Sécurité
          </Link>
          <button onClick={handleLogout} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">
            <IconLogout size={16} stroke={1.5} />Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}
