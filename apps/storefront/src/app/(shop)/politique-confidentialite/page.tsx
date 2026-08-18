import type { Metadata } from 'next';
import { getTenant } from '@/lib/tenant/getTenant';

export const metadata: Metadata = {
  title: 'Politique de confidentialité',
  description: 'Collecte, usage et protection de vos données personnelles.',
};

// ISR : contenu légal, aucune donnée personnalisée par utilisateur — même
// raisonnement que la home (page.tsx) et products/[slug]/page.tsx.
export const revalidate = 300;

const FALLBACK = 'non renseigné';

function MailtoOrFallback({ email }: { email: string }) {
  if (email === FALLBACK) return <>{email}</>;
  return <a href={`mailto:${email}`} className="underline">{email}</a>;
}

export default async function PolitiqueConfidentialitePage() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);

  const legalName = tenant.legal_name ?? FALLBACK;
  const legalAddress = tenant.legal_address ?? FALLBACK;
  const legalEmail = tenant.legal_email ?? FALLBACK;

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Politique de confidentialité</h1>

      <div className="space-y-8 text-sm text-gray-600 leading-relaxed">
        <section>
          <h2 className="text-base font-bold text-gray-900 mb-2">1. Responsable du traitement</h2>
          <p>
            {legalName}, {legalAddress} — contact : <MailtoOrFallback email={legalEmail} />
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-900 mb-2">2. Données collectées</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Données de compte : nom, email, téléphone (si fourni)</li>
            <li>Adresses de livraison et facturation</li>
            <li>Historique de commandes et panier</li>
            <li>
              Données de paiement : traitées directement par nos prestataires de paiement (Stripe,
              Satispay) — nous ne stockons jamais vos données de carte bancaire sur nos serveurs
            </li>
            <li>
              Programme de fidélité et de parrainage : points, codes de parrainage, et — à des fins
              de prévention de la fraude uniquement — adresse IP et identifiant technique de
              l&apos;appareil au moment de l&apos;inscription via un lien de parrainage
            </li>
            <li>
              Communications : messages envoyés via notre chat en ligne (assisté par intelligence
              artificielle) ou WhatsApp
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-900 mb-2">3. Finalités</h2>
          <p>
            Traitement des commandes, livraison, service client, programme de fidélité/parrainage,
            prévention de la fraude, envoi d&apos;emails transactionnels (confirmation de commande,
            expédition).
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-900 mb-2">4. Base légale</h2>
          <p>
            Exécution du contrat (commandes), intérêt légitime (prévention de la fraude,
            amélioration du service), consentement (le cas échéant, pour les communications
            marketing).
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-900 mb-2">5. Destinataires et sous-traitants</h2>
          <p className="mb-2">
            Vos données peuvent être transmises aux catégories de prestataires suivantes, dans la
            stricte mesure nécessaire à leur mission :
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Hébergement et infrastructure technique (base de données et stockage sécurisé)</li>
            <li>Prestataires de traitement des paiements</li>
            <li>Prestataires logistiques (organisation de la livraison — nom, adresse de livraison)</li>
            <li>Prestataire d&apos;envoi d&apos;emails transactionnels</li>
            <li>
              Services d&apos;intelligence artificielle (suggestions produits, assistant
              conversationnel — traitement de vos messages de chat si vous utilisez cette
              fonctionnalité)
            </li>
            <li>L&apos;opérateur technique de la plateforme sur laquelle repose cette boutique</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-900 mb-2">6. Durée de conservation</h2>
          <p>
            Les données de commande sont conservées pendant la durée nécessaire aux obligations
            légales et comptables. Les données de compte sont conservées tant que le compte est
            actif, puis supprimées ou anonymisées sur demande.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-900 mb-2">7. Vos droits</h2>
          <p>
            Conformément au RGPD, vous disposez d&apos;un droit d&apos;accès, de rectification,
            d&apos;effacement, de limitation et d&apos;opposition sur vos données. Pour exercer ces
            droits, contactez-nous à <MailtoOrFallback email={legalEmail} />.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-900 mb-2">8. Cookies et stockage local</h2>
          <p>
            Nous utilisons des cookies techniques nécessaires au fonctionnement du site (session,
            panier) et un cookie d&apos;attribution de parrainage (durée : 30 jours). Aucun cookie
            publicitaire tiers n&apos;est utilisé.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-900 mb-2">9. Sécurité</h2>
          <p>
            Vos données sont hébergées au sein de l&apos;Union européenne et protégées par des
            mesures techniques appropriées (chiffrement en transit, accès restreint).
          </p>
        </section>
      </div>
    </div>
  );
}
