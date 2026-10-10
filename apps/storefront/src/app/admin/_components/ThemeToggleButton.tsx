'use client';

import { IconMoon, IconSun } from '@tabler/icons-react';
import { IconButton } from './ui/Button';
import { useAdminTheme } from './AdminThemeProvider';

export default function ThemeToggleButton() {
  const { dark, toggle } = useAdminTheme();
  return (
    <IconButton
      label={dark ? 'Activer le thème clair' : 'Activer le thème sombre'}
      icon={dark ? <IconSun size={18} aria-hidden="true" /> : <IconMoon size={18} aria-hidden="true" />}
      onClick={toggle}
    />
  );
}
