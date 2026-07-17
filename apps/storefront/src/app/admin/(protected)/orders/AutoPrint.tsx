'use client';

import { useEffect } from 'react';

export default function AutoPrint() {
  useEffect(() => {
    // Piccolo delay: evita di far partire window.print() prima che
    // layout e font siano stabili nel nuovo tab.
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, []);
  return null;
}
