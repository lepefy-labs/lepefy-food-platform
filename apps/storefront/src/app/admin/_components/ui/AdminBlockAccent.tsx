import type { ReactNode } from 'react';

type AdminBlockTone = 'primary' | 'info' | 'success' | 'warning' | 'neutral';

const toneClasses: Record<AdminBlockTone, string> = {
  primary: 'before:bg-[var(--admin-primary)]',
  info: 'before:bg-blue-500',
  success: 'before:bg-emerald-500',
  warning: 'before:bg-amber-500',
  neutral: 'before:bg-slate-300 dark:before:bg-slate-600',
};

interface AdminBlockAccentProps {
  children: ReactNode;
  tone?: AdminBlockTone;
  className?: string;
}

export default function AdminBlockAccent({
  children,
  tone = 'primary',
  className = '',
}: AdminBlockAccentProps) {
  return (
    <div
      className={`relative pl-3 before:absolute before:inset-y-1 before:left-0 before:w-1 before:rounded-full ${toneClasses[tone]} ${className}`}
    >
      {children}
    </div>
  );
}
