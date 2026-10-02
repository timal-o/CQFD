# Plan de développement de CQFD

Référence : [ADR 0001](adr/0001-architecture-et-quotas.md) et [ADR 0002](adr/0002-canevas-maison.md). Chaque phase se termine par un déploiement sur `cqfd.malorey.fr` et des commits atomiques par fonctionnalité.

## Phase 1 : MVP
1. Monorepo pnpm (`apps/web`, `apps/realtime`, `packages/shared`) en TypeScript strict, avec Vitest et ESLint. `pnpm dev` lance Vite et `wrangler dev`.
2. `packages/shared` : protocole du canal de contrôle (types et validation), rôles, fonctions pures de permission. Tests unitaires.
3. Worker :
   - `POST /api/rooms` crée une salle avec un code de 6 caractères et vérifie qu'il est libre ;
   - le Worker hache le jeton admin ;
   - route WebSocket unique `/ws/:code`.
4. Durable Object `Room` :
   - tables SQLite pour la salle, les participants, les bannis et le chat ;
   - éléments en table `WITHOUT ROWID`, droits vérifiés par élément ;
   - WebSocket Hibernation ;
   - alarme de purge.
5. Front :
   - écran d'accueil (créer / rejoindre) ;
   - URL admin avec fragment `#`, puis jeton en sessionStorage ;
   - canevas maison (2 canvas + calque DOM), pages en onglets, stylo, surligneur, gomme par trait, texte ;
   - gomme pixel ;
   - laser.
6. Déploiement sur Cloudflare et domaine personnalisé.

## Phase 2 : formules
Shape « formule » : rendu KaTeX, édition MathLive en lazy-load avec une seule instance, mode LaTeX brut avec aperçu et autocomplétion, clavier virtuel à onglets, `inlineShortcuts`.

## Phase 3 : gestion de classe
Main levée et file d'attente, donner ou retirer la main (sans reconnexion), kick et ban (hash de l'IP et du jeton), verrouillage, gel, limite de participants, liste des participants, chat, flèches hors-champ.

## Phase 4 : historique et export
Vérification de l'annulation personnelle, journal d'actions et annulation par l'admin avec détection de conflit, co-admins (invitations révocables), export PNG et PDF, avertissement avant fermeture.

## Phase 5 : repère et fonds
Shape « repère » avec courbes mathjs (échantillonnage adaptatif, discontinuités), fonds Seyès, petits carreaux, points et sombre, import PDF en fond (pdfjs-dist, compression, blocs en SQLite, plafond de 50 Mo).

## Phase 6 : validation
Test de charge avec 50 clients simulés et mesure réelle des quotas (mise à jour de l'ADR), tests tablette et stylet, accessibilité, README.
