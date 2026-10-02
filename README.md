# CQFD : Ce Qu'il Faut Démontrer

Tableau blanc collaboratif temps réel pour les cours de maths à distance. Sans compte, sans cookie, sans sauvegarde : une salle n'existe que le temps de la séance.

- Le prof crée un tableau et reçoit un **code de salle** et un **lien admin secret**.
- Les élèves rejoignent avec le code (ou le lien, ou le QR code) et leur prénom.
- Tout tourne sur le **plan gratuit Cloudflare** : un Worker, des assets statiques et un Durable Object SQLite par salle.

Décisions et chiffres : [docs/adr/0001](docs/adr/0001-architecture-et-quotas.md), [docs/adr/0002](docs/adr/0002-canevas-maison.md). Feuille de route : [docs/plan.md](docs/plan.md).

## Structure

```
apps/web        Front React + Vite (canevas maison : 2 canvas + calque DOM pour les textes)
apps/realtime   Worker Cloudflare + Durable Object « Room » (SQLite, WebSocket Hibernation)
packages/shared Schémas zod, protocole client/serveur, règles de droits (testées)
docs/           ADR et plan
```

## Développement local

Prérequis : Node 22 ou plus récent, pnpm (`corepack enable`).

```sh
pnpm install
cp apps/realtime/.dev.vars.example apps/realtime/.dev.vars   # autorise l'origine Vite, délai de purge de 2 min
pnpm dev        # Vite sur http://localhost:5173 + wrangler dev sur :8787
pnpm test       # tests unitaires (droits, protocole, logique de salle sur vrai SQLite, géométrie)
pnpm typecheck
```

`wrangler dev` émule localement les Durable Objects, SQLite et l'hibernation. Pour tester le build de production en local : `pnpm build`, puis `pnpm --filter @cqfd/realtime dev` et ouvrez http://localhost:8787.

## Déploiement sur Cloudflare

1. Connexion : `pnpm --filter @cqfd/realtime exec wrangler login`
2. Déploiement : `pnpm deploy` (build du front, puis `wrangler deploy`).
3. Domaine : `wrangler.jsonc` déclare `cqfd.malorey.fr` comme *custom domain*. Comme la zone `malorey.fr` est déjà chez Cloudflare, wrangler crée l'enregistrement DNS et le certificat au premier déploiement.

Variables (`wrangler.jsonc`, section `vars`) :

| Variable | Défaut | Rôle |
|---|---|---|
| `ROOM_GRACE_MINUTES` | `30` | Délai avant l'effacement complet d'une salle vide |
| `EXTRA_ORIGINS` | vide | Origines supplémentaires autorisées pour l'API et la WebSocket (dev) |

Aucun secret n'est nécessaire : les jetons admin sont générés par salle, et seul leur hash SHA-256 est stocké.

### Rester gratuit

- **Gardez le compte sur le plan Workers Free.** Au-delà des quotas journaliers, les requêtes échouent (remise à zéro à 00:00 UTC) au lieu d'être facturées. Sur Workers Paid, les dépassements seraient facturés.
- Les assets statiques sont gratuits et illimités : le Worker ne s'exécute que pour `/api/*` et `/ws/*`.
- `observability` est désactivé : aucun journal de séance n'est conservé.

## Confidentialité

- **Aucun cookie.** Seul sessionStorage est utilisé (jeton de session, prénom, jeton admin), et il est vidé à la fermeture de l'onglet.
- **Données stockées** : uniquement le prénom saisi et le contenu du tableau, dans le Durable Object de la salle. Tout est effacé (`deleteAll`) après le délai de grâce, quand la salle est vide.
- **Jeton admin** : il est transmis dans le fragment d'URL (`#admin=…`), jamais envoyé au serveur dans l'URL, et retiré de la barre d'adresse au chargement.
- **IP** : elle n'est jamais stockée en clair. Seul un hash salé par salle sert aux bannissements (phase 3).

## Fonctionnalités

- **Salle sans compte** : code de 6 caractères, lien direct, QR code, lien admin secret, co-admins (liens révocables).
- **Tableau** :
  - pages en onglets (ajouter, renommer, dupliquer, réordonner, supprimer) ;
  - fonds blanc, Seyès, petits carreaux, points, sombre ;
  - import d'un PDF en fond (une page de PDF par page du tableau).
- **Outils** :
  - stylo sensible à la pression, surligneur, gomme par trait ou pixel ;
  - trait droit avec Maj, formes propres (cercle, ellipse, rectangle, triangle) en restant immobile à la fin du geste ;
  - texte formaté, formule (KaTeX/MathLive), repère avec courbes y = f(x) ;
  - sélection, déplacement, redimensionnement, laser.
- **Maths** :
  - éditeur visuel MathLive ou LaTeX brut avec aperçu et autocomplétion ;
  - clavier virtuel flottant à onglets ;
  - raccourcis de frappe (`sum`, `int`, `lim`, `sqrt`, `binom`, `alpha`…, `/` pour une fraction).
- **Classe** :
  - lever la main (file ordonnée), donner ou retirer la main ;
  - gel du tableau, verrouillage de la salle, limite de participants ;
  - exclusion et bannissement (avec liste des bannis) ;
  - chat que le prof peut couper ;
  - flèches vers l'activité hors du champ de vision.
- **Historique** : Ctrl+Z / Ctrl+Y personnels ; journal des actions visible du prof, qui peut annuler une action (avec avertissement si l'élément a changé depuis).
- **Export** : page courante en PNG, toutes les pages en PDF (côté client).
- **Tablette** : rejet de la paume ; dès qu'un stylet est détecté, le doigt sert seulement à déplacer et zoomer.

Raccourcis :
- outils : `V` sélection, `P` stylo, `S` surligneur, `E` gomme, `T` texte, `F` formule, `G` repère, `L` laser, `H` main ;
- historique : Ctrl/⌘+Z annuler, Ctrl+Y ou Ctrl+Maj+Z rétablir ;
- vue : Espace + glisser pour se déplacer, Ctrl/⌘ + molette ou pincement pour zoomer ;
- sélection : Suppr pour effacer ;
- formule : Entrée valide, Échap annule, Tab passe au champ suivant.

## Suivre la consommation

- **Dans chaque salle** : le serveur compte les messages du jour. Il prévient le prof, passe en mode économie (laser coupé), puis en lecture seule si le quota gratuit est atteint, avec l'heure de reprise.
- **Pour tout le compte** : tableau de bord Cloudflare, menu **Workers & Pages**, Worker `cqfd`, onglet **Metrics**, et page **Durable Objects**, onglet **Metrics**. Aucune adresse publique de CQFD n'expose ces chiffres.

Limites gratuites par jour (remise à zéro à 00:00 UTC, soit 1 h ou 2 h à Paris) : 100 000 requêtes Worker, 100 000 requêtes Durable Objects, 5 millions de lignes SQLite lues, 100 000 lignes écrites. Au-delà, rien n'est facturé sur le plan Workers Free : les opérations échouent jusqu'au lendemain.

## Tests

```sh
pnpm test                                          # tests unitaires (droits, protocole, salle sur vrai SQLite, géométrie, courbes)
node scripts/loadtest.mjs http://localhost:8787 50 60   # test de charge : 50 clients pendant 60 s
```

## Limites connues

- **Exclusion** : elle empêche de revenir avec le **même onglet**. Un nouvel onglet obtient un nouveau jeton, puisque sessionStorage est propre à chaque onglet. Le bannissement, qui bloque aussi l'IP, couvre ce cas.
- **Formules** : pendant la saisie, une formule n'est visible que chez son auteur ; les autres la voient à la validation.
- **Superposition** : les textes et formules (HTML) s'affichent toujours au-dessus des traits (canvas).

Décisions et mesures détaillées : [docs/adr/](docs/adr/).
