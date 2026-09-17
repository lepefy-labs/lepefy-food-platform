# Carte fidélité — Google Wallet / Apple Wallet

## Implementation

La carte de l’espace client et la page `/compte/carte-fidelite` partagent `LoyaltyCardFace`.
ChloéFood utilise bleu #195B9E et jaune #F8D817, avec le logo tenant original. Les autres tenants conservent leurs couleurs configurées. Aucun changement de points, règles de fidélité, scanner caisse, session ou schéma DB.

`GET /api/loyalty/wallet/google` crée une classe tenant et un objet client via l’API Google, met à jour un objet existant puis retourne un lien save JWT RS256 court.
`GET /api/loyalty/wallet/apple` retourne un storeCard signé CMS detached, avec manifest SHA-1, WWDR, signing-time et images PNG 1x/2x/3x dans une archive ZIP.
Les endpoints imposent session client du tenant, fidélité active, consentement CGV courant et numéro de carte existant. Les données sont relues côté serveur, jamais acceptées du navigateur. Réponses privées no-store.

Les pass contiennent nom client, numéro tessera et solde au moment de l’émission. Le QR encode le même numéro que le scanner existant. Les identifiants stables incluent tenant + client, ce qui permet le remplacement de la carte sans doublon.

## Activation sur Vercel

Configurer uniquement les variables server-side, jamais des variables NEXT_PUBLIC pour les clés.

- `LOYALTY_WALLET_TENANT_SLUG=chloefood` : binding obligatoire des credentials au tenant.
- `GOOGLE_WALLET_ISSUER_ID` : ID compte emittente Google Wallet.
- `GOOGLE_WALLET_CLIENT_EMAIL` : service account autorisé sur cet issuer.
- `GOOGLE_WALLET_PRIVATE_KEY` : clé RSA PEM du service account.
- `APPLE_WALLET_PASS_TYPE_ID` : identifiant enregistré `pass.…`.
- `APPLE_WALLET_TEAM_ID` : Team ID Apple.
- `APPLE_WALLET_CERTIFICATE` : certificat Pass Type ID PEM.
- `APPLE_WALLET_PRIVATE_KEY` : clé RSA PEM correspondante.
- `APPLE_WALLET_WWDR_CERTIFICATE` : certificat intermédiaire Apple WWDR PEM correspondant.
- `APPLE_WALLET_KEY_PASSPHRASE` : facultatif, si clé chiffrée.
- `LOYALTY_WALLET_ASSET_HOSTS` : liste optionnelle d’hostnames HTTPS autorisés pour le logo, séparés par virgules. Par défaut : hostname storefront + Supabase configuré.

Les valeurs PEM acceptent des sauts de ligne réels ou des séquences littérales `\\n`.
L’URL canonique provient de `tenants.storefront_url` ou `NEXT_PUBLIC_APP_URL` et doit être HTTPS.
Google requiert un logo tenant HTTPS publiquement accessible. Apple télécharge le logo depuis un hôte autorisé (sans redirections, timeout 10 s, maximum 2 MB).
La UI ne propose aucun bouton pour une configuration absente, invalide, certificat expiré ou non lié au tenant. Le paramétrage Google local ne garantit pas l’approbation du compte issuer.

## Mise en production et validation

1. Compléter onboarding issuer Google et autoriser le service account. Obtenir publishing access : les pass en mode demo restent TEST ONLY.
2. Enregistrer Pass Type ID et obtenir le certificat Apple via le compte Apple Developer.
3. Configurer les variables pour le tenant et redéployer.
4. Tester sur Android et iPhone : connexion, ajout, nom/solde/numéro, scan caisse, puis ré-ajout après changement réel du solde.
5. Confirmer que la configuration de chaque environnement correspond au tenant, que le logo fonctionne et que le endpoint ne divulgue aucun pass sans session.

Tests CI : isolation des identifiants, signature RS256, appels Google create/conflict/update, gestion échec fournisseur, signature CMS vérifiée indépendamment avec OpenSSL, rejet de manifest altéré et ZIP vérifié avec unzip.

## Limites actuelles

Pas d’APNs ni de web service d’enregistrement PassKit, pas de synchronisation automatique après chaque commande.
Le client ré-ajoute la carte pour actualiser le solde (même identité, remplacement). La UI et le dos du pass l’expliquent ; l’espace client reste la source du solde actuel.
Google voit son objet mis à jour lors du ré-ajout ; Apple reçoit un nouveau fichier signé.
Activation effective et ajout sur appareils exigent les comptes/certificats réels et un test device. CI valide les formats et signatures avec des fixtures synthétiques, pas l’acceptation réelle Apple/Google.
