# CQFD : Ce Qu'il Faut Démontrer

Tableau blanc collaboratif en temps réel, pensé pour les cours de maths à distance.

Le prof crée un tableau en un clic, sans compte, et partage un code (ou un QR code) avec sa classe. Tout le monde voit le même tableau en direct. Les élèves lèvent la main pour passer au tableau, et les formules, les courbes et les PDF annotés s'affichent proprement chez chacun.

L'interface est en français. Le son et la vidéo restent sur l'outil habituel de la classe (Discord, Teams…) : CQFD ne s'occupe que du tableau.

## Principes

- **Sans compte et sans traces** :
  - on entre avec un code et un prénom ;
  - pas de cookie, pas de statistiques, pas de publicité ;
  - le contenu d'une salle est effacé automatiquement quand elle reste vide.
- **Hébergement léger** : un site statique et un petit serveur temps réel, sans base de données externe.
- **Droits vérifiés par le serveur** :
  - un élève sans la main ne peut rien modifier ;
  - avec la main, il ne touche qu'à ses propres éléments ;
  - ce n'est pas l'interface qui l'empêche : c'est le serveur qui refuse.
- **Léger** : les formules sont rendues en HTML statique (KaTeX), et l'éditeur MathLive, mathjs (les courbes) et pdf.js ne se chargent que quand on en a besoin.

## Fonctionnalités

- **Salles** : code de 6 caractères, lien direct, QR code, lien administrateur secret, co-administrateurs (liens révocables).
- **Tableau** :
  - pages en onglets, canevas infini (zoom à la molette, déplacement en glissant) ;
  - fonds blanc, Seyès, petits carreaux, points ou sombre ;
  - import d'un PDF en fond, une page par page du tableau.
- **Outils** :
  - stylo sensible à la pression, surligneur ;
  - gomme qui efface un trait entier ou seulement la zone touchée ;
  - trait droit (Maj), formes nettes reconnues en restant immobile en fin de geste ;
  - texte formaté, images (bouton, coller, glisser-déposer), pointeur laser.
- **Maths** :
  - formules éditées en mode visuel (MathLive) ou en LaTeX brut, avec aperçu et autocomplétion ;
  - clavier mathématique flottant à onglets (analyse, algèbre, ensembles, probas, lettres grecques) ;
  - formules sur plusieurs lignes, systèmes et matrices prolongeables ;
  - repère avec courbes y = f(x), y compris les discontinuités.
- **Classe** :
  - main levée avec file d'attente, donner ou retirer la main ;
  - gel du tableau, verrouillage de la salle, limite de participants ;
  - exclusion et bannissement ;
  - chat que l'enseignant peut couper ;
  - flèches vers l'activité hors du champ de vision.
- **Historique** : Ctrl+Z / Ctrl+Y personnels, et un journal des actions où l'enseignant peut annuler l'action d'un élève.
- **Export** : la page courante en PNG, ou toutes les pages en PDF, générés dans le navigateur.
- **Tablette** : rejet de la paume. Dès qu'un stylet est détecté, le doigt sert seulement à se déplacer.

Un guide d'utilisation complet est intégré à l'application, à l'adresse `/guide`.

## Architecture

```
apps/web         Front React + Vite : canevas maison (2 canvas + calque DOM pour textes et formules)
apps/realtime    Serveur temps réel : une instance par salle, stockage SQLite, WebSocket
packages/shared  Schémas zod, protocole client/serveur, règles de droits (partagés et testés)
scripts/         Test de charge
docs/            Décisions d'architecture (ADR) et mesures
```

- **Une salle = une instance isolée** avec sa propre base SQLite. Tout l'état de la salle y est stocké ; un minuteur l'efface quand la salle reste vide.
- **Protocole JSON sur WebSocket, où le serveur fait autorité** :
  - le client applique ses modifications tout de suite ;
  - le serveur valide (schéma et droits), enregistre, diffuse, puis confirme ou corrige ;
  - le tracé en direct et le laser sont relayés sans être stockés.
- **Logique de salle indépendante de l'hébergement** : elle est dans `apps/realtime/src/core.ts` et ne dépend que d'une petite interface SQL et de connexions. Les tests la font tourner sous Node avec `node:sqlite`. L'implémentation fournie l'exécute sur Cloudflare Workers / Durable Objects (`room.ts`, `index.ts`).

Le détail des choix (alternatives écartées, mesures de charge, consommation) est dans [docs/adr/](docs/adr/).

## Démarrer en local

Prérequis : Node 22 ou plus récent, et pnpm (`corepack enable`).

```sh
pnpm install
cp apps/realtime/.dev.vars.example apps/realtime/.dev.vars   # autorise le serveur Vite, purge des salles après 2 min
pnpm dev
```

`pnpm dev` lance Vite sur http://localhost:5173 et `wrangler dev` sur le port 8787. Wrangler émule localement le Worker, les Durable Objects, SQLite et l'hibernation.

Pour tester le build de production en local :

```sh
pnpm build
pnpm --filter @cqfd/realtime dev    # puis http://localhost:8787
```

## Héberger sa propre instance

- **Le front** est un site statique (`apps/web/dist` après `pnpm build`). N'importe quel hébergeur convient, avec une redirection des chemins inconnus vers `index.html`.
- **Le serveur temps réel** doit être servi sur le même domaine que le front, ou ce domaine doit être autorisé dans `EXTRA_ORIGINS`.

Pour le serveur, deux possibilités :
- **Utiliser l'implémentation fournie**, écrite pour l'API Durable Objects. Elle tourne sur Cloudflare Workers, ou sur [workerd](https://github.com/cloudflare/workerd), le même moteur en open source, auto-hébergeable (non testé).
- **Écrire un adaptateur pour votre plateforme** (Node, Deno, Bun…) : un serveur WebSocket qui crée une instance de `RoomCore` par salle avec sa base SQLite, et un minuteur d'effacement. `room.ts` et `index.ts` servent de modèle (environ 250 lignes au total).

### Avec l'implémentation fournie

1. **Domaine** : remplacez celui de la section `routes` de `apps/realtime/wrangler.jsonc`, ou supprimez cette section et passez `workers_dev` à `true`.
2. **Personnalisation** : dans `apps/web/src/site.ts`, renseignez les liens affichés en haut à droite, l'adresse de contact et le nom de l'éditeur. Adaptez aussi l'hébergeur indiqué dans les mentions légales (`apps/web/src/ui/Legal.tsx`).
3. **Déploiement** : `pnpm deploy` (après `wrangler login`).

| Variable (`wrangler.jsonc`) | Défaut | Rôle |
|---|---|---|
| `ROOM_GRACE_MINUTES` | `30` | Délai avant l'effacement d'une salle vide |
| `EXTRA_ORIGINS` | vide | Origines supplémentaires autorisées |

Aucun secret n'est nécessaire : chaque salle génère ses propres jetons, dont seul le hash est stocké.

### Conseils quel que soit l'hébergement

- **Création de salles** : limitez le débit de `POST /api/rooms` au niveau du proxy, pour éviter qu'un script crée des salles en masse.
- **Hébergement à quota** : une séance de 2 h avec 50 participants représente environ 140 000 messages WebSocket entrants et 12 000 écritures SQLite (mesures dans `docs/adr/0003…`). Le serveur compte les messages de chaque salle, prévient l'enseignant et passe en lecture seule si l'écriture devient impossible.

## Tests

```sh
pnpm test        # droits, protocole, logique de salle sur un vrai SQLite, géométrie, formes, courbes, formules
pnpm typecheck
node scripts/loadtest.mjs http://localhost:8787 50 60   # 50 clients simulés pendant 60 s
```

## Confidentialité et sécurité

- **Navigateur** : seul le *sessionStorage* est utilisé (prénom, jeton de session, lien administrateur), et il est vidé à la fermeture de l'onglet.
- **Salle** : elle ne stocke que les prénoms saisis et le contenu de la séance. Les adresses IP ne sont jamais conservées en clair : un hash salé par salle sert uniquement aux bannissements.
- **Jeton administrateur** : il voyage dans le fragment d'URL (`#admin=…`), n'apparaît donc pas dans les journaux des serveurs, et disparaît de la barre d'adresse au chargement.
- **Contenus des participants** :
  - le LaTeX est rendu sans HTML actif (`trust: false`) ;
  - les expressions des courbes passent par une liste blanche ;
  - la signature des images est vérifiée côté serveur ;
  - une politique CSP stricte s'applique.

## Licence

CQFD est publié sous la licence [PolyForm Noncommercial 1.0.0](LICENSE.md).

- **Autorisé** : utiliser, étudier, modifier et partager le code, pour tout usage **non commercial**. Cela couvre l'usage personnel, les établissements d'enseignement, les associations et les administrations, quel que soit leur financement.
- **Interdit** : tout usage commercial, comme vendre le logiciel ou un service qui l'utilise. Pour un tel usage, contactez l'auteur.
- **Condition** : en redistribuant le code, il faut conserver la licence et la mention de copyright.

Les bibliothèques utilisées restent sous leurs propres licences (MIT, Apache-2.0…), listées dans `licences-tierces.txt` à chaque build.
