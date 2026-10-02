# ADR 0003 : gestion de classe, historique, repère, et mesures de charge

- Statut : **accepté** (2026-10-02)
- Complète les ADR 0001 et 0002 (phases 3 à 6).

## Décisions

### Gestion de classe (phase 3)
- **Main levée** : colonne `hand_at` sur le participant. La file d'attente est triée par heure de levée. Le prof reçoit une notification (toast et compteur sur le bouton Participants), puis donne la main depuis la file (ce qui baisse la main) ou baisse la main lui-même. L'élève voit son état dans la barre du haut.
- **Exclusion** : le participant est marqué `kicked`, et la reconnexion avec le même jeton de session est refusée. **Limite** : le jeton est en sessionStorage, donc propre à chaque onglet. Un élève exclu qui ouvre un **nouvel onglet** peut revenir sous un autre nom. Utiliser localStorage aurait comblé ce trou, mais le cahier des charges impose sessionStorage uniquement : on s'y tient. Le **ban** couvre ce cas, puisqu'il bloque aussi le hash salé de l'IP.
- **Ban** : il bloque le hash de l'IP (salé par salle) et le jeton de session. La liste des bannis est visible du prof, qui peut lever un ban. Un avertissement sur les IP partagées (Wi-Fi du lycée) s'affiche à la confirmation et sous la liste. Les admins ne sont jamais bloqués par un ban d'IP, puisqu'ils s'authentifient par jeton.
- **Chat** : il est stocké en SQLite (200 derniers messages), limité à 1 message par seconde et 500 caractères, nettoyé des caractères de contrôle, et affiché en texte (jamais en HTML). L'admin peut le couper pour les élèves.

### Historique (phase 4)
- **Ctrl+Z / Ctrl+Y personnels, côté client** : chaque action locale enregistre l'état « avant » et « après » des éléments touchés. Annuler renvoie l'état « avant » par le canal normal, donc avec les mêmes contrôles serveur. Si un élément a changé depuis (modifié par quelqu'un d'autre), il est laissé tel quel et un message prévient. On ne peut donc jamais annuler l'action d'un autre.
- **Journal serveur** : chaque lot validé crée une ligne `log` (auteur, résumé lisible, détail avant/après). On garde les 300 dernières entrées. Le détail n'est pas conservé au-delà de 1,5 Mo, et l'entrée ne peut alors plus être annulée. Le journal est envoyé uniquement aux admins. L'annulation par le prof compare l'état actuel à l'état « après » ; en cas d'écart, le prof doit confirmer avant d'écraser (`revertConflict`).
- **Co-admins** : un lien d'invitation contient un jeton de 128 bits dans le fragment d'URL ; seul son hash est stocké. Les invitations sont listées et révocables. Révoquer rétrograde immédiatement les co-admins connectés avec ce lien.
- **Export** : il se fait côté client. Le canvas dessine le fond, l'image, les traits et les repères ; les textes et formules (HTML KaTeX) sont rastérisés avec `html-to-image`. Le PDF est assemblé avec `pdf-lib`, une page PDF par page du tableau. La CSP passe à `base-uri 'self'` pour que html-to-image retrouve les polices KaTeX.

### Repère et fonds (phase 5)
- **Élément `graph`** : fenêtre, grille, jusqu'à 8 courbes `y = f(x)` en LaTeX, saisies avec le même éditeur (MathLive, une seule instance) et le clavier virtuel.
- **Calcul des courbes** : la conversion LaTeX → mathjs est maison et testée. Elle gère fractions, racines, puissances, valeurs absolues, fonctions usuelles, π et e. mathjs est chargé à la demande, dans une instance bridée (`import`, `evaluate`, `parse`… désactivés). L'échantillonnage est adaptatif : subdivision là où la courbe s'écarte de la corde, coupure aux valeurs non définies et aux discontinuités (1/x, partie entière). Il n'est recalculé que si l'expression ou la fenêtre change. Chaque modification validée est envoyée aussitôt : tout le monde voit le repère se mettre à jour.
- **Import PDF** : rendu côté client avec pdf.js, JPEG compressé (4 Mo maximum par page, 30 pages maximum), envoyé par morceaux de 500 Ko sur la WebSocket, stocké en BLOB SQLite (50 Mo maximum par salle), servi par `GET /api/rooms/:code/assets/:id` (identifiant aléatoire, cache navigateur) et purgé avec la salle. La CSP autorise `wasm-unsafe-eval`, nécessaire à certains décodeurs d'image de pdf.js ; l'`eval` JavaScript reste interdit.

### Quota (phase 6)
- **Par salle** : le Durable Object compte ses messages entrants du jour.
  - À 300 000 messages (15 000 requêtes), le prof reçoit une alerte.
  - À 500 000 messages, la salle passe en mode dégradé : laser coupé, tracé en direct limité à 8 messages par seconde et par client.
  - Si une écriture SQLite échoue (quota atteint), la salle passe en lecture seule avec un message clair, qui indique l'heure de remise à zéro en heure de Paris.
- **Pour le compte** : on le consulte dans le tableau de bord Cloudflare. Une adresse `/api/quota` interrogeant l'API GraphQL Analytics a été essayée puis **retirée** : elle était publique (n'importe qui peut créer une salle et en être « prof »), et le compteur de requêtes Durable Objects qu'elle calculait semblait surestimé.
- **Lignes lues** : le serveur relisait la table `meta` (≈ 11 lignes) à chaque message entrant, tracé en direct et laser compris. Cela donnait environ 1,4 M de lignes lues par séance réaliste, sur une limite de 5 M par jour, et ce quota devenait la vraie limite (≈ 3 séances par jour). Désormais, les réglages et la liste des pages sont copiés en mémoire, invalidés à chaque écriture et reconstruits au réveil. Un test vérifie qu'un tracé en direct ne fait plus aucune lecture SQLite. On retombe à ≈ 200 000 lignes lues par séance, presque toutes dues à l'envoi du tableau à chaque arrivée.

## Mesures (test de charge, `scripts/loadtest.mjs`)

**Scénario volontairement intensif**, 50 clients pendant 60 s :
- le prof trace **en continu** (tracé en direct à 15 Hz, un trait validé par seconde) ;
- 5 élèves ont la main et tracent en continu (un trait validé toutes les 2 s) ;
- laser 3 s toutes les 10 s, heartbeat de tous les clients.

| Mesure | Local (`wrangler dev`) |
|---|---|
| Latence du tracé en direct, émission → réception chez les 49 autres | p50 9 ms, p95 16 ms, max 29 ms (263 000 relais) |
| Latence d'accusé de réception d'un trait | p50 23 ms, p95 32 ms |
| Messages entrants en 60 s | 6 215, soit ≈ 361 requêtes DO |
| Déconnexions | 0 |

**En production** (cqfd.malorey.fr, même scénario, 50 clients, 30 s, depuis la France) :

| Mesure | Production |
|---|---|
| Latence du tracé en direct | **p50 50 ms, p95 67 ms, max 133 ms** (132 000 relais) : critère « < 300 ms » tenu |
| Latence d'accusé de réception d'un trait | p50 80 ms, p95 105 ms |
| Ouverture des 50 connexions (séquentielles) | 7,2 s |
| Messages entrants en 30 s | 3 116, soit 206 requêtes DO (connexions comprises) |
| Déconnexions | 0 |

### Ce que cela donne sur une séance de 2 h
- **Pire cas** (6 personnes qui tracent sans s'arrêter pendant 2 h) : ≈ 37 000 requêtes et ≈ 49 000 lignes écrites (1 ligne d'élément et 1 ligne de journal par trait). La séance tient seule dans le quota du jour, mais il reste peu pour une deuxième.
- **Séance réaliste** (le prof trace environ 45 min cumulées, quelques élèves passent au tableau) : ≈ 7 000 requêtes, ≈ 12 000 lignes écrites et ≈ 200 000 lignes lues, soit **environ 8 séances par jour**, limitées par les lignes écrites. Le **journal double les lignes écrites** par rapport à l'ADR 0002 : c'est le prix de l'annulation par le prof.
- **Facture** : toujours nulle sur le plan Workers Free. Au-delà du quota, on bascule en lecture seule.

Pour refaire la mesure : `node scripts/loadtest.mjs https://cqfd.malorey.fr 50 30` (≈ 200 requêtes du quota gratuit).
