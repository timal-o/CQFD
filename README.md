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

## État d'avancement

Phase 1 (MVP), faite :
- création de salle, rejoindre, rôles, main donnée ou retirée ;
- pages en onglets ;
- stylo (pression), surligneur, gomme par trait ou pixel, texte formaté ;
- sélection, déplacement, redimensionnement ;
- laser, fonds de page, gel et verrouillage.

Les phases suivantes sont décrites dans [docs/plan.md](docs/plan.md).

Raccourcis : `V` sélection, `P` stylo, `S` surligneur, `E` gomme, `T` texte, `L` laser, `H` main. Espace + glisser pour déplacer la vue. Ctrl/⌘ + molette ou pincement pour zoomer. Suppr pour effacer la sélection.
