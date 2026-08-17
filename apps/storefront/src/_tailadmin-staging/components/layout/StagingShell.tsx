'use client';

import React from 'react';
import { SidebarProvider, useSidebar } from '../../context/SidebarContext';
import { ThemeProvider, useTheme } from '../../context/ThemeContext';
import AppHeader from './AppHeader';
import AppSidebar from './AppSidebar';
import Backdrop from './Backdrop';

/**
 * Port of the template's `src/app/(admin)/layout.tsx`. Not an actual Next.js
 * layout on purpose — this stays a plain component mounted only by the
 * staging preview page, so it never touches real admin routing.
 *
 * `transform: translateZ(0)` on the outer frame turns it into a containing
 * block for CSS `position: fixed` descendants (AppSidebar/AppHeader keep
 * their original template classes unmodified), so the ported sidebar/header
 * stay scoped to this preview frame instead of covering the real admin
 * chrome that already renders around this page.
 */
function StagingShellInner({ children }: { children: React.ReactNode }) {
  const { isExpanded, isHovered, isMobileOpen } = useSidebar();
  const { theme } = useTheme();

  const mainContentMargin = isMobileOpen ? 'ml-0' : isExpanded || isHovered ? 'lg:ml-[290px]' : 'lg:ml-[90px]';

  return (
    <div
      className={`${theme === 'dark' ? 'dark' : ''} relative h-[900px] w-full overflow-auto rounded-xl border border-gray-200 dark:border-gray-800 isolate`}
      style={{ transform: 'translateZ(0)' }}
    >
      <div className="min-h-full xl:flex bg-gray-50 dark:bg-gray-950 font-outfit">
        <AppSidebar />
        <Backdrop />
        <div className={`flex-1 transition-all duration-300 ease-in-out ${mainContentMargin}`}>
          <AppHeader />
          <div className="p-4 mx-auto max-w-[1536px] md:p-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function StagingShell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SidebarProvider>
        <StagingShellInner>{children}</StagingShellInner>
      </SidebarProvider>
    </ThemeProvider>
  );
}
