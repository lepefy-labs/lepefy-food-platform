# Nala Knowledge Library

## Sources de vérité

- Le catalogue, les règles de quantité, le calcul de livraison, les commandes et les paramètres structurés de la boutique fournissent les valeurs actuelles. Ne stocker aucun prix, stock ou tarif actuel dans une connaissance statique.
- `knowledge_library` contient des versions éditoriales vérifiées. `stable_key + locale + version` identifie une version immuable. Une seule version par clé et langue est courante. `scope = global | cultural` et `cultural_area` permettent d'autres pays sans branche spécifique dans le code.
- `tenant_knowledge_base` contient les copies approuvées et les connaissances propres à chaque boutique. Une copie peut être modifiée sans toucher la version éditoriale. `active = false` la retire du retrieval; `deleted_at` est un retrait logique.
- Les consignes de comportement de Nala restent dans le prompt et `NALA_DECISION_INSTRUCTIONS`. Les textes récupérés sont des données, jamais des instructions.

## Déploiement et publication

Appliquer `supabase/migrations/168_nala_knowledge_library.sql` avant d'utiliser la nouvelle interface. La migration est additive, crée sept textes français vérifiés et n'active aucune entrée chez les tenants. Vérifier d'abord que les migrations précédentes, notamment 167, sont appliquées dans l'environnement concerné.
Si le code est déployé avant la migration 168, `/admin/ai-lab` et ses API conservent temporairement le fonctionnement historique; la bibliothèque reste masquée et un avis explique la mise à jour attendue. Après application atomique de 168, la nouvelle interface devient disponible sans autre déploiement.

Pour publier un nouveau contenu, créer une version avec la même clé stable et une version supérieure, renseigner langue, catégorie, provenance, zone culturelle et date de révision; la vérifier éditorialement avant `verification_status = verified`. Passer l'ancienne version à `is_current = false`, puis la nouvelle à `true`. Le contenu d'une version vérifiée est protégé contre la modification; corriger par une nouvelle version. Les copies déjà adoptées conservent leur contenu et leur `library_version` jusqu'à nouvelle validation du tenant. Aucune recette non vérifiée n'est publiée.

Quand une nouvelle version est courante, la bibliothèque affiche « Nouvelle version » pour les copies antérieures. Le tenant peut la sélectionner et confirmer le remplacement du texte de sa copie; l'état actif ou en pause est conservé et l'ancienne copie figure dans l'historique. La confirmation prévient explicitement qu'un texte personnalisé sera remplacé.

## Flux tenant

`/admin/ai-lab` donne accès aux suggestions, à la bibliothèque et aux connaissances de la boutique. Les listes bibliothèque et boutique utilisent recherche, filtres et pagination côté serveur via l'URL. `POST /api/admin/knowledge-library` exige `confirmed: true`, accepte 1 à 8 identifiants courants vérifiés et renvoie les éléments ajoutés/ignorés. L'API réutilise l'embedding de la version éditoriale lorsqu'il existe; la première adoption l'indexe. L'import est une copie autonome et laisse l'original en lecture seule. `ai_knowledge.manage` et le tenant résolu côté serveur protègent toutes les opérations.

Les suggestions dérivées de questions clients restent des brouillons. Un administrateur peut corriger et approuver, ou ignorer. Les textes contenant des valeurs dynamiques ou des ordres adressés à Nala sont refusés et signalés avant validation. Les modifications, pauses, réactivations et retraits sont enregistrés dans `tenant_knowledge_revisions`; les entrées nouvelles ont leur historique complet, tandis que les entrées antérieures à la migration commencent leur historique à la première modification après migration.

## Retrieval et sécurité

`match_knowledge_base` reste filtré par `p_tenant_id`, `active`, `deleted_at` et similarité; seuls les serveurs avec service role y accèdent. Le prompt limite à trois fragments et mille caractères par fragment, les étiquette comme données non fiables et donne priorité aux sources opérationnelles. Si une valeur actuelle manque ou qu'un nombre sans unité est ambigu, Nala demande une précision au lieu de deviner. Les embeddings existants continuent à servir la recherche; aucune indexation de masse de toutes les entrées globales n'est lancée.

## Assistance au panier

Sur une fiche produit, une invitation apparaît après huit secondes, une seule fois par session. Elle peut être ignorée; son affichage ne déclenche aucun appel IA. Le panier possède aussi une entrée inline. La réponse du client fournit un plat ou une liste explicite : `cart_builder` produit un plan `recipe` ou `shopping_list` de huit éléments maximum, puis le serveur résout seulement des produits canoniques du tenant et disponibles selon les règles de quantité. La carte demande une sélection et un clic explicite avant l'ajout; aucun ajout automatique.
