import SecuriteClient from './SecuriteClient';

export default function SecuritePage() {
  return (
    <div className="max-w-md">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-1">Sécurité</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Définissez ou modifiez le mot de passe de votre compte administrateur.
      </p>

      <SecuriteClient />
    </div>
  );
}
