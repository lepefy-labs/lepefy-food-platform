import SecuriteClient from './SecuriteClient';

export default function SecuritePage() {
  return (
    <div className="max-w-md">
      <h1 className="text-xl font-semibold text-a-text mb-1">Sécurité</h1>
      <p className="text-sm text-a-text-3 mb-6">
        Définissez ou modifiez le mot de passe de votre compte administrateur.
      </p>

      <SecuriteClient />
    </div>
  );
}
