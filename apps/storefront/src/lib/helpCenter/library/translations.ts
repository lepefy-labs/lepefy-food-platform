import type { HelpBlock, HelpLocale } from '../domain';

/**
 * Italian and English versions of the initial library. Same blocks, same order
 * and the SAME **bold** interface labels as the French source: the admin
 * interface itself is in French, so a guide in another language must name the
 * buttons exactly as the user sees them (enforced by a unit test).
 * Imported only as working copies; they reach tenants after a republication.
 */
export interface LibraryTranslation { title: string; summary: string; blocks: HelpBlock[] }
type Locale = Exclude<HelpLocale, 'fr'>;

const steps = (...items: string[]): HelpBlock => ({ type: 'steps', items });
const p = (text: string): HelpBlock => ({ type: 'paragraph', text });
const warn = (text: string): HelpBlock => ({ type: 'callout', tone: 'warning', text });
const info = (text: string): HelpBlock => ({ type: 'callout', tone: 'info', text });
const rel = (slug: string): HelpBlock => ({ type: 'related', slug });

export const LIBRARY_TRANSLATIONS: Record<string, Record<Locale, LibraryTranslation>> = {
  'preparer-une-commande': {
    it: {
      title: 'Preparare degli ordini',
      summary: 'Aprire una sessione di preparazione per più ordini insieme.',
      blocks: [
        p('Un ordine si prepara una volta pagato. La sessione di preparazione raggruppa gli articoli di più ordini per prelevarli in una sola volta.'),
        steps(
          'Aprite **Commandes** e selezionate gli ordini da preparare.',
          'Nella barra che appare, cliccate su **Préparer la sélection**.',
          'La sessione di preparazione mostra la lista raggruppata per prodotto, con il totale e la ripartizione per ordine. Gli ordini esclusi (non pagati, annullati, conflitto di stock) sono indicati con il motivo.',
          'Preparate gli articoli, poi confermate la preparazione secondo la modalità scelta dal vostro negozio (vedi la guida sulla modalità cartacea).',
        ),
        info('I prodotti freschi e surgelati sono messi in fondo alla lista.'),
        rel('imprimer-les-documents'),
        rel('mode-de-preparation-papier'),
      ],
    },
    en: {
      title: 'Prepare orders',
      summary: 'Open a preparation session for several orders at once.',
      blocks: [
        p('An order is prepared once it is paid. The preparation session groups the items of several orders so you can pick them in one go.'),
        steps(
          'Open **Commandes** and tick the orders to prepare.',
          'In the bar that appears, click **Préparer la sélection**.',
          'The preparation session shows the list grouped by product, with the total and the split per order. Excluded orders (unpaid, cancelled, stock conflict) are listed with the reason.',
          'Prepare the items, then confirm the preparation according to the mode chosen by your shop (see the guide on paper mode).',
        ),
        info('Fresh and frozen products are placed at the end of the list.'),
        rel('imprimer-les-documents'),
        rel('mode-de-preparation-papier'),
      ],
    },
  },
  'imprimer-les-documents': {
    it: {
      title: 'Stampare la lista di preparazione e il bon de colis',
      summary: 'Ottenere i PDF di uno o più ordini, in A5 o A4.',
      blocks: [
        p('Esistono due documenti: la lista di preparazione (uso interno) e il bon de colis (per il cliente, con un codice QR).'),
        steps(
          'Per un ordine: aprite il suo dettaglio e usate la sezione **Documents**. Scegliete il formato (A5 o A4) poi aprite il PDF.',
          'Per più ordini: selezionateli nella lista poi cliccate su **Documents…** (massimo 50 ordini per PDF).',
          'Il PDF si apre in una nuova scheda: stampatelo dal browser.',
        ),
        info('Il formato predefinito si imposta in Paramètres, sotto **Documents**. Gli ordini annullati non vengono stampati.'),
        rel('preparer-une-commande'),
      ],
    },
    en: {
      title: 'Print the picking list and the parcel slip',
      summary: 'Get the PDFs of one or several orders, in A5 or A4.',
      blocks: [
        p('There are two documents: the picking list (internal use) and the parcel slip (for the customer, with a QR code).'),
        steps(
          'For one order: open its detail and use the **Documents** section. Choose the format (A5 or A4) then open the PDF.',
          'For several orders: tick them in the list then click **Documents…** (50 orders maximum per PDF).',
          'The PDF opens in a new tab: print it from the browser.',
        ),
        info('The default format is set in Paramètres, under **Documents**. Cancelled orders are not printed.'),
        rel('preparer-une-commande'),
      ],
    },
  },
  'mode-de-preparation-papier': {
    it: {
      title: 'Scegliere la modalità di preparazione (Lepefy o carta)',
      summary: 'Spuntare gli articoli in Lepefy, su carta, oppure non registrare nulla.',
      blocks: [
        p('Scegliete come il vostro team conferma la preparazione e, separatamente, l\'imballaggio dei prodotti freschi e surgelati.'),
        steps(
          'Aprite **Paramètres**, poi **Préparation et emballage**.',
          'Per la checklist di preparazione scegliete **Validation article par article** (ogni prodotto è spuntato in Lepefy), **Préparation sur papier** (spuntate sul foglio e confermate « Préparation terminée » in Lepefy) oppure **Sans confirmation** (nessun controllo registrato).',
          'Per l\'imballaggio di freschi e surgelati scegliete **Contrôle dans Lepefy**, **Contrôle sur papier** oppure **Sans confirmation**.',
          'Cliccate su **Enregistrer**.',
        ),
        info('La modalità salvata si applica agli ordini la cui preparazione non è ancora iniziata. Serve il permesso di gestire le impostazioni per modificarla.'),
        warn('Con « Sans confirmation » sull\'imballaggio a freddo, Lepefy non conserva alcuna traccia del controllo della catena del freddo. Preferite « Contrôle sur papier » se spedite surgelati.'),
      ],
    },
    en: {
      title: 'Choose the preparation mode (Lepefy or paper)',
      summary: 'Tick items in Lepefy, on paper, or record nothing.',
      blocks: [
        p('You choose how your team confirms preparation and, separately, the packing of fresh and frozen products.'),
        steps(
          'Open **Paramètres**, then **Préparation et emballage**.',
          'For the preparation checklist choose **Validation article par article** (each product is ticked in Lepefy), **Préparation sur papier** (you tick on the sheet and confirm « Préparation terminée » in Lepefy) or **Sans confirmation** (no check is recorded).',
          'For the packing of fresh and frozen products choose **Contrôle dans Lepefy**, **Contrôle sur papier** or **Sans confirmation**.',
          'Click **Enregistrer**.',
        ),
        info('The saved mode applies to orders whose preparation has not started yet. You need the permission to manage settings to change it.'),
        warn('With « Sans confirmation » on cold packing, Lepefy keeps no trace of the cold-chain check. Prefer « Contrôle sur papier » if you ship frozen goods.'),
      ],
    },
  },
  'cloturer-ou-annuler-une-commande': {
    it: {
      title: 'Chiudere o annullare un ordine',
      summary: 'Annullare un ordine o segnarlo come gestito fuori dalla piattaforma.',
      blocks: [
        p('È l\'unico modo per annullare un ordine. Si possono chiudere solo gli ordini nuovi, in preparazione o pronti per il ritiro.'),
        steps(
          'Aprite il dettaglio dell\'ordine e cliccate su **Clôturer ou annuler…**.',
          'Passo 1: scegliete il motivo, aggiungete una nota interna se serve, poi decidete la comunicazione al cliente: nessuna, l\'e-mail standard « commande annulée », o un messaggio personalizzato.',
          'Passo 2: controllate gli avvisi e il riepilogo, poi confermate con **Clôturer la commande** (gestito fuori piattaforma) oppure **Annuler la commande**.',
        ),
        warn('La chiusura non modifica il pagamento: non rimborsa nulla, non rimette lo stock e non tocca Packlink. Se una spedizione è già presa in carico dal corriere, la chiusura è bloccata.'),
        info('Un ordine « traité hors plateforme » non è né una vendita persa né un fatturato della piattaforma.'),
      ],
    },
    en: {
      title: 'Close or cancel an order',
      summary: 'Cancel an order or mark it as handled outside the platform.',
      blocks: [
        p('This is the only way to cancel an order. Only new orders, orders in preparation or orders ready for pickup can be closed.'),
        steps(
          'Open the order detail and click **Clôturer ou annuler…**.',
          'Step 1: choose the reason, add an internal note if needed, then decide the message to the customer: none, the standard « commande annulée » e-mail, or a custom message.',
          'Step 2: check the warnings and the summary, then confirm with **Clôturer la commande** (handled outside the platform) or **Annuler la commande**.',
        ),
        warn('Closing does not change the payment: it refunds nothing, does not restore stock and does not touch Packlink. If a shipment is already with the carrier, closing is blocked.'),
        info('An order « traité hors plateforme » is neither a lost sale nor platform revenue.'),
      ],
    },
  },
  'creer-une-commande-assistee': {
    it: {
      title: 'Registrare un ordine ricevuto via WhatsApp o telefono',
      summary: 'Creare un preordine e inviare un link di pagamento al cliente.',
      blocks: [
        p('Un ordine registrato dal team è prima di tutto un preordine: l\'ordine esiste solo dopo la conferma del pagamento.'),
        steps(
          'In **Commandes**, cliccate su **Nouvelle commande**.',
          'Aggiungete i prodotti, il contatto e l\'indirizzo (codice postale e paese), poi cliccate su **Calculer les frais**.',
          'Salvate: potete **Enregistrer comme brouillon**, oppure creare il preordine con il suo link di pagamento da inviare al cliente.',
          'Se il cliente dice di aver già pagato (bonifico, PayPal…), usate **Déjà payé** dopo aver controllato la ricezione del pagamento.',
        ),
        warn('Confermate un pagamento solo dopo aver effettivamente constatato la sua ricezione.'),
      ],
    },
    en: {
      title: 'Enter an order received by WhatsApp or phone',
      summary: 'Create a pre-order and send a payment link to the customer.',
      blocks: [
        p('An order entered by the team is first a pre-order: the order only exists once the payment is confirmed.'),
        steps(
          'In **Commandes**, click **Nouvelle commande**.',
          'Add the products, the contact and the address (postal code and country), then click **Calculer les frais**.',
          'Save: you can **Enregistrer comme brouillon**, or create the pre-order with its payment link to send to the customer.',
          'If the customer says they have already paid (bank transfer, PayPal…), use **Déjà payé** after checking that the payment was received.',
        ),
        warn('Only confirm a payment after you have actually seen it arrive.'),
      ],
    },
  },
  'regles-de-vente-quantite-minimale': {
    it: {
      title: 'Impostare una quantità minima e un incremento',
      summary: 'Imporre un minimo d\'acquisto (es. 6) e un passo (es. di 2) su un prodotto.',
      blocks: [
        p('Una quantità è ammessa se raggiunge il minimo e rispetta l\'incremento dopo il minimo. Esempio: minimo 6 e incremento 2 ammettono 6, 8, 10…'),
        steps(
          'Aprite il prodotto in **Produits**.',
          'Nella sezione **Règles de vente**, compilate **Quantité minimale** e **Incrément après le minimum**.',
          'Controllate la riga « Quantités autorisées » subito sotto, poi cliccate su **Enregistrer**.',
        ),
        info('Per impostazione predefinita minimo e incremento valgono 1: nulla cambia finché non li modificate. Le regole vengono ricontrollate al pagamento.'),
        rel('groupes-de-quantite'),
      ],
    },
    en: {
      title: 'Set a minimum quantity and a step',
      summary: 'Require a minimum purchase (e.g. 6) and a step (e.g. by 2) on a product.',
      blocks: [
        p('A quantity is allowed if it reaches the minimum and respects the step after the minimum. Example: minimum 6 and step 2 allow 6, 8, 10…'),
        steps(
          'Open the product in **Produits**.',
          'In the **Règles de vente** section, fill in **Quantité minimale** and **Incrément après le minimum**.',
          'Check the « Quantités autorisées » line just below, then click **Enregistrer**.',
        ),
        info('By default the minimum and the step are 1: nothing changes until you edit them. The rules are checked again at payment.'),
        rel('groupes-de-quantite'),
      ],
    },
  },
  'groupes-de-quantite': {
    it: {
      title: 'Creare un gruppo di quantità (minimo comune)',
      summary: 'Richiedere un minimo su più prodotti combinabili, ad esempio 12 bevande.',
      blocks: [
        p('Un gruppo applica un minimo al totale di più prodotti: il cliente può mescolarli. I prodotti di un gruppo si scelgono uno a uno, mai dedotti dalle categorie.'),
        steps(
          'In **Produits**, aprite **Règles de quantité** (regole di quantità combinata).',
          'Cliccate su **Nouveau groupe**, datele un nome (es. Boissons) e indicate la **Quantité minimale** e l\'**Incrément**.',
          'Aggiungete i prodotti membri con « Rechercher un produit à ajouter… » e verificate che **Activer le groupe** sia spuntato.',
        ),
        info('La regola propria di un prodotto e quella di un gruppo sono verificate separatamente. Nel carrello il cliente vede il suo avanzamento verso il minimo del gruppo.'),
        rel('regles-de-vente-quantite-minimale'),
      ],
    },
    en: {
      title: 'Create a quantity group (shared minimum)',
      summary: 'Require a minimum across several combinable products, for example 12 drinks.',
      blocks: [
        p('A group applies a minimum to the total of several products: the customer can mix them. Products of a group are chosen one by one, never inferred from categories.'),
        steps(
          'In **Produits**, open **Règles de quantité** (combined quantity rules).',
          'Click **Nouveau groupe**, give it a name (e.g. Boissons) and set the **Quantité minimale** and the **Incrément**.',
          'Add the member products with « Rechercher un produit à ajouter… » and check that **Activer le groupe** is ticked.',
        ),
        info('A product\'s own rule and a group rule are checked separately. In the cart the customer sees their progress towards the group minimum.'),
        rel('regles-de-vente-quantite-minimale'),
      ],
    },
  },
  'dupliquer-un-produit': {
    it: {
      title: 'Duplicare un prodotto',
      summary: 'Partire da un prodotto esistente per crearne uno nuovo.',
      blocks: [
        steps(
          'Nella lista dei prodotti, aprite il menu della riga e scegliete **Dupliquer le produit**. Da « Nouveau produit » potete anche usare **Créer à partir d’un produit existant**.',
          'Il modulo si apre precompilato. Nulla viene salvato finché non cliccate su **Créer le produit**.',
          'Regolate nome, prezzo e stock, poi create il prodotto.',
        ),
        info('Il nuovo prodotto parte inattivo, con stock 0, senza promozione né novità e con un nuovo indirizzo (slug). Campagne, relazioni, costi e storici non vengono copiati.'),
      ],
    },
    en: {
      title: 'Duplicate a product',
      summary: 'Start from an existing product to create a new one.',
      blocks: [
        steps(
          'In the product list, open the row menu and choose **Dupliquer le produit**. From « Nouveau produit » you can also use **Créer à partir d’un produit existant**.',
          'The form opens pre-filled. Nothing is saved until you click **Créer le produit**.',
          'Adjust the name, price and stock, then create the product.',
        ),
        info('The new product starts inactive, with stock 0, no promotion or novelty and a new address (slug). Campaigns, relations, costs and history are not copied.'),
      ],
    },
  },
  'petits-plus': {
    it: {
      title: 'Scegliere i « petits plus » proposti nel carrello',
      summary: 'Selezionare e ordinare i prodotti d\'impulso proposti ai clienti.',
      blocks: [
        p('I petits plus sono prodotti d\'impulso (patatine, cioccolatini, spezie…) proposti nel carrello e dopo un\'aggiunta. Sono proposti solo prodotti attivi e disponibili, mai quelli già nel carrello.'),
        steps(
          'Aprite **Petits plus** (sezione Produits).',
          'Cercate un prodotto con **Rechercher un produit** poi cliccate su **Ajouter**.',
          'Regolate l\'ordine di proposta: il primo della lista è proposto per primo.',
          'Cliccate su **Enregistrer**.',
        ),
        info('Consiglio: prodotti secchi, leggeri e a basso prezzo, che si conservano a lungo.'),
      ],
    },
    en: {
      title: 'Choose the « petits plus » offered in the cart',
      summary: 'Select and order the impulse products offered to customers.',
      blocks: [
        p('Petits plus are impulse products (crisps, chocolates, spices…) offered in the cart and after an add. Only active products in stock are offered, never those already in the cart.'),
        steps(
          'Open **Petits plus** (Produits section).',
          'Search for a product with **Rechercher un produit** then click **Ajouter**.',
          'Set the offer order: the first in the list is offered first.',
          'Click **Enregistrer**.',
        ),
        info('Tip: dry, light, low-priced products that keep for a long time.'),
      ],
    },
  },
  'creer-une-promotion-planifiee': {
    it: {
      title: 'Mettere un prodotto in promozione (con date)',
      summary: 'Definire un prezzo promo, le date e la fine « jusqu\'à épuisement des stocks ».',
      blocks: [
        steps(
          'Aprite il prodotto, sezione **Promotion**, e spuntate **Mettre ce produit en promotion**.',
          'Inserite il **Prix promo (€)**: deve essere inferiore al prezzo normale della sezione Tarification. Viene mostrata la percentuale di sconto.',
          'Se serve, compilate **Début** e **Fin** (ora di Parigi). Début vuoto: dal salvataggio. Fin vuoto: senza data di fine.',
          'Spuntate **Jusqu’à épuisement des stocks** per fermare la promozione quando lo stock non permette più di acquistare il minimo.',
          'Controllate il riquadro « Le client verra », poi cliccate su **Enregistrer**.',
        ),
        info('Il prezzo cambia da solo all\'inizio e alla fine (controllo ogni 5 minuti). Con « Jusqu\'à épuisement des stocks », un rifornimento riporta il prodotto al prezzo normale.'),
        rel('mettre-en-nouveaute'),
      ],
    },
    en: {
      title: 'Put a product on promotion (with dates)',
      summary: 'Set a promo price, dates and the « jusqu\'à épuisement des stocks » end.',
      blocks: [
        steps(
          'Open the product, **Promotion** section, and tick **Mettre ce produit en promotion**.',
          'Enter the **Prix promo (€)**: it must be lower than the normal price in the Tarification section. The discount percentage is shown.',
          'If needed, fill in **Début** and **Fin** (Paris time). Empty Début: from the moment you save. Empty Fin: no end date.',
          'Tick **Jusqu’à épuisement des stocks** to stop the promotion when the stock no longer allows buying the minimum.',
          'Check the « Le client verra » box, then click **Enregistrer**.',
        ),
        info('The price changes by itself at the start and at the end (checked every 5 minutes). With « Jusqu\'à épuisement des stocks », a restock puts the product back at the normal price.'),
        rel('mettre-en-nouveaute'),
      ],
    },
  },
  'mettre-en-nouveaute': {
    it: {
      title: 'Mostrare un prodotto come novità',
      summary: 'Aggiungere il badge « Nouveau » per una durata scelta.',
      blocks: [
        steps(
          'Aprite il prodotto, sezione **Nouveauté**, e spuntate **Afficher comme nouveauté**.',
          'Scegliete una durata con i pulsanti (7, 14 o 30 giorni) oppure una data precisa in **Jusqu’au**.',
          'Cliccate su **Enregistrer**.',
        ),
        info('Il badge « Nouveau » viene rimosso automaticamente alla data scelta.'),
        rel('creer-une-promotion-planifiee'),
      ],
    },
    en: {
      title: 'Show a product as new',
      summary: 'Add the « Nouveau » badge for a chosen duration.',
      blocks: [
        steps(
          'Open the product, **Nouveauté** section, and tick **Afficher comme nouveauté**.',
          'Choose a duration with the buttons (7, 14 or 30 days) or a precise date in **Jusqu’au**.',
          'Click **Enregistrer**.',
        ),
        info('The « Nouveau » badge is removed automatically on the chosen date.'),
        rel('creer-une-promotion-planifiee'),
      ],
    },
  },
  'forfait-livraison': {
    it: {
      title: 'Capire e modificare il forfait di spedizione',
      summary: 'Modificare i prezzi di spedizione per paese, con versioni conservate.',
      blocks: [
        p('Con un forfait attivo, i clienti pagano il prezzo della griglia del paese di consegna. Senza forfait, pagano il preventivo del corriere.'),
        steps(
          'Aprite **Livraisons**, poi la pagina del forfait.',
          'Per cambiare dei prezzi, cliccate su **Modifier les tarifs** sulla scheda del paese.',
          'Controllate le modifiche, poi cliccate su **Publier les nouveaux tarifs**.',
        ),
        info('Ogni pubblicazione crea una nuova versione. Le precedenti restano consultabili e si possono ripristinare con **Rétablir cette version**.'),
        warn('Una modifica dei prezzi invalida i preventivi aperti: un cliente in fase di pagamento può dover ricalcolare la spedizione. Per tornare al preventivo del corriere, usate **Revenir au devis transporteur**.'),
      ],
    },
    en: {
      title: 'Understand and edit the flat-rate shipping',
      summary: 'Edit shipping prices by country, with versions kept.',
      blocks: [
        p('With an active flat rate, customers pay the grid price of the delivery country. Without it, they pay the carrier quote.'),
        steps(
          'Open **Livraisons**, then the flat-rate page.',
          'To change prices, click **Modifier les tarifs** on the country card.',
          'Check the changes, then click **Publier les nouveaux tarifs**.',
        ),
        info('Each publication creates a new version. Previous ones stay available and can be restored with **Rétablir cette version**.'),
        warn('A price change invalidates open quotes: a customer in the middle of paying may have to recompute shipping. To go back to the carrier quote, use **Revenir au devis transporteur**.'),
      ],
    },
  },
  'verifier-un-paiement-externe': {
    it: {
      title: 'Confermare un pagamento ricevuto fuori carta (PayPal, bonifico…)',
      summary: 'Verificare e poi confermare un pagamento esterno per creare l\'ordine.',
      blocks: [
        p('Quando un cliente paga fuori da Stripe, nessun ordine esiste prima della vostra conferma.'),
        steps(
          'Aprite la richiesta di pagamento in attesa (dal banner degli ordini o dal funnel di pagamento).',
          'Controllate davvero la ricezione del pagamento presso il fornitore esterno.',
          'Solo allora, usate **Confirmer réception** per creare l\'ordine.',
        ),
        warn('Confermate solo dopo aver constatato la ricezione. **Annuler la demande** toglie la richiesta dalla coda ma non annulla né rimborsa un eventuale pagamento già effettuato.'),
        info('Il vostro ruolo deve consentire di confermare un pagamento esterno; altrimenti la richiesta resta in sola consultazione.'),
      ],
    },
    en: {
      title: 'Confirm a payment received outside card (PayPal, transfer…)',
      summary: 'Check then confirm an external payment to create the order.',
      blocks: [
        p('When a customer pays outside Stripe, no order exists before you confirm.'),
        steps(
          'Open the pending payment request (from the orders banner or the payment funnel).',
          'Really check that the payment was received at the external provider.',
          'Only then, use **Confirmer réception** to create the order.',
        ),
        warn('Only confirm after seeing the payment arrive. **Annuler la demande** removes the request from the queue but neither cancels nor refunds a payment that may already have been made.'),
        info('Your role must allow confirming an external payment; otherwise the request stays read-only.'),
      ],
    },
  },
  'relancer-un-panier-carte': {
    it: {
      title: 'Sollecitare un cliente il cui pagamento con carta non è andato a buon fine',
      summary: 'Inviare un promemoria o copiare il link « Retrouver mon panier ».',
      blocks: [
        steps(
          'Aprite il carrello interessato dal funnel di pagamento (« Paniers à relancer »).',
          'Cliccate su **Relancer le client** poi **Envoyer un rappel**, oppure copiate il link con **Copier le lien**.',
        ),
        info('Il promemoria propone di riprendere l\'acquisto e di pagare con la stessa carta, un\'altra carta o un altro mezzo. Il carrello viene ricostruito ai prezzi e agli stock del giorno.'),
        warn('Al massimo 2 promemoria per carrello, e nessun sollecito dopo 14 giorni. Senza indirizzo e-mail, si può solo copiare il link.'),
      ],
    },
    en: {
      title: 'Follow up a customer whose card payment failed',
      summary: 'Send a reminder or copy the « Retrouver mon panier » link.',
      blocks: [
        steps(
          'Open the cart concerned from the payment funnel (« Paniers à relancer »).',
          'Click **Relancer le client** then **Envoyer un rappel**, or copy the link with **Copier le lien**.',
        ),
        info('The reminder offers to resume the purchase and pay with the same card, another card or another method. The cart is rebuilt at today\'s prices and stock.'),
        warn('At most 2 reminders per cart, and no follow-up after 14 days. Without an e-mail address, only the link can be copied.'),
      ],
    },
  },
  'paiements-reservations-evenements': {
    it: {
      title: 'Seguire le prenotazioni e i pagamenti esterni da verificare',
      summary: 'Vedere le prenotazioni confermate e gestire i pagamenti esterni.',
      blocks: [
        p('La pagina **Réservations / Paiements** riunisce le prenotazioni recenti e i pagamenti esterni da verificare.'),
        steps(
          'Aprite **Réservations / Paiements** nello spazio Événementiel.',
          'Consultate i **Paiements à vérifier**: nessun posto è riservato prima della conferma manuale del pagamento esterno.',
          'Ritrovate le **Réservations récentes** (le ultime 50) per seguire le prenotazioni confermate.',
        ),
        warn('Confermate un pagamento esterno solo dopo aver constatato la sua ricezione.'),
      ],
    },
    en: {
      title: 'Follow reservations and external payments to check',
      summary: 'See confirmed reservations and handle external payments.',
      blocks: [
        p('The **Réservations / Paiements** page gathers recent reservations and the external payments to check.'),
        steps(
          'Open **Réservations / Paiements** in the Événementiel space.',
          'Review the **Paiements à vérifier**: no seat is reserved before the external payment is manually confirmed.',
          'Find the **Réservations récentes** (the last 50) to follow confirmed reservations.',
        ),
        warn('Only confirm an external payment after seeing it arrive.'),
      ],
    },
  },
  'notifications-equipe': {
    it: {
      title: 'Scegliere chi riceve le notifiche del team',
      summary: 'Aggiungere destinatari e scegliere i loro eventi (e-mail, WhatsApp).',
      blocks: [
        p('Ogni destinatario ha la sua scheda: e-mail, eventuale numero WhatsApp e gli eventi che desidera ricevere.'),
        steps(
          'Aprite **Paramètres**, poi **Notifications**.',
          'Aggiungete un destinatario o modificatene uno esistente.',
          'Nella griglia Evento × E-mail × WhatsApp, spuntate le notifiche desiderate.',
          'Per WhatsApp, inserite il numero personale del destinatario in formato internazionale (es. +39 333 123 4567), inviate un messaggio di prova poi confermate la ricezione.',
        ),
        info('Un numero WhatsApp deve essere confermato prima di ricevere notifiche. Eliminare un destinatario ferma tutte le sue notifiche; lo storico degli invii viene conservato.'),
      ],
    },
    en: {
      title: 'Choose who receives team notifications',
      summary: 'Add recipients and choose their events (e-mail, WhatsApp).',
      blocks: [
        p('Each recipient has their own card: e-mail, optional WhatsApp number and the events they want to receive.'),
        steps(
          'Open **Paramètres**, then **Notifications**.',
          'Add a recipient or edit an existing one.',
          'In the Event × E-mail × WhatsApp grid, tick the wanted notifications.',
          'For WhatsApp, enter the recipient\'s personal number in international format (e.g. +39 333 123 4567), send a test message then confirm it was received.',
        ),
        info('A WhatsApp number must be confirmed before it receives notifications. Deleting a recipient stops all their notifications; the sending history is kept.'),
      ],
    },
  },
  'gestion-du-commerce': {
    it: {
      title: 'Gestion: fornitori, acquisti, stock e tesoreria',
      summary: 'Individuare le sezioni di Gestion e capire il legame con lo stock.',
      blocks: [
        p('Gestion riunisce fornitori, acquisti, stock e tesoreria. Appare solo se è attivata per il vostro negozio.'),
        steps(
          'Aprite **Gestion** nel menu.',
          'Usate le sezioni **Fournisseurs**, **Achats**, **Stocks** e **Trésorerie** secondo la vostra esigenza.',
        ),
        info('Lo stock mostrato nel negozio resta quello dei prodotti: una ricezione d\'acquisto lo aumenta e registra un movimento di stock. Solo i pagamenti fornitore verificati riducono il debito verso un fornitore.'),
      ],
    },
    en: {
      title: 'Gestion: suppliers, purchases, stock and treasury',
      summary: 'Find the Gestion sections and understand the link with stock.',
      blocks: [
        p('Gestion gathers suppliers, purchases, stock and treasury. It only appears if it is enabled for your shop.'),
        steps(
          'Open **Gestion** in the menu.',
          'Use the **Fournisseurs**, **Achats**, **Stocks** and **Trésorerie** sections as needed.',
        ),
        info('The stock shown in the shop remains the products\' stock: a purchase receipt increases it and records a stock movement. Only verified supplier payments reduce the debt to a supplier.'),
      ],
    },
  },
  'payer-mon-abonnement': {
    it: {
      title: 'Come pagare il mio abbonamento?',
      summary: 'Pagare l\'abbonamento con carta, PayPal o bonifico e sapere quando la scadenza viene prorogata.',
      blocks: [
        p('In alto nella pagina **Abonnement**, il blocco di pagamento indica l\'importo, la data « Payé jusqu\'au » e il mese coperto dal prossimo pagamento.'),
        steps(
          'Aprite **Abonnement** nel menu.',
          'Con PayPal (consigliato, se il pulsante è presente): cliccate su **Payer avec PayPal** e indicate la **Note à indiquer dans PayPal**. Lepefy proroga la scadenza dopo aver verificato il pagamento.',
          'Con carta: cliccate su **Payer par carte**. Il pagamento è gestito da Stripe e la scadenza viene prorogata automaticamente alla sua conferma.',
          'Con bonifico: aprite **Virement bancaire** (**Voir les coordonnées bancaires**), copiate IBAN, importo e **Référence**, poi effettuate il bonifico dalla vostra banca.',
        ),
        info('Indicate esattamente la causale: identifica il vostro esercizio e il mese pagato. Un bonifico viene registrato da Lepefy alla ricezione (1-2 giorni lavorativi).'),
        warn('Se l\'abbonamento è sospeso, solo il pagamento con carta ripristina il servizio alla conferma di Stripe. PayPal e bonifico lo ripristinano dopo la verifica di Lepefy.'),
      ],
    },
    en: {
      title: 'How do I pay my subscription?',
      summary: 'Pay the subscription by card, PayPal or bank transfer and know when the due date is extended.',
      blocks: [
        p('At the top of the **Abonnement** page, the payment block shows the amount, the « Payé jusqu\'au » date and the month your next payment covers.'),
        steps(
          'Open **Abonnement** in the menu.',
          'By PayPal (recommended, if the button is shown): click **Payer avec PayPal** and enter the **Note à indiquer dans PayPal**. Lepefy extends the due date after checking the payment.',
          'By card: click **Payer par carte**. Stripe processes the payment and the due date is extended automatically once it is confirmed.',
          'By bank transfer: open **Virement bancaire** (**Voir les coordonnées bancaires**), copy the IBAN, the amount and the **Référence**, then make the transfer from your bank.',
        ),
        info('Enter the reference exactly: it identifies your business and the month paid. Lepefy records a bank transfer when it is received (1 to 2 working days).'),
        warn('If the subscription is suspended, only a card payment restores the service as soon as Stripe confirms it. PayPal and bank transfer restore it after Lepefy has checked the payment.'),
      ],
    },
  },
};
