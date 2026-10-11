/**
 * Textes de l'adresse de livraison (checkout, compte, reprise de paiement),
 * en français simple. Un seul endroit pour les libellés, exemples et messages
 * d'erreur, partagés par le navigateur et le serveur.
 *
 * Quatre états distincts, jamais confondus :
 *  - adresse remplie (champs complets) ;
 *  - adresse remplie depuis la recherche (suggestion choisie, modifiable) ;
 *  - adresse enregistrée (compte client) ;
 *  - livraison possible (seul le devis de livraison le dit).
 */

export const ADDRESS_COPY = {
  title: 'Où doit-on livrer votre commande ?',
  allRequired: 'Tous les champs sont obligatoires, sauf « facultatif ».',
  optional: '(facultatif)',

  country: 'Pays',
  fullName: 'Nom et prénom du destinataire',
  fullNameExample: 'Ex. : Marie Kamga',
  street: 'Nom de la rue',
  streetHint: 'Écrivez le nom de votre rue',
  houseNumber: 'Numéro',
  noNumber: 'Pas de numéro',
  postalCode: 'Code postal',
  postalCodeHint: 'Vous ne connaissez pas le code postal ? Cherchez votre ville.',
  city: 'Ville',
  line2: "Complément d'adresse",
  line2Example: 'Ex. : interphone Rossi, 2e étage',

  searchLabel: 'Recherche rapide',
  searchHint: 'Choisissez une adresse dans la liste pour remplir les champs.',
  searchNotInList: "Votre adresse n'est pas dans la liste ? Écrivez-la dans les champs ci-dessous.",
  searchLoading: 'Recherche en cours…',
  searchNoResults: "Aucune adresse trouvée. Ce n'est pas grave : écrivez votre adresse dans les champs ci-dessous.",
  searchUnavailable: 'La recherche ne marche pas en ce moment. Écrivez votre adresse dans les champs ci-dessous.',
  searchClear: 'Effacer la recherche',
  searchAgain: 'Chercher une autre adresse',
  orWrite: 'ou écrivez votre adresse',
  noHouseNumberResult: 'sans numéro',
  filledFromSearch: 'Adresse remplie depuis la recherche. Vous pouvez tout modifier.',
  checkHouseNumber: 'Vérifiez le numéro de votre maison : la recherche ne l\'a pas trouvé.',

  cityHasManyPostalCodes: 'Cette ville a plusieurs codes postaux. Choisissez le vôtre :',
  cityHasTooManyPostalCodes: 'Cette ville a beaucoup de codes postaux : écrivez le vôtre.',
  otherPostalCode: 'Autre',
  useThisCity: 'Oui, utiliser',

  required: 'Complétez ce champ pour continuer.',
  houseNumberRequired: 'Écrivez le numéro de votre maison, ou cochez « Pas de numéro ».',
  tooLong: 'Ce texte est trop long. Raccourcissez-le.',
  countryUnsupported: 'Choisissez un pays de la liste.',

  quoteLoading: 'Nous calculons le prix de livraison…',
  deliveryAvailable: 'Nous livrons à cette adresse.',
  deliveryAvailablePostalCode: 'Nous livrons à ce code postal.',
  deliveryPriceLabel: 'Prix de livraison :',
  deliveryUnavailable: 'Nous ne livrons pas encore à ce code postal. Vérifiez le code postal.',

  savedAddresses: 'Vos adresses',
  chooseSaved: 'Choisissez une de vos adresses.',
  defaultBadge: 'Par défaut',
  otherAddress: 'Livrer à une autre adresse',
  otherAddressHint: 'Écrivez une nouvelle adresse',
  editAddress: 'Modifier mon adresse',
  edit: 'Modifier',
  newAddress: 'Nouvelle adresse',
  saved: 'Adresse enregistrée',
  makeDefault: 'Adresse par défaut',
  save: 'Enregistrer',
  saving: 'Enregistrement…',
} as const;

/** « Exemple : 42121 » selon le pays (voir POSTAL_RULES). */
export function postalCodeFormatMessage(countryLabel: string, digits: number | null, example: string): string {
  if (digits) return `En ${countryLabel}, le code postal a ${digits} chiffres. Exemple : ${example}`;
  return `Vérifiez le code postal. Exemple : ${example}`;
}

/** « 42100 : c'est bien Reggio nell'Emilia ? » */
export function postalCityQuestion(postalCode: string, city: string): string {
  return `${postalCode} : c'est bien ${city} ?`;
}

/** Annonce pour lecteur d'écran : « 3 adresses trouvées. » */
export function searchResultsAnnouncement(count: number): string {
  if (count === 0) return ADDRESS_COPY.searchNoResults;
  return count > 1
    ? `${count} adresses trouvées. Flèches haut et bas pour choisir, Entrée pour valider.`
    : '1 adresse trouvée. Entrée pour la choisir.';
}
