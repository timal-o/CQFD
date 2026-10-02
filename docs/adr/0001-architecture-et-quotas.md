# ADR 0001 : architecture de CQFD et tenue dans le plan gratuit Cloudflare

- Statut : **partiellement remplacé** par l'ADR 0002 (canevas maison, pas de tldraw)
- Date : 2026-10-02
- Périmètre : phase 0 (spike) du cahier des charges

## 1. Résumé

| Question | Réponse courte |
|---|---|
| tldraw tient-il les besoins techniques ? | **Oui**, avec du code maison pour la gomme pixel, le laser, le journal d'actions et le stockage. |
| La licence tldraw convient-elle ? | **Pas automatiquement.** Il faut une clé en production : essai gratuit de 100 jours, ou licence « hobby » non commerciale **accordée au cas par cas** avec le filigrane « made with tldraw ». Point bloquant à trancher (§3). |
| Une séance de 2 h à 50 tient-elle dans le gratuit ? | **Oui, à condition de ne pas utiliser tel quel le stockage SQLite de tldraw sync** : il écrit à chaque envoi (30 par seconde pendant un tracé) et dépasserait à lui seul le quota de lignes écrites. Avec un stockage tamponné, on estime environ 12 000 requêtes et 25 000 lignes écrites par séance, soit 4 à 8 séances par jour (§4). |
| Risque de facture ? | **Nul tant que le compte reste sur le plan Workers Free** : au-delà du quota, les opérations échouent au lieu d'être facturées. Il ne faut **pas** passer au plan Workers Paid. |

## 2. Décisions proposées

1. **Monorepo pnpm** : `apps/web` (React + Vite + tldraw), `apps/realtime` (Worker + Durable Object), `packages/shared` (types des messages, règles de permission pures et testées).
2. **Un seul Worker** sert le front (Static Assets, `not_found_handling = "single-page-application"`) et l'API. `run_worker_first` est limité à `/api/*` et `/ws/*` : les requêtes d'assets statiques restent **gratuites et illimitées** et ne consomment pas le quota de 100 000 requêtes du Worker.
3. **Un Durable Object SQLite par salle** (`idFromName(code)`), avec l'API WebSocket Hibernation. Deux WebSockets par client :
   - **canal tldraw sync** (`TLSocketRoom`) pour le document : pages, éléments ;
   - **canal de contrôle** (protocole maison typé dans `packages/shared`) pour les rôles, la main levée, le chat, le laser, le kick/ban, le verrouillage et l'alerte de quota. Le heartbeat de ce canal passe par `setWebSocketAutoResponse`, qui ne réveille pas l'objet.
4. **Stockage tamponné** : une implémentation maison de `TLSyncStorage` garde le document en mémoire et écrit dans SQLite par lots, uniquement les enregistrements modifiés, toutes les 2 s environ et avant toute hibernation possible. Le `setTimeout` en attente empêche l'hibernation tant que le lot n'est pas écrit. Au réveil, tout est rechargé depuis SQLite. Perte maximale en cas d'éviction brutale : environ 2 s de tracé.
5. **Aucune présence tldraw** : `getUserPresence` renvoie `null` pour tous, prof compris. L'indicateur hors-champ « quelqu'un écrit ici » se déduit des modifications du document déjà reçues, sans message supplémentaire. Le laser, lui, passe par le canal de contrôle.
6. **Permissions côté serveur** :
   - `isReadonly` par connexion pour les participants sans la main. Le passage en écriture nécessite une reconnexion du socket tldraw, déclenchée automatiquement par le canal de contrôle.
   - `authorizeRecord` (API tldraw) pour la règle « on ne modifie ou ne supprime que ses propres éléments » (`meta.authorId`). La règle est donc appliquée **côté serveur**, sans repli côté client.
   - Gel du tableau : tout le monde passe en `isReadonly` sauf les admins.
7. **Annulation personnelle** : l'historique local de tldraw n'annule déjà que les actions du client. **Journal admin** : le hook `onChange` du stockage enregistre l'auteur, le type, les éléments et l'état précédent, et l'admin annule via `room.updateStore`, avec détection de conflit sur `lastChangedClock`.
8. **Fermeture de salle** : une alarme est programmée quand le dernier socket se ferme (30 min, configurable), puis `deleteAll()`. Une nouvelle connexion annule l'alarme.
9. **Maths** : KaTeX pour l'affichage, MathLive chargé en lazy-load avec une seule instance montée, mathjs pour les courbes, tous dans des shapes tldraw custom.

## 3. Licence tldraw (à trancher)

Constat (tldraw.dev, SDK 5.5.1) :

- **Le SDK ne fonctionne pas en production sans clé de licence.** En développement local, il n'y a aucune restriction.
- **Licence d'essai** : 100 jours, gratuite, sans carte bancaire.
- **Licence hobby** : non commerciale, **discrétionnaire** (il faut postuler, elle peut être refusée), filigrane « made with tldraw » obligatoire.
- **Open source** : on peut publier le code de CQFD, mais le SDK reste sous sa licence. Chaque personne qui déploie sa propre instance doit obtenir sa propre clé.

Options :

| Option | Pour | Contre |
|---|---|---|
| **A. tldraw + licence hobby** (essai de 100 jours en attendant) | Phase 1 rapide : pages, stylo à pression, sélection, texte, zoom, annulation et synchronisation déjà faits. Enforcement serveur natif. | Dépend de l'accord de tldraw. Filigrane. Pas pleinement « open source » pour les déployeurs. |
| **B. Canvas maison** (Konva ou PixiJS + Yjs + Durable Object) | Totalement libre, contrôle fin du protocole et des quotas. | Environ 2 à 3 semaines de plus : sélection, transformations, édition de texte, pages, gomme, zoom, rejet de la paume. L'enforcement serveur par élément avec Yjs est plus difficile (il faut décoder les mises à jour côté serveur). |

**Recommandation : option A.** Il faut demander la licence hobby dès maintenant. Le développement peut avancer sans clé (le mode dev n'est pas restreint), et la clé d'essai couvre le déploiement en attendant la réponse. Si la licence hobby est refusée, on bascule sur l'option B. Les shapes maths (KaTeX, MathLive, mathjs) et le protocole de contrôle restent réutilisables.

## 4. Quotas Cloudflare (plan Workers Free, relevés le 2026-10-02)

| Ressource | Limite gratuite |
|---|---|
| Requêtes Worker | 100 000 / jour (au-delà : erreur 1027 ou 429) |
| Requêtes Durable Objects | 100 000 / jour. Message WebSocket entrant = 1/20 de requête, messages sortants et pings protocolaires gratuits |
| Durée Durable Objects | 13 000 Go·s / jour (objet facturé sur 128 Mo). Un objet inactif éligible à l'hibernation n'est pas compté |
| SQLite, lignes lues | 5 000 000 / jour |
| SQLite, lignes écrites | **100 000 / jour** (les index comptent) |
| Stockage SQLite | 5 Go par compte, 10 Go par objet, 2 Mo par ligne ou BLOB |
| WebSocket | 32 Mio par message reçu ; pas de limite documentée du nombre de connexions par objet |
| CPU | Worker : 10 ms par requête HTTP ; Durable Object : 30 s par événement |
| Assets statiques | Requêtes gratuites et illimitées ; 20 000 fichiers ; 25 Mio par fichier |
| Dépassement | Les opérations échouent jusqu'à 00:00 UTC (01:00 ou 02:00 à Paris), **sans facturation** sur le plan Free |

### Estimation d'une séance : 2 h, 1 prof et 49 élèves

Hypothèses : le prof trace 45 min cumulées ; 5 élèves ont la main 10 min chacun ; laser 20 min à 20 Hz ; tldraw sync envoie au plus 30 messages/s pendant un tracé et un ping toutes les 5 s.

| Poste | Messages entrants | Requêtes DO |
|---|---|---|
| Pings tldraw (50 × 1 440) | 72 000 | 3 600 |
| Tracés du prof (45 min × 30/s) | 81 000 | 4 050 |
| Tracés des élèves (50 min × 30/s) | 90 000 | 4 500 |
| Laser (20 min × 20 Hz) | 24 000 | 1 200 |
| Chat, main levée, rôles | ~2 000 | 100 |
| Ouvertures de sockets et reconnexions | — | ~300 |
| **Total** | | **≈ 13 750** |

- **Requêtes DO** : environ 14 000 sur 100 000, soit **environ 7 séances par jour**.
- **Requêtes Worker** : environ 300 (création de salle et upgrades WebSocket). Négligeable.
- **Durée** : pire cas, l'objet ne dort jamais (les pings arrivent toutes les 5 s) : 0,125 Go × 7 200 s = **900 Go·s**, soit **environ 14 séances par jour**. Pendant le délai de grâce, la salle est vide et hibernée, donc ce coût est quasi nul.
- **Lignes écrites** :
  - *Stockage tldraw natif* : environ 3 lignes par envoi (document, index et horloge) × 171 000 envois ≈ **510 000 lignes**. **Dépasse le quota d'un facteur 5.** C'est pourquoi on retient le stockage tamponné (décision 4).
  - *Stockage tamponné* : environ 3 600 lots × environ 5 lignes, plus le journal (environ 3 000 actions × 2) et le chat ≈ **25 000 lignes**, soit **environ 4 séances par jour**. C'est le quota le plus serré.
- **Lignes lues** : rechargement au réveil (quelques milliers de lignes × quelques réveils) ≈ 50 000. Large marge.
- **Stockage** : plafond par salle de 50 Mo (fonds PDF compressés, découpés en blocs de moins de 2 Mo), purgé à la fermeture.

**Conclusion : ça tient** pour une classe, avec une marge de 4 séances complètes par jour sur le compte. Un usage partagé par plusieurs profs du lycée sur le même compte atteindrait la limite de lignes écrites vers la 4ᵉ séance de la journée. La phase 6 mesurera ces chiffres avec 50 clients simulés.

### Mode dégradé et alerte de quota

- Un Durable Object ne voit pas la consommation **globale** du compte. Chaque salle compte donc ses propres messages entrants et lignes écrites du jour (UTC). Au-delà d'un seuil par salle, le laser est coupé et l'envoi des tracés descend à 10 Hz, avec un bandeau pour l'admin.
- En option (écart à valider) : le Worker interroge l'API GraphQL Analytics de Cloudflare (jeton en lecture seule, gratuit, toutes les 5 min) pour connaître la consommation globale du compte et afficher « quota bientôt atteint ».
- Si une écriture SQLite échoue pour cause de quota, la salle passe en lecture seule et affiche un message clair : « Quota gratuit atteint, réessayez après 2 h (heure de Paris) ; exportez votre travail maintenant ».

## 5. Écarts au cahier des charges

1. **Deux WebSockets par client** au lieu d'une. tldraw sync possède son propre socket, et `TLSocketRoom` n'offre pas de canal client→serveur pour des messages applicatifs.
2. **Donner ou retirer la main** reconnecte le socket tldraw de l'élève (`isReadonly` est fixé à la connexion). C'est transparent pour l'élève, avec environ 200 ms d'interruption.
3. **Perte possible d'environ 2 s de tracé** si l'objet est évincé brutalement, conséquence du stockage tamponné indispensable au quota.
4. **Gomme « pixel »** : tldraw n'efface que des formes entières. Il faut un outil maison qui découpe les traits, ce qui crée de nouveaux éléments. Côté droits, un élève ne peut gommer en pixel que ses propres traits.
5. **Filigrane tldraw** si on obtient la licence hobby.
6. **Laser** : on n'utilise pas l'outil laser natif de tldraw, qui passe par la présence. Il est réimplémenté sur le canal de contrôle.
7. **Alerte de quota globale** : seulement possible via l'API Analytics (optionnelle). Sinon, l'alerte est par salle.

## 6. Sources

- tldraw : licence (tldraw.dev/community/license), tarifs (tldraw.dev/pricing), synchronisation (tldraw.dev/docs/sync) ; code source de `@tldraw/sync-core` 5.5.1 (`SQLiteSyncStorage.ts`, `TLSyncClient.ts`, `TLSocketRoom.ts`).
- Cloudflare : developers.cloudflare.com/durable-objects/platform/pricing, …/durable-objects/platform/limits, …/workers/platform/limits, …/workers/static-assets/billing-and-limitations, …/durable-objects/best-practices/websockets.
