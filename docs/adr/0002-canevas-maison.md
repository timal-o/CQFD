# ADR 0002 : canevas maison et protocole où le serveur fait autorité (plan B)

- Statut : **accepté** (2026-10-02)
- Remplace : ADR 0001 §2 (décisions 3 à 7), §3 et §5. Les quotas Cloudflare relevés dans l'ADR 0001 §4 restent valables.

## Contexte

Pas de licence tldraw : il faut une clé en production, et la licence hobby demande un dossier. Le prof veut une solution maison, disponible immédiatement.

## Décisions

1. **Rendu** : deux `<canvas>` 2D superposés.
   - Le **canevas de base** affiche les éléments validés. Il n'est redessiné que si le document ou la caméra change.
   - Le **canevas actif** affiche les tracés en cours, le laser et la sélection.

   Les textes (et plus tard les formules KaTeX) sont des éléments DOM placés dans un calque transformé par la caméra. Les traits sont lissés avec `perfect-freehand` (licence MIT), qui gère la pression du stylet. On n'utilise ni Konva ni PixiJS, ce qui fait moins de dépendances et un bundle plus léger.
2. **Pas de Yjs** : on utilise un **protocole JSON où le serveur fait autorité**, typé et validé avec zod dans `packages/shared`.
   - Le client applique ses opérations localement (de façon optimiste), puis les envoie (`put`, `del`) avec un numéro de séquence.
   - Le serveur valide le schéma et les droits, puis :
     - s'il accepte : il écrit en SQLite, diffuse aux autres clients et renvoie `ack` à l'émetteur ;
     - s'il refuse : il renvoie `nack` avec l'état faisant autorité des éléments concernés.
   - Les éléments sont presque toujours atomiques (un trait, une zone de texte) et chacun n'édite que les siens. La règle « le dernier qui écrit gagne » au niveau de l'élément suffit donc, sans CRDT.
3. **Droits imposés côté serveur, élément par élément** :
   - Pour écrire, il faut être admin, ou avoir la main et que le tableau ne soit pas gelé.
   - Un non-admin ne peut modifier ou supprimer que les éléments dont `authorId` est son propre identifiant. Pour un nouvel élément, le serveur impose `authorId` = l'émetteur.
   - La gestion des pages est réservée aux admins (écart mineur, voir plus bas).
4. **Une seule WebSocket par client.** Donner ou retirer la main ne déconnecte plus personne : le rôle est mis à jour dans l'attachement du socket (`serializeAttachment`) et en SQLite. Le heartbeat passe par `setWebSocketAutoResponse("ping","pong")`, qui ne réveille pas l'objet.
5. **Tracé en direct éphémère** : pendant le tracé, le client envoie les nouveaux points par lots toutes les 66 ms (15 Hz) ; le serveur les relaie sans rien stocker. Quand le trait est terminé, le client envoie un seul `put`, qui fait **1 ligne écrite** en SQLite (table `WITHOUT ROWID`, donc pas d'index séparé). On n'a plus besoin de stockage tamponné et on ne risque plus de perte en cas d'éviction. La gomme pixel calcule localement et envoie un seul lot au relâchement.
6. **Le document n'est pas mis en cache en mémoire.** Chaque vérification de droits lit SQLite (1 ligne). À la connexion, un client reçoit tout le document (`SELECT`). Seuls les compteurs de limitation de débit sont en mémoire, ce qui ne pose pas de problème parce qu'ils sont éphémères par nature.
7. **Schéma créé seulement à la création de la salle.** Sonder un code inexistant ne crée aucune donnée. Une alarme de purge est armée dès la création (si l'admin ne se connecte jamais) et à chaque départ du dernier socket.
8. **Tests** : la logique de salle (`RoomCore`) passe par une petite interface SQL. Elle est testée dans Node avec `node:sqlite`, sans émulateur Cloudflare.

## Quotas recalculés (séance de 2 h, 50 personnes, mêmes hypothèses que l'ADR 0001)

| Poste | Messages entrants | Requêtes DO |
|---|---|---|
| Heartbeat (50 × 1 toutes les 20 s, compté par prudence) | 18 000 | 900 |
| Tracés du prof (45 min × 15 Hz, plus les `put`) | 42 000 | 2 100 |
| Tracés des élèves (50 min × 15 Hz) | 45 000 | 2 250 |
| Laser (20 min × 15 Hz) | 18 000 | 900 |
| Divers, plus ouvertures de sockets | ~3 000 | ~450 |
| **Total** | | **≈ 6 600** (environ 15 séances par jour) |

- **Lignes écrites** : environ 3 000 traits, 2 000 modifications, 3 000 entrées de journal (phase 4), plus le chat et les participants ≈ **9 000** (environ 11 séances par jour, contre 4 dans l'ADR 0001).
- **Lignes lues** : environ 50 connexions × 3 000 éléments, plus 1 ligne par vérification ≈ 200 000 sur 5 000 000.
- **Durée** : 900 Go·s au pire (13 000 par jour). C'est moins en pratique, puisque le heartbeat ne réveille pas l'objet.

## Écarts au cahier des charges

- **Pas de Yjs** (le cahier des charges proposait Konva/PixiJS + Yjs + PartyServer en plan B). À la place : un protocole maison, plus simple, qui fait respecter les droits côté serveur.
- **Gestion des pages réservée aux admins** : ajouter, renommer, réordonner, dupliquer, supprimer.
- **Les textes et les formules (DOM) s'affichent toujours au-dessus des traits (canvas).**
- **Option « suivre le prof »**, ajoutée et active par défaut : l'élève suit la page affichée par l'admin. Sa vue (zoom et position) reste libre.
- **Kick et sessionStorage** : sessionStorage est propre à chaque onglet, donc un élève exclus qui ouvre un **nouvel onglet** obtient un nouveau jeton de session. Seul le ban par IP l'en empêche. Le critère « ne peut pas rejoindre avec le même navigateur » n'est donc tenu que pour le même onglet, sauf à utiliser localStorage, ce que le cahier des charges exclut. À trancher en phase 3.

## Phase 2 : formules (2026-10-02)

- **Objet `formula`** : la source LaTeX est la seule donnée stockée et transmise. L'affichage passe toujours par KaTeX en HTML statique, mis en cache, avec `trust: false` pour que le LaTeX d'un participant ne puisse pas injecter de HTML actif.
- **MathLive est chargé à la demande**, au premier double-clic ou à la première création de formule, dans un fichier séparé (≈ 220 Ko gzip). Une seule instance de `<math-field>` existe à la fois : celle du panneau d'édition. Toutes les autres formules restent des rendus KaTeX statiques.
- **Mode LaTeX brut** : un champ texte avec aperçu KaTeX en direct et une autocomplétion des commandes (Tab ou Entrée pour insérer). La source est partagée avec le mode visuel : basculer ne perd rien.
- **Clavier virtuel** : c'est le clavier de MathLive, avec des onglets personnalisés (Analyse, Algèbre, Ensembles, Probas/Stats, Grec et relations, plus « 123 » et « abc »). Il est placé dans un panneau flottant déplaçable via `mathVirtualKeyboard.container`. Il s'ouvre automatiquement sur les écrans tactiles. La touche « ↵ » est retirée : on valide avec Valider ou la touche Entrée.
- **Raccourcis de frappe et onglets** : ils se règlent dans `apps/web/src/math/config.ts`.
- **Écart au cahier des charges** : pendant l'édition, la formule n'est visible que chez son auteur, en aperçu local. Les autres la voient à la validation, avec 1 message envoyé et 1 ligne écrite. Envoyer chaque frappe consommerait du quota pour un bénéfice faible.
- **Taille du bundle** : KaTeX est dans le bundle principal (≈ 210 Ko gzip au total, contre ≈ 125 Ko avant), car les formules doivent s'afficher dès l'arrivée dans la salle.
