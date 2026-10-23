/**
 * Scénario « traiteur africain » de la Demo Experience (docs/DEMO_EXPERIENCE.md).
 *
 * Données UNIQUEMENT : aucune logique (scripts/demo/lib/buildPlan.mjs les
 * transforme en lignes). Tout est fictif : commerce, clients, prix, quantités.
 * Les plats sont des classiques de la cuisine d'Afrique de l'Ouest ; les prix
 * sont des exemples et ne représentent les tarifs d'aucun commerce réel.
 *
 * Contrat avec lib/demo/tours.ts : services « traiteur » et « location-materiel ».
 */

export const scenario = {
  key: 'traiteur-africain',
  version: 1,
  /** true = ne peut être chargé que sur une démo privée (nom d'un prospect). */
  requiresPrivate: false,

  tenant: {
    name: 'Le Comptoir de Mama (exemple)',
    tagline: 'Cuisine africaine, traiteur et événements — boutique de démonstration',
    city: 'Breuillet',
    country: 'FR',
    primary_color: '#B4532A',
    secondary_color: '#E0A526',
    accent_light: '#FBEDE5',
    click_collect_address: '1 rue de la Démo, 91650 Breuillet',
    click_collect_hours: 'Du mardi au samedi, 11 h – 14 h 30 et 17 h 30 – 21 h',
    flat_rate_amount: 5.9,
    story_heading: 'Une cuisine de partage',
    story_text: 'Boutique de démonstration Lepefy. Les plats, les prix et les disponibilités sont des exemples et ne correspondent à aucun commerce réel.',
    chatbox_extra_context: 'Boutique de démonstration. Plats chauds à retirer en boutique (mafé, yassa, poulet braisé, attiéké, alloco). Épicerie et boissons livrables. Service traiteur sur devis pour mariages, anniversaires et entreprises. Location de matériel pour réceptions.',
    legal_name: 'Lepefy — boutique de démonstration',
    legal_address: '1 rue de la Démo, 91650 Breuillet',
  },

  categories: [
    { slug: 'plats', name: 'Plats du jour' },
    { slug: 'grillades', name: 'Grillades et braisés' },
    { slug: 'accompagnements', name: 'Accompagnements' },
    { slug: 'formules', name: 'Formules et plateaux' },
    { slug: 'boissons', name: 'Boissons maison' },
    { slug: 'desserts', name: 'Desserts' },
    { slug: 'epicerie', name: 'Épicerie' },
  ],

  // [slug, catégorie, nom, prix, poids g, options]
  // options : pickup (plat chaud, retrait uniquement), stock, min/step, promo (prix barré),
  // novelty (nouveauté), addOn (petit plus), featured, storage.
  products: [
    ['mafe-boeuf', 'plats', 'Mafé de bœuf, riz blanc', 13.5, 650, { pickup: true, featured: true }],
    ['mafe-poulet', 'plats', 'Mafé de poulet, riz blanc', 12.5, 650, { pickup: true }],
    ['yassa-poulet', 'plats', 'Yassa poulet, riz parfumé', 13.0, 650, { pickup: true, featured: true, promo: 14.5 }],
    ['yassa-poisson', 'plats', 'Yassa poisson, riz parfumé', 14.5, 650, { pickup: true }],
    ['thieboudienne', 'plats', 'Thiéboudienne au poisson', 15.0, 700, { pickup: true, featured: true }],
    ['thiebou-yapp', 'plats', 'Thiébou yapp (riz à la viande)', 14.0, 700, { pickup: true }],
    ['sauce-arachide-agneau', 'plats', 'Sauce arachide à l’agneau', 15.5, 650, { pickup: true, novelty: true }],
    ['sauce-gombo', 'plats', 'Sauce gombo, poisson fumé', 13.5, 650, { pickup: true }],
    ['ndole', 'plats', 'Ndolé aux crevettes', 15.0, 650, { pickup: true }],
    ['poulet-dg', 'plats', 'Poulet DG', 14.5, 700, { pickup: true, novelty: true }],
    ['riz-jollof', 'plats', 'Riz jollof au poulet', 12.0, 650, { pickup: true, promo: 13.5 }],
    ['soupe-kandia', 'plats', 'Soupe kandia', 12.5, 600, { pickup: true }],
    ['poulet-braise', 'grillades', 'Poulet braisé entier, sauce oignons', 18.0, 1100, { pickup: true, featured: true }],
    ['demi-poulet-braise', 'grillades', 'Demi-poulet braisé', 10.5, 600, { pickup: true }],
    ['poisson-braise', 'grillades', 'Poisson braisé (tilapia)', 16.0, 800, { pickup: true }],
    ['brochettes-boeuf', 'grillades', 'Brochettes de bœuf (x4)', 9.5, 350, { pickup: true }],
    ['soya', 'grillades', 'Soya épicé', 8.5, 300, { pickup: true, novelty: true }],
    ['ailes-braisees', 'grillades', 'Ailes de poulet braisées (x8)', 9.0, 450, { pickup: true }],
    ['attieke-poisson', 'grillades', 'Attiéké poisson braisé', 14.0, 750, { pickup: true, featured: true }],
    ['attieke-poulet', 'grillades', 'Attiéké poulet braisé', 13.0, 750, { pickup: true }],
    ['alloco', 'accompagnements', 'Alloco (plantain frit)', 4.5, 250, { pickup: true, addOn: 1 }],
    ['attieke-portion', 'accompagnements', 'Attiéké nature', 3.5, 250, { pickup: true }],
    ['riz-blanc', 'accompagnements', 'Riz blanc', 3.0, 300, { pickup: true }],
    ['foutou-banane', 'accompagnements', 'Foutou banane', 4.5, 350, { pickup: true }],
    ['bobolo', 'accompagnements', 'Bâton de manioc (bobolo)', 3.5, 300, { pickup: true }],
    ['beignets-haricots', 'accompagnements', 'Beignets de haricots (accra, x6)', 4.0, 200, { pickup: true, addOn: 2 }],
    ['pastels-thon', 'accompagnements', 'Pastels au thon (x6)', 6.0, 250, { pickup: true }],
    ['salade-avocat', 'accompagnements', 'Salade avocat, tomate, oignon', 5.0, 300, { pickup: true }],
    ['plateau-10', 'formules', 'Plateau découverte 10 personnes', 120.0, 5000, { pickup: true, featured: true }],
    ['plateau-20', 'formules', 'Plateau réception 20 personnes', 230.0, 10000, { pickup: true }],
    ['formule-midi', 'formules', 'Formule midi (plat + boisson + dessert)', 16.5, 1100, { pickup: true, featured: true }],
    ['buffet-bouchees', 'formules', 'Bouchées apéritives (24 pièces)', 36.0, 1200, { pickup: true, novelty: true }],
    ['bissap-50', 'boissons', 'Jus de bissap maison 50 cl', 3.5, 550, { addOn: 3, min: 2, step: 1 }],
    ['bissap-1l', 'boissons', 'Jus de bissap maison 1 L', 6.0, 1100, {}],
    ['gingembre-50', 'boissons', 'Jus de gingembre maison 50 cl', 3.5, 550, { addOn: 4 }],
    ['gingembre-1l', 'boissons', 'Jus de gingembre maison 1 L', 6.0, 1100, { promo: 6.9 }],
    ['bouye-50', 'boissons', 'Jus de bouye (pain de singe) 50 cl', 4.0, 550, {}],
    ['tamarin-50', 'boissons', 'Jus de tamarin 50 cl', 3.5, 550, {}],
    ['malta-pack', 'boissons', 'Boisson maltée (pack de 6)', 9.0, 2100, { min: 1 }],
    ['eau-pack', 'boissons', 'Eau minérale 50 cl (pack de 6)', 3.0, 3100, {}],
    ['thiakry', 'desserts', 'Thiakry (dégué au lait)', 4.0, 200, { addOn: 5 }],
    ['beignets-sucres', 'desserts', 'Beignets sucrés (x6)', 4.0, 200, {}],
    ['gateau-coco', 'desserts', 'Gâteau coco', 3.5, 150, {}],
    ['salade-fruits', 'desserts', 'Salade de fruits exotiques', 4.5, 250, { pickup: true }],
    ['banane-flambee', 'desserts', 'Banane plantain caramélisée', 4.5, 200, { pickup: true, novelty: true }],
    ['piment-maison', 'epicerie', 'Sauce piment maison 200 g', 5.5, 250, {}],
    ['attieke-sec', 'epicerie', 'Attiéké déshydraté 1 kg', 6.5, 1000, {}],
    ['farine-mil', 'epicerie', 'Farine de mil 1 kg', 4.9, 1000, {}],
    ['huile-palme', 'epicerie', 'Huile de palme 1 L', 7.5, 950, {}],
    ['pate-arachide', 'epicerie', 'Pâte d’arachide 500 g', 5.9, 520, { promo: 6.9 }],
    ['fleurs-bissap', 'epicerie', 'Fleurs d’hibiscus séchées 200 g', 4.5, 220, {}],
    ['gombo-seche', 'epicerie', 'Gombo séché 100 g', 3.9, 110, {}],
    ['poisson-fume', 'epicerie', 'Poisson fumé 300 g', 8.9, 320, { storage: 'frozen' }],
    ['feuilles-manioc', 'epicerie', 'Feuilles de manioc pilées 1 kg', 6.5, 1000, { storage: 'frozen' }],
    ['plantain-mur', 'epicerie', 'Bananes plantain mûres (x3)', 3.9, 900, { storage: 'fresh' }],
    ['riz-brise', 'epicerie', 'Riz brisé parfumé 5 kg', 13.9, 5000, {}],
    ['cube-epices', 'epicerie', 'Bouillon en cubes (x60)', 3.2, 600, { addOn: 6 }],
    ['mix-epices-yassa', 'epicerie', 'Mélange d’épices pour yassa 100 g', 4.2, 110, { novelty: true }],
    ['kit-bissap', 'epicerie', 'Kit bissap maison (fleurs + sucre + menthe)', 9.9, 700, {}],
    ['carte-cadeau-25', 'epicerie', 'Bon cadeau 25 €', 25.0, 10, { stock: 999 }],
  ],

  services: {
    catering: {
      title: 'Traiteur',
      description: 'Mariages, anniversaires, baptêmes, repas d’entreprise : buffets et plateaux de cuisine africaine, sur devis. (Démonstration : formules et prix fictifs.)',
    },
    rental: {
      title: 'Location de matériel',
      description: 'Chaises, tables, chauffe-plats et vaisselle pour vos réceptions. (Démonstration : matériel et prix fictifs.)',
    },
  },

  // [nom, catégorie, prix unitaire, stock]
  rentalItems: [
    ['Chaise pliante blanche', 'Mobilier', 1.5, 120],
    ['Table ronde 8 personnes', 'Mobilier', 9.0, 15],
    ['Table rectangulaire 2 m', 'Mobilier', 7.0, 20],
    ['Nappe blanche ronde', 'Linge', 4.0, 30],
    ['Chauffe-plat inox', 'Service', 12.0, 12],
    ['Marmite 30 L', 'Cuisine', 15.0, 6],
    ['Lot de 10 assiettes', 'Vaisselle', 5.0, 40],
    ['Lot de 10 verres', 'Vaisselle', 4.0, 40],
    ['Lot de 10 couverts', 'Vaisselle', 3.0, 40],
    ['Plateau de service', 'Service', 2.5, 30],
    ['Glacière 50 L', 'Service', 8.0, 8],
    ['Barnum 3 × 3 m', 'Mobilier', 45.0, 3],
  ],

  // Demandes de devis : [clé, nom, date (jours depuis aujourd'hui), invités, statut, jours depuis la demande, message, note interne]
  inquiries: [
    ['mariage-80', 'Fatou et Julien (exemple)', 142, 80, 'devis_envoye', 9, 'Mariage de 80 invités. Buffet mafé, yassa, alloco et bissap. Service sur place souhaité.', 'Devis envoyé il y a 6 jours, relancer jeudi.'],
    ['anniversaire-35', 'Aminata K. (exemple)', 24, 35, 'nouveau', 1, 'Anniversaire des 40 ans, 35 personnes. Plateaux à emporter le samedi midi.', null],
    ['entreprise-50', 'Société Exemple SAS', 38, 50, 'a_contacter', 2, 'Déjeuner d’équipe pour 50 personnes, avec options végétariennes. Livraison à Évry.', null],
    ['bapteme-60', 'Famille Diallo (exemple)', 56, 60, 'accepte', 20, 'Baptême, 60 invités, buffet complet et location de chaises et chauffe-plats.', 'Acompte reçu par virement (hors plateforme).'],
    ['fiancailles-45', 'Moussa et Clara (exemple)', 90, 45, 'contacte', 5, 'Fiançailles, 45 personnes. Envie de poulet braisé et d’attiéké.', 'Appel le 18, attend la date définitive.'],
    ['seminaire-25', 'Association Exemple', 12, 25, 'devis_envoye', 4, 'Pause déjeuner d’un séminaire, 25 personnes.', null],
    ['communion-30', 'Famille Martin (exemple)', 70, 30, 'nouveau', 0, 'Communion, 30 personnes, plateaux et desserts.', null],
    ['soiree-asso-100', 'Collectif Exemple', 45, 100, 'refuse', 15, 'Soirée de 100 personnes avec service sur place.', 'Date déjà prise.'],
    ['anniv-enfant-20', 'Nadia B. (exemple)', -10, 20, 'clos', 30, 'Anniversaire enfant, 20 personnes.', 'Prestation réalisée.'],
    ['repas-famille-15', 'Koffi A. (exemple)', 8, 15, 'a_contacter', 1, 'Repas de famille, 15 personnes, à emporter.', null],
    ['mariage-120', 'Awa et Thomas (exemple)', 210, 120, 'contacte', 12, 'Mariage de 120 invités, cocktail et dîner.', 'Visite de dégustation à proposer.'],
    ['pot-depart-40', 'Entreprise Démo SARL', 18, 40, 'devis_envoye', 3, 'Pot de départ, bouchées apéritives pour 40 personnes.', null],
  ],

  // Soirées : [clé, titre, jours depuis aujourd'hui, capacité, statut, billets [libellé, prix], réservations]
  events: [
    ['degustation', 'Soirée dégustation — saveurs d’Afrique de l’Ouest', 12, 40, 'published', [['Adulte', 25], ['Enfant (- 12 ans)', 12]], 18],
    ['brunch', 'Brunch africain du dimanche', 26, 30, 'published', [['Formule brunch', 22]], 9],
    ['soiree-passee', 'Soirée musique et grillades', -20, 50, 'closed', [['Entrée + assiette', 20]], 41],
  ],

  // Fournisseurs (Gestion du commerce)
  suppliers: [
    { key: 'sup-epices', name: 'Épices du Sahel (exemple)', contact_name: 'Contact fictif', email: 'commandes@epices.example', country: 'FR' },
    { key: 'sup-volaille', name: 'Volailles de l’Essonne (exemple)', email: 'contact@volailles.example', country: 'FR' },
    { key: 'sup-poisson', name: 'Marée Exemple', email: 'pro@maree.example', country: 'FR' },
    { key: 'sup-import', name: 'Import Afrique Exemple', phone: '+33 6 39 98 00 01', country: 'FR' },
    { key: 'sup-boissons', name: 'Boissons Exemple', email: 'commandes@boissons.example', country: 'FR' },
    { key: 'sup-emballages', name: 'Emballages Exemple', email: 'contact@emballages.example', country: 'FR' },
  ],

  // Achats : [clé, fournisseur, statut, jours, [[slug | null, libellé, qté, coût]], réception ('all' | 'partial' | null), paiements [[jours, montant, moyen, vérifié]]]
  purchases: [
    ['ach-01', 'sup-import', 'ordered', 40, [['attieke-sec', null, 40, 3.2], ['farine-mil', null, 40, 2.4], ['huile-palme', null, 30, 3.9]], 'all', [[35, 'all', 'bank_transfer', true]]],
    ['ach-02', 'sup-epices', 'ordered', 33, [['mix-epices-yassa', null, 50, 1.8], ['cube-epices', null, 60, 1.4], ['fleurs-bissap', null, 40, 1.9]], 'all', [[30, 'all', 'card', true]]],
    ['ach-03', 'sup-poisson', 'ordered', 26, [['poisson-fume', null, 30, 4.2]], 'all', [[20, 100, 'bank_transfer', true]]],
    ['ach-04', 'sup-import', 'ordered', 21, [['pate-arachide', null, 40, 2.6], ['gombo-seche', null, 40, 1.5], ['riz-brise', null, 20, 7.4]], 'all', [[14, 200, 'bank_transfer', true], [6, 100, 'cash', true]]],
    ['ach-05', 'sup-boissons', 'ordered', 18, [['malta-pack', null, 30, 4.6], ['eau-pack', null, 40, 1.2]], 'all', []],
    ['ach-06', 'sup-emballages', 'ordered', 15, [[null, 'Barquettes isothermes (carton de 200)', 4, 38], [null, 'Sacs kraft (carton de 500)', 2, 29]], 'all', [[10, 'all', 'card', true]]],
    ['ach-07', 'sup-epices', 'ordered', 9, [['kit-bissap', null, 20, 4.1], ['piment-maison', null, 30, 1.9]], 'partial', [[3, 40, 'bank_transfer', false]]],
    ['ach-08', 'sup-import', 'ordered', 6, [['feuilles-manioc', null, 25, 2.9], ['plantain-mur', null, 40, 1.6]], 'partial', []],
    ['ach-09', 'sup-volaille', 'ordered', 4, [[null, 'Poulets entiers (colis de 10)', 6, 42]], null, []],
    ['ach-10', 'sup-boissons', 'draft', 1, [['eau-pack', null, 40, 1.2]], null, []],
  ],

  knowledge: [
    ['faq', 'Les plats chauds (mafé, yassa, braisés, attiéké) se retirent en boutique. L’épicerie et les boissons peuvent être livrées.'],
    ['faq', 'Pour un mariage, un anniversaire ou un repas d’entreprise, faites une demande de devis depuis la page Traiteur : nous répondons avec une proposition adaptée au nombre d’invités.'],
    ['faq', 'Le matériel de réception (chaises, tables, chauffe-plats, vaisselle) se loue en ligne et se retire en boutique.'],
    ['recipe', 'Le yassa est un plat sénégalais : poulet ou poisson mariné au citron et aux oignons, servi avec du riz.'],
    ['recipe', 'Le mafé est un ragoût à la pâte d’arachide, servi avec du riz blanc.'],
    ['cultural_context', 'L’attiéké est une semoule de manioc fermentée originaire de Côte d’Ivoire, souvent servie avec du poisson braisé.'],
    ['faq', 'Ceci est une boutique de démonstration : les commandes sont des commandes de test et aucun paiement réel n’est effectué.'],
  ],

  /** Volumes générés de façon déterministe. */
  volumes: { customers: 45, orders: 120, orderDays: 90, reviews: 16, nalaSessions: 28, rentalReservations: 6 },
};

export default scenario;
