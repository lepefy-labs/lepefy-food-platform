import type { HelpBlock } from '../domain';

/**
 * Initial French library of the Help Center: 18 short guides written ONLY from
 * features and labels that exist in the repository (verified against the admin
 * screens and docs on 30/10/2026). They are imported as DRAFTS by the platform
 * owner (POST /api/admin/platform/knowledge/import-library) and published only
 * after an editorial review in /admin/platform/knowledge: nothing here is
 * published automatically.
 *
 * Maintenance contract: when an admin workflow changes, update the guides whose
 * `watch` paths below are touched (see docs/HELP_CENTER.md §Maintenance), or
 * flag them for review. Never republish without an editorial pass.
 */
export interface LibraryGuide {
  slug: string;
  module: string;
  title: string;
  summary: string;
  requiredPermission?: string;
  requiredFlag?: string;
  /** Route patterns where the guide is offered (priority = list order). */
  contexts: string[];
  /** Source areas that make this guide potentially stale when they change. */
  watch: string[];
  blocks: HelpBlock[];
}

const steps = (...items: string[]): HelpBlock => ({ type: 'steps', items });
const p = (text: string): HelpBlock => ({ type: 'paragraph', text });
const warn = (text: string): HelpBlock => ({ type: 'callout', tone: 'warning', text });
const info = (text: string): HelpBlock => ({ type: 'callout', tone: 'info', text });
const rel = (slug: string): HelpBlock => ({ type: 'related', slug });

export const INITIAL_LIBRARY: LibraryGuide[] = [
  // ─── Commandes ────────────────────────────────────────────────────────────
  {
    slug: 'preparer-une-commande',
    module: 'commandes',
    title: 'Préparer des commandes',
    summary: 'Ouvrir une session de préparation pour plusieurs commandes à la fois.',
    requiredPermission: 'orders.view',
    contexts: ['/admin/orders', '/admin/orders/preparation', '/admin'],
    watch: ['app/admin/(protected)/orders', 'lib/orders/preparation', 'docs/ORDER_PREPARATION.md'],
    blocks: [
      p('Une commande se prépare une fois payée. La session de préparation regroupe les articles de plusieurs commandes pour les prélever en une fois.'),
      steps(
        'Ouvrez **Commandes** et cochez les commandes à préparer.',
        'Dans la barre qui apparaît, cliquez sur **Préparer la sélection**.',
        'La session de préparation affiche la liste groupée par produit, avec le total et la répartition par commande. Les commandes exclues (non payées, annulées, conflit de stock) sont indiquées avec leur motif.',
        'Préparez les articles, puis confirmez la préparation selon le mode choisi par votre boutique (voir la guide sur le mode papier).',
      ),
      info('Les produits frais et surgelés sont placés en fin de liste.'),
      rel('imprimer-les-documents'),
      rel('mode-de-preparation-papier'),
    ],
  },
  {
    slug: 'imprimer-les-documents',
    module: 'commandes',
    title: 'Imprimer la liste de préparation et le bon de colis',
    summary: 'Obtenir les PDF d’une ou de plusieurs commandes, en A5 ou A4.',
    requiredPermission: 'orders.view',
    contexts: ['/admin/orders', '/admin/orders/[id]'],
    watch: ['lib/orders/documents', 'docs/ORDER_DOCUMENTS.md', 'app/admin/(protected)/orders/BulkDocumentsDialog.tsx'],
    blocks: [
      p('Deux documents existent : la liste de préparation (usage interne) et le bon de colis (pour le client, avec un QR code).'),
      steps(
        'Pour une commande : ouvrez son détail et utilisez la section **Documents**. Choisissez le format (A5 ou A4) puis ouvrez le PDF.',
        'Pour plusieurs commandes : cochez-les dans la liste puis cliquez sur **Documents…** (50 commandes au maximum par PDF).',
        'Le PDF s’ouvre dans un nouvel onglet : imprimez-le depuis le navigateur.',
      ),
      info('Le format par défaut se règle dans Paramètres, sous **Documents**. Les commandes annulées ne sont pas imprimées.'),
      rel('preparer-une-commande'),
    ],
  },
  {
    slug: 'mode-de-preparation-papier',
    module: 'commandes',
    title: 'Choisir le mode de préparation (Lepefy ou papier)',
    summary: 'Cocher les articles dans Lepefy, sur papier, ou ne rien enregistrer.',
    requiredPermission: 'tenant_settings.view',
    contexts: ['/admin/parametres/preparation', '/admin/orders/[id]'],
    watch: ['lib/orders/preparation', 'app/admin/(protected)/parametres/OrderPreparationSettingsSection.tsx', 'docs/ORDER_PREPARATION.md'],
    blocks: [
      p('Vous choisissez comment votre équipe confirme la préparation et, séparément, l’emballage des produits frais et surgelés.'),
      steps(
        'Ouvrez **Paramètres**, puis **Préparation et emballage**.',
        'Pour la checklist de préparation, choisissez **Validation article par article** (chaque produit est coché dans Lepefy), **Préparation sur papier** (vous cochez sur la feuille et confirmez « Préparation terminée » dans Lepefy) ou **Sans confirmation** (aucun contrôle n’est enregistré).',
        'Pour l’emballage frais et surgelés, choisissez **Contrôle dans Lepefy**, **Contrôle sur papier** ou **Sans confirmation**.',
        'Cliquez sur **Enregistrer**.',
      ),
      info('Le mode enregistré s’applique aux commandes dont la préparation n’a pas encore commencé. Il faut la permission de gérer les paramètres pour le modifier.'),
      warn('Avec « Sans confirmation » sur l’emballage froid, Lepefy ne garde aucune trace du contrôle de la chaîne du froid. Préférez « Contrôle sur papier » si vous expédiez du surgelé.'),
    ],
  },
  {
    slug: 'cloturer-ou-annuler-une-commande',
    module: 'commandes',
    title: 'Clôturer ou annuler une commande',
    summary: 'Annuler une commande ou la marquer comme traitée hors plateforme.',
    requiredPermission: 'orders.manage',
    contexts: ['/admin/orders/[id]'],
    watch: ['lib/orders/closure', 'app/admin/orders/[id]/OrderClosureDialog.tsx', 'docs/ORDER_CLOSURE.md'],
    blocks: [
      p('C’est le seul moyen d’annuler une commande. Seules les commandes nouvelles, en préparation ou prêtes au retrait peuvent être clôturées.'),
      steps(
        'Ouvrez le détail de la commande et cliquez sur **Clôturer ou annuler…**.',
        'Étape 1 : choisissez le motif, ajoutez une note interne si besoin, puis décidez de la communication au client : aucune, l’e-mail standard « commande annulée », ou un message personnalisé.',
        'Étape 2 : vérifiez les avertissements et le récapitulatif, puis confirmez avec **Clôturer la commande** (traitée hors plateforme) ou **Annuler la commande**.',
      ),
      warn('La clôture ne change pas le paiement : elle ne rembourse rien, ne remet pas le stock et ne touche pas à Packlink. Si une expédition est déjà prise en charge par le transporteur, la clôture est bloquée.'),
      info('Une commande « traitée hors plateforme » n’est ni une vente perdue ni un chiffre d’affaires de la plateforme.'),
    ],
  },
  {
    slug: 'creer-une-commande-assistee',
    module: 'commandes',
    title: 'Saisir une commande reçue par WhatsApp ou téléphone',
    summary: 'Créer une précommande et envoyer un lien de paiement au client.',
    requiredPermission: 'orders.manage',
    contexts: ['/admin/orders/new', '/admin/orders'],
    watch: ['app/admin/(protected)/orders/new', 'app/admin/(protected)/orders/_assisted', 'docs/ASSISTED_ORDERS.md'],
    blocks: [
      p('Une commande saisie par l’équipe est d’abord une précommande : la commande n’existe qu’une fois le paiement confirmé.'),
      steps(
        'Dans **Commandes**, cliquez sur **Nouvelle commande**.',
        'Ajoutez les produits, le contact et l’adresse (code postal et pays), puis cliquez sur **Calculer les frais**.',
        'Enregistrez : vous pouvez **Enregistrer comme brouillon**, ou créer la précommande avec son lien de paiement à envoyer au client.',
        'Si le client dit avoir déjà payé (virement, PayPal…), utilisez **Déjà payé** après avoir contrôlé la réception du paiement.',
      ),
      warn('Ne confirmez un paiement qu’après avoir réellement constaté sa réception.'),
    ],
  },

  // ─── Catalogue ────────────────────────────────────────────────────────────
  {
    slug: 'regles-de-vente-quantite-minimale',
    module: 'catalogue',
    title: 'Fixer une quantité minimale et un incrément',
    summary: 'Imposer un minimum d’achat (ex. 6) et un pas (ex. par 2) sur un produit.',
    requiredPermission: 'catalog.manage',
    contexts: ['/admin/catalogue/[id]', '/admin/catalogue/nouveau'],
    watch: ['app/admin/(protected)/catalogue/[id]/ProductEditClient.tsx', 'lib/purchaseQuantityRules.ts'],
    blocks: [
      p('Une quantité est autorisée si elle atteint le minimum et respecte l’incrément après le minimum. Exemple : minimum 6 et incrément 2 autorisent 6, 8, 10…'),
      steps(
        'Ouvrez le produit dans **Produits**.',
        'Dans la section **Règles de vente**, renseignez **Quantité minimale** et **Incrément après le minimum**.',
        'Vérifiez la ligne « Quantités autorisées » juste dessous, puis cliquez sur **Enregistrer**.',
      ),
      info('Par défaut le minimum et l’incrément valent 1 : rien ne change tant que vous ne les modifiez pas. Les règles sont revérifiées au paiement.'),
      rel('groupes-de-quantite'),
    ],
  },
  {
    slug: 'groupes-de-quantite',
    module: 'catalogue',
    title: 'Créer un groupe de quantité (minimum commun)',
    summary: 'Exiger un minimum sur plusieurs produits combinables, par exemple 12 boissons.',
    requiredPermission: 'catalog.manage',
    contexts: ['/admin/catalogue/quantity-groups'],
    watch: ['app/admin/(protected)/catalogue/quantity-groups', 'lib/purchaseQuantityRules.ts'],
    blocks: [
      p('Un groupe applique un minimum au total de plusieurs produits : le client peut les mélanger. Les produits d’un groupe sont choisis un par un, jamais déduits des catégories.'),
      steps(
        'Dans **Produits**, ouvrez **Règles de quantité** (règles de quantité combinée).',
        'Cliquez sur **Nouveau groupe**, donnez-lui un nom (ex. Boissons) et indiquez la **Quantité minimale** et l’**Incrément**.',
        'Ajoutez les produits membres avec « Rechercher un produit à ajouter… » et vérifiez que **Activer le groupe** est coché.',
      ),
      info('La règle propre à un produit et celle d’un groupe sont vérifiées séparément. Dans le panier, le client voit sa progression vers le minimum du groupe.'),
      rel('regles-de-vente-quantite-minimale'),
    ],
  },
  {
    slug: 'dupliquer-un-produit',
    module: 'catalogue',
    title: 'Dupliquer un produit',
    summary: 'Partir d’un produit existant pour en créer un nouveau.',
    requiredPermission: 'catalog.manage',
    contexts: ['/admin/catalogue', '/admin/catalogue/nouveau'],
    watch: ['lib/catalog/productDuplication.ts', 'app/admin/(protected)/catalogue/nouveau', 'app/admin/(protected)/catalogue/CatalogueTable.tsx'],
    blocks: [
      steps(
        'Dans la liste des produits, ouvrez le menu de la ligne et choisissez **Dupliquer le produit**. Vous pouvez aussi, depuis « Nouveau produit », utiliser **Créer à partir d’un produit existant**.',
        'Le formulaire s’ouvre prérempli. Rien n’est enregistré tant que vous n’avez pas cliqué sur **Créer le produit**.',
        'Ajustez le nom, le prix et le stock, puis créez le produit.',
      ),
      info('Le nouveau produit démarre inactif, avec un stock de 0, sans promotion ni nouveauté et avec un nouvel identifiant d’adresse. Les campagnes, relations, coûts et historiques ne sont pas copiés.'),
    ],
  },
  {
    slug: 'petits-plus',
    module: 'catalogue',
    title: 'Choisir les « petits plus » proposés dans le panier',
    summary: 'Sélectionner et ordonner les produits d’appoint proposés aux clients.',
    requiredPermission: 'catalog.manage',
    contexts: ['/admin/catalogue/petits-plus'],
    watch: ['app/admin/(protected)/catalogue/petits-plus', 'lib/catalog/addOnShelf.ts'],
    blocks: [
      p('Les petits plus sont des produits d’appoint (chips, chocolats, épices…) proposés dans le panier et après un ajout. Seuls les produits actifs et en stock sont proposés, jamais ceux déjà dans le panier.'),
      steps(
        'Ouvrez **Petits plus** (section Produits).',
        'Cherchez un produit avec **Rechercher un produit** puis cliquez sur **Ajouter**.',
        'Réglez l’ordre de proposition : le premier de la liste est proposé en premier.',
        'Cliquez sur **Enregistrer**.',
      ),
      info('Conseil : des produits secs, légers et à petit prix, qui se gardent longtemps.'),
    ],
  },

  // ─── Promotions & nouveautés ──────────────────────────────────────────────
  {
    slug: 'creer-une-promotion-planifiee',
    module: 'promotions',
    title: 'Mettre un produit en promotion (avec dates)',
    summary: 'Définir un prix promo, des dates et la fin « jusqu’à épuisement des stocks ».',
    requiredPermission: 'catalog.manage',
    contexts: ['/admin/catalogue/[id]'],
    watch: ['app/admin/(protected)/catalogue/[id]/ProductHighlightsSection.tsx', 'lib/catalog/promotionSchedule.ts', 'lib/catalog/promotions.ts'],
    blocks: [
      steps(
        'Ouvrez le produit, section **Promotion**, et cochez **Mettre ce produit en promotion**.',
        'Saisissez le **Prix promo (€)** : il doit être inférieur au prix normal de la section Tarification. Le pourcentage de remise s’affiche.',
        'Renseignez si besoin **Début** et **Fin** (heure de Paris). Début vide : dès l’enregistrement. Fin vide : sans date de fin.',
        'Cochez **Jusqu’à épuisement des stocks** pour arrêter la promotion quand le stock ne permet plus d’acheter le minimum.',
        'Vérifiez l’encadré « Le client verra », puis cliquez sur **Enregistrer**.',
      ),
      info('Le prix change tout seul au début et à la fin (vérification toutes les 5 minutes). Avec « Jusqu’à épuisement des stocks », un réassort remet le produit au prix normal.'),
      rel('mettre-en-nouveaute'),
    ],
  },
  {
    slug: 'mettre-en-nouveaute',
    module: 'promotions',
    title: 'Afficher un produit comme nouveauté',
    summary: 'Ajouter le badge « Nouveau » pour une durée choisie.',
    requiredPermission: 'catalog.manage',
    contexts: ['/admin/catalogue/[id]'],
    watch: ['app/admin/(protected)/catalogue/[id]/ProductHighlightsSection.tsx', 'lib/catalog/novelties.ts'],
    blocks: [
      steps(
        'Ouvrez le produit, section **Nouveauté**, et cochez **Afficher comme nouveauté**.',
        'Choisissez une durée avec les boutons (7, 14 ou 30 jours) ou une date précise dans **Jusqu’au**.',
        'Cliquez sur **Enregistrer**.',
      ),
      info('Le badge « Nouveau » est retiré automatiquement à la date choisie.'),
      rel('creer-une-promotion-planifiee'),
    ],
  },

  // ─── Livraison ────────────────────────────────────────────────────────────
  {
    slug: 'forfait-livraison',
    module: 'livraison',
    title: 'Comprendre et modifier le forfait de livraison',
    summary: 'Modifier les prix de livraison par pays, avec versions conservées.',
    requiredPermission: 'shipping.view',
    contexts: ['/admin/livraison', '/admin/livraison/forfait'],
    watch: ['app/admin/(protected)/livraison/forfait', 'lib/shipping/tariff', 'docs/SHIPPING_FLAT_RATE_CHECKOUT.md'],
    blocks: [
      p('Avec un forfait actif, les clients paient le prix de la grille du pays de livraison. Sans forfait, ils paient le devis du transporteur.'),
      steps(
        'Ouvrez **Livraisons**, puis la page du forfait.',
        'Pour changer des prix, cliquez sur **Modifier les tarifs** sur la carte du pays.',
        'Vérifiez les changements, puis cliquez sur **Publier les nouveaux tarifs**.',
      ),
      info('Chaque publication crée une nouvelle version. Les précédentes restent consultables et peuvent être rétablies avec **Rétablir cette version**.'),
      warn('Une modification des prix invalide les devis ouverts : un client en cours de paiement peut devoir recalculer sa livraison. Pour revenir au devis du transporteur, utilisez **Revenir au devis transporteur**.'),
    ],
  },

  // ─── Paiements ────────────────────────────────────────────────────────────
  {
    slug: 'verifier-un-paiement-externe',
    module: 'paiements',
    title: 'Confirmer un paiement reçu hors carte (PayPal, virement…)',
    summary: 'Vérifier puis confirmer un paiement externe pour créer la commande.',
    requiredPermission: 'orders.view',
    contexts: ['/admin/paiements-en-attente/*', '/admin/checkout-funnel', '/admin/orders'],
    watch: ['app/admin/(protected)/paiements-en-attente', 'app/admin/(protected)/checkout-funnel', 'lib/payments'],
    blocks: [
      p('Quand un client paie hors Stripe, aucune commande n’existe avant votre confirmation.'),
      steps(
        'Ouvrez la demande de paiement en attente (depuis le bandeau des commandes ou le funnel de paiement).',
        'Contrôlez réellement la réception du paiement chez le prestataire externe.',
        'Seulement alors, utilisez **Confirmer réception** pour créer la commande.',
      ),
      warn('Confirmez uniquement après avoir constaté la réception. **Annuler la demande** retire la demande de la file mais n’annule ni ne rembourse un éventuel paiement déjà effectué.'),
      info('Votre rôle doit permettre de confirmer un paiement externe ; sinon la demande reste en consultation.'),
    ],
  },
  {
    slug: 'relancer-un-panier-carte',
    module: 'paiements',
    title: 'Relancer un client dont le paiement par carte n’a pas abouti',
    summary: 'Envoyer un rappel ou copier le lien « Retrouver mon panier ».',
    requiredPermission: 'orders.view',
    contexts: ['/admin/paiements-en-attente/*', '/admin/checkout-funnel'],
    watch: ['app/admin/(protected)/paiements-en-attente', 'lib/checkout/cartComeback.ts', 'lib/payments/cardCartOutcome.ts'],
    blocks: [
      steps(
        'Ouvrez le panier concerné depuis le funnel de paiement (« Paniers à relancer »).',
        'Cliquez sur **Relancer le client** puis **Envoyer un rappel**, ou copiez le lien avec **Copier le lien**.',
      ),
      info('Le rappel propose de reprendre l’achat et de payer avec la même carte, une autre carte ou un autre moyen. Le panier est reconstruit aux prix et stocks du jour.'),
      warn('Au plus 2 rappels par panier, et plus aucune relance après 14 jours. Sans adresse e-mail, seul le lien peut être copié.'),
    ],
  },

  // ─── Événementiel ─────────────────────────────────────────────────────────
  {
    slug: 'paiements-reservations-evenements',
    module: 'evenementiel',
    title: 'Suivre les réservations et les paiements externes à vérifier',
    summary: 'Voir les réservations confirmées et traiter les paiements externes.',
    requiredPermission: 'event_reservations.view',
    contexts: ['/admin/evenementiel/reservations'],
    watch: ['app/admin/(protected)/evenementiel/reservations'],
    blocks: [
      p('La page **Réservations / Paiements** réunit les réservations récentes et les paiements externes à vérifier.'),
      steps(
        'Ouvrez **Réservations / Paiements** dans l’espace Événementiel.',
        'Consultez les **Paiements à vérifier** : aucune place n’est réservée avant la confirmation manuelle du paiement externe.',
        'Retrouvez les **Réservations récentes** (les 50 dernières) pour suivre les réservations confirmées.',
      ),
      warn('Ne confirmez un paiement externe qu’après avoir constaté sa réception.'),
    ],
  },

  // ─── Paramètres & notifications ───────────────────────────────────────────
  {
    slug: 'notifications-equipe',
    module: 'parametres',
    title: 'Choisir qui reçoit les notifications de l’équipe',
    summary: 'Ajouter des destinataires et choisir leurs événements (e-mail, WhatsApp).',
    requiredPermission: 'tenant_settings.view',
    contexts: ['/admin/parametres/notifications'],
    watch: ['app/admin/(protected)/parametres/NotificationRecipientsSection.tsx', 'lib/notifications', 'docs/NOTIFICATION_SUBSCRIPTIONS.md'],
    blocks: [
      p('Chaque destinataire a sa fiche : e-mail, numéro WhatsApp éventuel et les événements qu’il souhaite recevoir.'),
      steps(
        'Ouvrez **Paramètres**, puis **Notifications**.',
        'Ajoutez un destinataire ou modifiez-en un existant.',
        'Dans la grille Événement × E-mail × WhatsApp, cochez les notifications voulues.',
        'Pour WhatsApp, saisissez le numéro personnel du destinataire au format international (ex. +39 333 123 4567), envoyez un message de test puis confirmez sa réception.',
      ),
      info('Un numéro WhatsApp doit être confirmé avant de recevoir des notifications. Supprimer un destinataire arrête toutes ses notifications ; l’historique des envois est conservé.'),
    ],
  },

  // ─── Gestion ──────────────────────────────────────────────────────────────
  {
    slug: 'gestion-du-commerce',
    module: 'gestion',
    title: 'Gestion : fournisseurs, achats, stocks et trésorerie',
    summary: 'Repérer les sections de Gestion et comprendre le lien avec le stock.',
    requiredPermission: 'suppliers.view',
    requiredFlag: 'business_management',
    contexts: ['/admin/gestion', '/admin/gestion/*'],
    watch: ['app/admin/(protected)/gestion', 'lib/gestion', 'docs/BUSINESS_MANAGEMENT.md'],
    blocks: [
      p('Gestion rassemble les fournisseurs, les achats, les stocks et la trésorerie. Elle n’apparaît que si elle est activée pour votre boutique.'),
      steps(
        'Ouvrez **Gestion** dans le menu.',
        'Utilisez les sections **Fournisseurs**, **Achats**, **Stocks** et **Trésorerie** selon votre besoin.',
      ),
      info('Le stock affiché dans la boutique reste celui des produits : une réception d’achat l’augmente et enregistre un mouvement de stock. Seuls les paiements fournisseurs vérifiés réduisent la dette envers un fournisseur.'),
    ],
  },
  // ─── Abonnement ───────────────────────────────────────────────────────────
  {
    slug: 'payer-mon-abonnement',
    module: 'general',
    title: 'Comment payer mon abonnement ?',
    summary: 'Régler l’abonnement par carte, PayPal ou virement et savoir quand l’échéance est prolongée.',
    requiredPermission: 'billing.view',
    contexts: ['/admin/billing'],
    watch: ['app/admin/(protected)/billing', 'lib/billing', 'docs/SUBSCRIPTION_LIFECYCLE.md'],
    blocks: [
      p('En haut de la page **Abonnement**, le bloc de paiement indique le montant, la date « Payé jusqu’au » et le mois que votre prochain paiement couvre.'),
      steps(
        'Ouvrez **Abonnement** dans le menu.',
        'Par PayPal (mode recommandé, si le bouton est présent) : cliquez sur **Payer avec PayPal** et indiquez la **Note à indiquer dans PayPal**. Lepefy prolonge l’échéance après avoir vérifié le paiement.',
        'Par carte : cliquez sur **Payer par carte**. Le paiement est traité par Stripe et l’échéance est prolongée automatiquement dès sa confirmation.',
        'Par virement : ouvrez **Virement bancaire** (**Voir les coordonnées bancaires**), copiez l’IBAN, le montant et la **Référence**, puis effectuez le virement depuis votre banque.',
      ),
      info('Indiquez exactement la référence : elle identifie votre établissement et le mois payé. Un virement est enregistré par Lepefy à réception (1 à 2 jours ouvrés).'),
      warn('Si l’abonnement est suspendu, seul le paiement par carte rétablit le service dès la confirmation de Stripe. PayPal et virement le rétablissent après vérification par Lepefy.'),
    ],
  },
];
