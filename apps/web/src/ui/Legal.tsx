import { useEffect } from 'react'
import { SITE } from '../site'
import { SiteFooter, SiteHeader } from './SiteHeader'

const LIBRARIES: [name: string, license: string][] = [
  ['React', 'MIT'],
  ['KaTeX', 'MIT'],
  ['MathLive', 'MIT'],
  ['mathjs', 'Apache-2.0'],
  ['pdf.js', 'Apache-2.0'],
  ['pdf-lib', 'MIT'],
  ['html-to-image', 'MIT'],
  ['perfect-freehand', 'MIT'],
  ['Lucide', 'ISC'],
  ['zod', 'MIT'],
]

export function Legal() {
  useEffect(() => {
    document.title = 'Mentions légales · CQFD'
    window.scrollTo(0, 0)
    return () => {
      document.title = 'CQFD'
    }
  }, [])

  const github = SITE.links.find((l) => l.kind === 'github' && l.url)?.url
  const contact = SITE.contactEmail ? (
    <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>
  ) : github ? (
    <a href={github} target="_blank" rel="noopener noreferrer">
      via GitHub
    </a>
  ) : null

  return (
    <div className="doc-layout">
      <SiteHeader />
      <main className="doc">
        <h1>Mentions légales et confidentialité</h1>

        <section>
          <h2>Éditeur</h2>
          {SITE.publisher ? (
            <p>
              Site édité par {SITE.publisher}, à titre non professionnel et gratuit.
            </p>
          ) : (
            <p>
              Site édité par un particulier, à titre non professionnel et gratuit. Conformément à l’article 6-III-2 de
              la loi pour la confiance dans l’économie numérique (LCEN), l’éditeur a choisi de ne pas rendre public son
              nom ; ses coordonnées ont été communiquées à l’hébergeur.
            </p>
          )}
          {contact && <p>Contact : {contact}</p>}
        </section>

        <section>
          <h2>Hébergeur</h2>
          <p>
            Cloudflare, Inc., 101 Townsend St, San Francisco, CA 94107, États-Unis —{' '}
            <a href="https://www.cloudflare.com" target="_blank" rel="noopener noreferrer">
              www.cloudflare.com
            </a>
          </p>
        </section>

        <section>
          <h2>Données personnelles</h2>
          <p>CQFD est conçu pour collecter le moins de données possible : pas de compte, pas de cookie, pas de statistiques, pas de publicité.</p>
          <h3>Données traitées</h3>
          <ul>
            <li>le <strong>prénom</strong> (ou pseudonyme) saisi en entrant dans une salle ;</li>
            <li>le <strong>contenu de la séance</strong> : traits, textes, formules, images importées, messages du chat ;</li>
            <li>
              une <strong>empreinte de l’adresse IP</strong> (hachée avec une valeur propre à chaque salle, l’adresse
              elle-même n’est pas conservée), utilisée uniquement si le professeur bannit un participant ;
            </li>
            <li>
              un <strong>jeton de session aléatoire</strong>, conservé haché, qui permet de se reconnecter avec la
              même identité.
            </li>
          </ul>
          <h3>Finalité et base légale</h3>
          <p>
            Ces données servent uniquement à faire fonctionner le tableau partagé pendant la séance (affichage des
            participants, droits d’écriture, modération). Base légale : l’exécution du service demandé et l’intérêt
            légitime à assurer son bon fonctionnement (article 6 du RGPD).
          </p>
          <h3>Durée de conservation</h3>
          <p>
            Tout est stocké dans la salle elle-même et <strong>effacé intégralement</strong> 30 minutes après le
            départ du dernier participant. Rien n’est archivé ni sauvegardé.
          </p>
          <h3>Destinataires</h3>
          <p>
            Le prénom, le contenu et le chat sont visibles des autres participants de la salle. Les données sont
            hébergées par Cloudflare, qui agit comme sous-traitant et peut les traiter hors de l’Union européenne, dans
            le cadre du Data Privacy Framework UE–États-Unis et de clauses contractuelles types. Cloudflare peut
            conserver ses propres journaux techniques (par exemple l’adresse IP de connexion) selon sa{' '}
            <a href="https://www.cloudflare.com/fr-fr/privacypolicy/" target="_blank" rel="noopener noreferrer">
              politique de confidentialité
            </a>
            .
          </p>
          <h3>Stockage dans le navigateur</h3>
          <p>
            Le site utilise uniquement le <em>sessionStorage</em> du navigateur (prénom, jeton de session, lien
            administrateur), effacé à la fermeture de l’onglet. Ce stockage est strictement nécessaire au service et ne
            nécessite donc pas de consentement.
          </p>
          <h3>Mineurs</h3>
          <p>
            Le service peut être utilisé par des élèves mineurs. Seul un prénom est demandé : il est recommandé de ne
            pas indiquer son nom de famille ni d’informations personnelles dans le tableau ou le chat.
          </p>
          <h3>Vos droits</h3>
          <p>
            Vous disposez d’un droit d’accès, de rectification, d’effacement et d’opposition. Les données disparaissant
            d’elles-mêmes à la fin de la séance, le plus simple est de quitter la salle ; pour toute question
            {contact ? <>, contactez l’éditeur : {contact}</> : ', contactez l’éditeur'}. Vous pouvez aussi adresser une
            réclamation à la{' '}
            <a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer">
              CNIL
            </a>
            .
          </p>
        </section>

        <section>
          <h2>Code et bibliothèques</h2>
          <p>
            CQFD s’appuie sur des logiciels libres :{' '}
            {LIBRARIES.map(([name, license], i) => (
              <span key={name}>
                {name} ({license}){i < LIBRARIES.length - 1 ? ', ' : '.'}
              </span>
            ))}
            {github && (
              <>
                {' '}
                Le code source est disponible sur{' '}
                <a href={github} target="_blank" rel="noopener noreferrer">
                  GitHub
                </a>
                .
              </>
            )}
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
