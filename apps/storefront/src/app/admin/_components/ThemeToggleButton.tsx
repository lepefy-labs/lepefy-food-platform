'use client';

import { IconSun, IconMoon } from '@tabler/icons-react';
import { useAdminTheme } from './AdminThemeProvider';

export default function ThemeToggleButton() {
  const { dark, toggle } = useAdminTheme();
  return (
    <button
      onClick={toggle}
      className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors"
      aria-label={dark ? 'Activer le thème clair' : 'Activer le thème sombre'}
      title={dark ? 'Thème clair' : 'Thème sombre'}
    >
      {dark ? <IconSun size={17} /> : <IconMoon size={17} />}
    </button>
  );
}
