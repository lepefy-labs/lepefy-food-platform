'use client';

import Image from 'next/image';
import { useTenant } from '@/providers/TenantProvider';

interface AdminTenantIdentityProps {
  align?: 'left' | 'center';
  compact?: boolean;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'T';
}

export default function AdminTenantIdentity({ align = 'center', compact = false }: AdminTenantIdentityProps) {
  const tenant = useTenant();
  const centered = align === 'center';

  return (
    <div className={centered ? 'text-center' : 'text-left'}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-600">Lepefy Admin</p>
      <div className={`mt-3 flex items-center gap-3 rounded-2xl border border-gray-100 bg-gray-50/80 ${compact ? 'px-3 py-2.5' : 'px-4 py-3'} ${centered ? 'justify-center text-left' : ''}`}>
        <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-100 bg-white ${compact ? 'h-11 w-14' : 'h-14 w-20'}`}>
          {tenant.logo_url ? (
            <Image
              src={tenant.logo_url}
              alt={`Logo ${tenant.name}`}
              width={120}
              height={72}
              className="max-h-full max-w-full object-contain p-1.5"
              unoptimized
            />
          ) : (
            <span className="text-sm font-bold text-gray-500">{initials(tenant.name)}</span>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">Espace administrateur</p>
          <p className="mt-0.5 truncate text-base font-semibold text-gray-900">{tenant.name}</p>
        </div>
      </div>
    </div>
  );
}
