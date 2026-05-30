import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-200 mb-4">404</h1>
        <p className="text-xl text-gray-600 mb-6">Page introuvable</p>
        <Link href="/products" className="inline-block px-6 py-3 rounded-xl font-medium text-white" style={{ backgroundColor: 'var(--color-primary)' }}>
          Retour au catalogue
        </Link>
      </div>
    </div>
  );
}
