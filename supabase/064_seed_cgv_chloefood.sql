-- 064_seed_cgv_chloefood.sql
-- Seed CGV v1.0 per tenant chloefood in tenant_legal_documents.
-- Testo definitivo (versione "pubblicabile", senza note di lavoro interne) —
-- resta comunque da sottoporre a revisione legale prima del go-live.
-- Unico dato mancante nel testo: forma giuridica / P.IVA di Chloé Food (articolo 1).
-- Se il testo cambia dopo revisione legale, NON fare UPDATE su questa riga:
-- inserire una nuova riga con version = 2 (append-only, come da design ciclo 1).

insert into public.tenant_legal_documents (tenant_id, doc_type, version, content, effective_date)
select
  t.id,
  'terms',
  1,
  $cgv$# Conditions Générales de Vente (CGV)

## 1. Objet et champ d'application

Les présentes Conditions Générales de Vente (« CGV ») régissent l'ensemble des ventes de produits et de services conclues à distance sur le site shop.chloefood.com (le « Site »), exploité par :

**Chloé Food**, ayant son siège à Via Angelo Zanti, 1C — 42122 Reggio Emilia (RE), Italia
P.IVA: *03104260355*
Email : chloefood.ets@gmail.com

Le Site est édité sur la plateforme technique Lepefy, opérée par Lepefy Labs (« l'Opérateur technique »), prestataire de Chloé Food agissant en qualité de sous-traitant technique au sens de l'article 28 du RGPD.

Toute commande passée sur le Site implique l'acceptation pleine, entière et sans réserve des présentes CGV par le client, dans leur version en vigueur à la date de la commande. Les CGV sont accessibles à tout moment sur le Site et peuvent être enregistrées ou imprimées par le client.

## 2. Produits et services concernés

Les présentes CGV s'appliquent à :

a) la vente de produits alimentaires (frais, surgelés, épicerie fine) proposés dans la Boutique du Site ;
b) la vente de billets et formules pour les événements organisés ou relayés par Chloé Food via le module Événementiel, selon les conditions particulières de l'article 9 ;
c) le cas échéant, la vente de prestations de traiteur ou de location, selon les conditions particulières de l'article 9 bis.

En cas de contradiction entre les présentes CGV générales et une condition particulière prévue à l'article 9 ou 9 bis pour un type de prestation donné, la condition particulière prévaut.

## 3. Capacité et zone de livraison

Le client déclare avoir la capacité juridique de contracter, être âgé d'au moins 18 ans ou disposer de l'autorisation de son représentant légal. Le Site livre exclusivement dans les pays et zones géographiques indiqués comme disponibles lors du processus de commande ; toute commande vers une zone non desservie sera refusée et remboursée intégralement.

## 4. Compte client et processus de commande

La commande peut être passée avec ou sans création de compte client. La création d'un compte requiert l'acceptation des présentes CGV et de la Politique de confidentialité, et donne lieu à la création d'un espace personnel permettant notamment le suivi des commandes et la gestion du programme de fidélité.

Le processus de commande comprend : sélection des produits ou billets, consultation du panier, saisie ou confirmation de l'adresse de livraison et des coordonnées, sélection du mode de paiement, récapitulatif final du prix (produits, frais de livraison, taxes applicables) et validation de la commande. La validation finale, matérialisée par un clic sur le bouton de confirmation, vaut acceptation ferme et définitive de la commande par le client et exigibilité du prix.

Un email de confirmation récapitulant la commande est envoyé au client dès validation du paiement. Cet email, associé aux présentes CGV, constitue le contrat de vente entre les parties.

Chloé Food se réserve le droit de refuser ou d'annuler toute commande présentant un caractère anormal, frauduleux, ou émanant d'un client avec lequel existerait un litige relatif au paiement d'une commande antérieure, sous réserve d'en informer le client et de le rembourser intégralement le cas échéant.

## 5. Prix

Les prix des produits et billets sont indiqués en euros, toutes taxes comprises (TTC). Les frais de livraison, calculés en fonction de l'adresse et du poids/volume de la commande, sont affichés avant la validation finale et s'ajoutent au prix des produits sauf mention contraire (offre de livraison gratuite, etc.).

Chloé Food se réserve le droit de modifier ses prix à tout moment ; le prix applicable à une commande est celui affiché et accepté au moment de sa validation, indépendamment de toute évolution ultérieure.

## 6. Paiement

### 6.1 Paiement en ligne standard

Le paiement s'effectue au moment de la commande, par carte bancaire ou tout autre moyen de paiement proposé sur le Site, via des prestataires de services de paiement tiers agréés. Chloé Food ne collecte ni ne stocke aucune donnée de carte bancaire sur ses propres serveurs ; ces données sont traitées exclusivement par les prestataires de paiement, dans le respect de la norme PCI-DSS.

La commande n'est considérée comme définitivement conclue et le stock n'est réservé qu'après confirmation effective du paiement par le prestataire de paiement.

### 6.2 Paiement par lien externe avec confirmation manuelle

Pour certains modes de paiement (virement, lien de paiement externe), la commande est enregistrée à l'état « en attente » lors du clic du client, et n'est confirmée et créée définitivement qu'après vérification manuelle de la réception effective des fonds par Chloé Food. Le client en est informé lors du choix de ce mode de paiement. Si le paiement n'est pas confirmé dans un délai de 5 jours ouvrés à compter de la commande, celle-ci est automatiquement annulée et le client en est informé par email.

## 7. Livraison

Les produits sont livrés à l'adresse indiquée par le client lors de la commande, par l'intermédiaire de transporteurs partenaires. Les délais de livraison affichés lors de la commande sont donnés à titre indicatif et courent à compter de la confirmation du paiement ; leur dépassement ne peut donner lieu à indemnisation, sauf faute prouvée de Chloé Food.

En cas de perte ou d'avarie constatée par le transporteur, le client est invité à formuler les réserves d'usage auprès du transporteur et à en informer Chloé Food dans les meilleurs délais.

Le transfert des risques sur les produits s'opère à la livraison, sauf faute du transporteur.

## 8. Droit de rétractation

Conformément à l'article 16, sous c) et d), de la directive 2011/83/UE (transposé en droit italien à l'article 59 du Codice del Consumo), **le droit de rétractation ne s'applique pas** :

- aux biens susceptibles de se détériorer ou de se périmer rapidement, ce qui inclut l'ensemble des produits alimentaires frais et surgelés vendus sur le Site ;
- aux biens descellés après livraison et ne pouvant être renvoyés pour des raisons d'hygiène ou de protection de la santé.

Pour les produits d'épicerie fine non périssables (produits secs, en conserve, non descellés), le client dispose, sauf indication contraire au moment de l'achat, d'un délai de rétractation de 14 jours à compter de la réception, dans les conditions et selon les modalités de remboursement prévues par la réglementation applicable. Les frais de retour restent à la charge du client, sauf non-conformité du produit.

Le droit de rétractation applicable à la billetterie d'événements est traité séparément à l'article 9.

## 9. Conditions particulières — Événementiel (billetterie)

La commande de billet ou de formule liée à un événement vaut réservation ferme dès confirmation du paiement.

Conformément à l'article 16, sous l), de la directive 2011/83/UE, le droit de rétractation de 14 jours ne s'applique pas aux contrats portant sur des services de loisirs devant être fournis à une date ou une période déterminée.

**Politique d'annulation par le client :**
- Annulation plus de 14 jours avant l'événement : remboursement intégral.
- Annulation entre 7 et 14 jours avant l'événement : remboursement à 50 %.
- Annulation à moins de 7 jours de l'événement, ou absence le jour J : aucun remboursement.

**Annulation ou report par l'organisateur :** en cas d'annulation ou de report de l'événement par Chloé Food ou l'organisateur, les billets sont intégralement remboursés ou, au choix du client, transférés vers la nouvelle date.

L'accès à l'événement est conditionné à la présentation du billet (format numérique ou QR code) et, le cas échéant, d'une pièce d'identité. Le billet est nominatif et ne peut être revendu à titre commercial sans accord préalable de Chloé Food.

## 9 bis. Conditions particulières — Traiteur et location

Toute prestation de traiteur ou de location fait l'objet d'un devis préalable précisant le prix, les prestations incluses et les modalités de paiement (acompte et solde). Ces prestations, tant qu'elles ne sont pas proposées à la vente directe sur le Site, sont régies par les termes du devis accepté par le client, lequel prévaut sur les présentes CGV.

## 10. Réclamations et non-conformité

En cas de produit manquant, endommagé ou non conforme à la commande, le client doit contacter Chloé Food à chloefood.ets@gmail.com dans un délai de 48 heures suivant la réception pour les produits frais ou surgelés, et de 14 jours pour les autres produits, photographie à l'appui dans la mesure du possible.

Après vérification, Chloé Food procède, selon la nature du problème et au choix raisonnable du client, au remplacement du produit, à son remboursement partiel ou total, ou à l'émission d'un avoir.

Cette procédure est sans préjudice de la garantie légale de conformité applicable dans le pays de résidence du client consommateur, dont les dispositions impératives priment en tout état de cause sur la présente clause.

## 11. Programme de fidélité et de parrainage

L'adhésion au programme de fidélité et de parrainage est facultative et soumise à l'acceptation de son règlement spécifique, disponible dans l'espace client. En cas de contradiction, ce règlement prévaut sur les présentes CGV pour les seuls aspects propres au programme (attribution et utilisation des points, conditions de parrainage, prévention de la fraude).

## 12. Responsabilité

Chloé Food ne saurait être tenue responsable de l'inexécution ou de la mauvaise exécution du contrat en cas de force majeure, telle que définie par la jurisprudence applicable, ni des dommages résultant d'une conservation ou d'une utilisation inappropriée des produits par le client après livraison.

Sauf disposition légale impérative contraire, et sans préjudice des droits du consommateur, la responsabilité totale de Chloé Food au titre d'une commande ne saurait excéder le montant effectivement payé par le client pour cette commande.

## 13. Données personnelles

Le traitement des données personnelles réalisé dans le cadre de la commande, de la création de compte et de la navigation sur le Site est décrit dans la Politique de confidentialité (/politique-confidentialite), qui fait partie intégrante de la relation contractuelle entre le client et Chloé Food.

## 14. Droit applicable et règlement des litiges

Les présentes CGV sont soumises au droit italien, sans préjudice, pour les clients consommateurs résidant dans un autre État membre de l'Union européenne, des dispositions impératives de protection du consommateur de leur pays de résidence habituelle, qui demeurent applicables conformément au règlement (CE) n° 593/2008 (« Rome I »).

En cas de litige, le client est invité à contacter Chloé Food à chloefood.ets@gmail.com afin de rechercher une solution amiable. À défaut, le client consommateur européen peut recourir à la plateforme de règlement en ligne des litiges de la Commission européenne, ainsi qu'à toute procédure de médiation de la consommation applicable dans son pays de résidence.

## 15. Modification des CGV

Chloé Food se réserve le droit de modifier les présentes CGV à tout moment. Les CGV applicables à une commande sont celles en vigueur à la date de sa validation. En cas de modification substantielle, les clients disposant d'un compte sont invités, lors de leur prochaine connexion, à prendre à nouveau connaissance des CGV et à les accepter expressément avant de poursuivre toute nouvelle commande.

## 16. Contact

Pour toute question relative aux présentes CGV : chloefood.ets@gmail.com

**Version : 1.0**
$cgv$,
  now()
from public.tenants t
where t.slug = 'chloefood'
on conflict (tenant_id, doc_type, version) do nothing;
