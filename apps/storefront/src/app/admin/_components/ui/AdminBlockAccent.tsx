import type { ReactNode } from 'react';

type AdminBlockTone = 'primary' | 'info' | 'success' | 'warning' | 'neutral';

const toneClasses: Record<AdminBlockTone, string> = {
  primary: 'before:bg-a-brand',
  info: 'before:bg-tone-info-solid',
  success: 'before:bg-tone-success-solid',
  warning: 'before:bg-tone-warning-solid',
  neutral: 'before:bg-a-border-strong',
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
