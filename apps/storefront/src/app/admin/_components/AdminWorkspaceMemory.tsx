'use client';

import { useEffect } from 'react';
import { ADMIN_WORKSPACE_COOKIE, type AdminWorkspace } from '@/lib/admin/workspace';

/**
 * Remembers the last workspace opened (UX only). The cookie is read by the
 * middleware to reopen it from the installed app; it grants nothing, every
 * page still passes the server permission check.
 */
export default function AdminWorkspaceMemory({ workspace }: { workspace: AdminWorkspace }) {
  useEffect(() => {
    document.cookie = `${ADMIN_WORKSPACE_COOKIE}=${workspace}; path=/admin; max-age=${60 * 60 * 24 * 180}; samesite=lax${location.protocol === 'https:' ? '; secure' : ''}`;
  }, [workspace]);
  return null;
}
