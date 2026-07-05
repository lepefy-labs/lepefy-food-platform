import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Contact',
  robots: { index: false, follow: false },
};

export default function CardLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
