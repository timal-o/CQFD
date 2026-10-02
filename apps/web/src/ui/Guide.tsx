import { useEffect } from 'react'
import { navigate } from './router'
import { SiteFooter, SiteHeader } from './SiteHeader'

const SECTIONS: [id: string, title: string][] = [
  ['demarrer', 'Démarrer une séance'],
  ['rejoindre', 'Rejoindre (élèves)'],
  ['outils', 'Les outils'],
  ['maths', 'Écrire des maths'],
  ['courbes', 'Repère et courbes'],
  ['pages', 'Pages, fonds et PDF'],
  ['classe', 'Gérer la classe'],
  ['historique', 'Annuler et journal'],
  ['exporter', 'Exporter le travail'],
  ['tablette', 'Tablette et téléphone'],
  ['raccourcis', 'Raccourcis clavier'],
  ['vie-privee', 'Vie privée'],
]

const K = ({ children }: { children: React.ReactNode }) => <kbd>{children}</kbd>

export function Guide() {
  useEffect(() => {
    document.title = 'Guide · CQFD'
    window.scrollTo(0, 0)
    return () => {
      document.title = 'CQFD'
    }
  }, [])

  return (
    <div className="doc-layout">
      <SiteHeader />
      <main className="doc">
        <h1>Guide de CQFD</h1>
        <p className="lead">
          CQFD est un tableau blanc partagé pour faire des maths à distance : le prof écrit, montre au laser, donne la
          main aux élèves, et tout le monde voit la même chose en direct. Pas de compte, pas d’installation, rien n’est
          conservé après la séance.
        </p>

        <nav className="toc" aria-label="Sommaire">
          {SECTIONS.map(([id, title]) => (
            <a key={id} href={`#${id}`}>
              {title}
            </a>
          ))}
        </nav>

        <section id="demarrer">
          <h2>Démarrer une séance</h2>
          <ol>
            <li>Sur la page d’accueil, indiquez votre nom puis cliquez sur <strong>Créer un tableau</strong>.</li>
            <li>
              Une fenêtre affiche le <strong>code de la salle</strong> (6 caractères), un lien direct et un QR code :
              donnez l’un des trois aux élèves (sur Discord, Teams, au tableau…).
            </li>
            <li>
              Elle affiche aussi votre <strong>lien administrateur secret</strong>. Gardez-le pour revenir dans la salle
              en tant que prof depuis un autre onglet ou un autre appareil. Ne le partagez pas avec les élèves.
            </li>
          </ol>
          <p className="note">
            Rien n’est sauvegardé : quand tout le monde a quitté la salle, elle est effacée au bout de 30 minutes.
            Pensez à <a href="#exporter">exporter</a> avant de partir.
          </p>
        </section>

        <section id="rejoindre">
          <h2>Rejoindre (élèves)</h2>
          <ol>
            <li>Ouvrez le lien donné par le prof, scannez le QR code, ou saisissez le code sur la page d’accueil.</li>
            <li>Indiquez votre prénom (le prénom suffit, inutile de donner votre nom de famille).</li>
          </ol>
          <p>
            Au départ, vous êtes en <strong>lecture seule</strong> : vous voyez tout, mais vous ne pouvez pas écrire.
            Cliquez sur <strong>Lever la main</strong> en haut à droite ; quand le prof vous donne la main, le badge
            passe à « Vous avez la main » et les outils se débloquent. Vous ne pouvez modifier ou effacer que ce que vous
            avez écrit vous-même.
          </p>
          <p>
            L’option <strong>Suivre le prof</strong> vous amène automatiquement sur la page qu’il affiche. Votre zoom et
            votre position restent libres.
          </p>
        </section>

        <section id="outils">
          <h2>Les outils</h2>
          <dl>
            <dt>Sélection</dt>
            <dd>
              Cliquez sur un élément pour le sélectionner, glissez pour le déplacer, tirez un coin pour le
              redimensionner, ou tracez un rectangle pour en sélectionner plusieurs. <K>Suppr</K> efface la sélection.
            </dd>
            <dt>Stylo et surligneur</dt>
            <dd>
              Trois épaisseurs, plusieurs couleurs. Avec un stylet, le trait suit la pression. Maintenez{' '}
              <K>Maj</K> pour tracer un <strong>trait droit</strong> (il se cale sur l’horizontale, la verticale ou 45°).
              Pour une <strong>forme propre</strong>, dessinez-la à main levée (cercle, ellipse, rectangle, triangle,
              trait) puis <strong>restez immobile une demi-seconde</strong> avant de lever le stylo : elle est
              remplacée par une forme nette.
            </dd>
            <dt>Gomme</dt>
            <dd>
              Mode <strong>Trait</strong> : efface un trait entier d’un simple passage. Mode <strong>Pixel</strong> :
              n’efface que la partie touchée.
            </dd>
            <dt>Texte</dt>
            <dd>
              Cliquez pour écrire. La barre en haut permet gras, italique, titres, couleur et taille. Double-cliquez sur
              un texte pour le modifier.
            </dd>
            <dt>Formule (Σ)</dt>
            <dd>
              Voir <a href="#maths">Écrire des maths</a>.
            </dd>
            <dt>Repère</dt>
            <dd>
              Voir <a href="#courbes">Repère et courbes</a>.
            </dd>
            <dt>Pointeur laser</dt>
            <dd>
              Réservé au prof (il peut l’autoriser aux élèves qui ont la main). Maintenez le clic et bougez : tout le
              monde voit un point rouge et une traînée qui s’efface.
            </dd>
            <dt>Main</dt>
            <dd>Déplace la vue. Ctrl + molette ou le pincement zooment.</dd>
          </dl>
          <p>
            Quand quelqu’un écrit ou pointe hors de votre écran, une <strong>flèche</strong> apparaît au bord avec son
            nom : cliquez dessus pour y aller.
          </p>
        </section>

        <section id="maths">
          <h2>Écrire des maths</h2>
          <p>
            Choisissez l’outil <strong>Formule (Σ)</strong> puis cliquez sur le tableau. Un éditeur s’ouvre en bas de
            l’écran, avec deux modes :
          </p>
          <ul>
            <li>
              <strong>Visuel</strong> : la formule s’écrit comme elle s’affiche. Les cases vides se remplissent dans
              l’ordre avec <K>Tab</K> ou les flèches.
            </li>
            <li>
              <strong>LaTeX brut</strong> : pour ceux qui connaissent LaTeX, avec aperçu en direct. Tapez <code>\bin</code>{' '}
              puis <K>Tab</K> pour compléter en <code>\binom{'{}{}'}</code>.
            </li>
          </ul>
          <p>
            Le bouton <strong>Clavier</strong> ouvre un clavier mathématique déplaçable, avec des onglets{' '}
            <em>Analyse</em>, <em>Algèbre</em>, <em>Ensembles</em>, <em>Probas/Stats</em>, <em>Grec et relations</em>,{' '}
            <em>123</em> et <em>abc</em>. Sur tablette, il s’ouvre tout seul.
          </p>
          <h3>Raccourcis de frappe</h3>
          <table>
            <thead>
              <tr>
                <th>Tapez</th>
                <th>Pour obtenir</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>/</code>
                </td>
                <td>une fraction</td>
              </tr>
              <tr>
                <td>
                  <code>^</code> et <code>_</code>
                </td>
                <td>une puissance, un indice</td>
              </tr>
              <tr>
                <td>
                  <code>sum</code>, <code>prod</code>, <code>int</code>
                </td>
                <td>Σ, Π, ∫ avec leurs bornes</td>
              </tr>
              <tr>
                <td>
                  <code>lim</code>, <code>sqrt</code>, <code>binom</code>, <code>inf</code>
                </td>
                <td>limite, racine, coefficient binomial, ∞</td>
              </tr>
              <tr>
                <td>
                  <code>alpha</code>, <code>lambda</code>, <code>pi</code>…
                </td>
                <td>α, λ, π…</td>
              </tr>
              <tr>
                <td>
                  <code>RR</code>, <code>NN</code>, <code>PP</code>, <code>EE</code>
                </td>
                <td>ℝ, ℕ, ℙ, 𝔼</td>
              </tr>
              <tr>
                <td>
                  <code>=&gt;</code>, <code>&lt;=&gt;</code>, <code>&lt;=</code>, <code>!=</code>
                </td>
                <td>⇒, ⇔, ≤, ≠</td>
              </tr>
            </tbody>
          </table>
          <p>
            <K>Entrée</K> valide, <K>Échap</K> annule. Pendant la saisie, seule la personne qui écrit voit la formule ;
            les autres la voient dès qu’elle est validée.
          </p>
        </section>

        <section id="courbes">
          <h2>Repère et courbes</h2>
          <p>
            L’outil <strong>Repère</strong> pose un repère orthonormé avec grille. Dans le panneau qui s’ouvre :
          </p>
          <ul>
            <li>réglez la fenêtre (x min, x max, y min, y max) et la grille ;</li>
            <li>
              <strong>Ajouter une courbe</strong> : saisissez <em>f(x)</em> avec le même éditeur que les formules (par
              exemple <code>1/x</code>, <code>x^2-2</code>, <code>\sin(x)</code>, <code>e^&#123;-x&#125;</code>,{' '}
              <code>\sqrt&#123;x&#125;</code>, <code>|x|</code>) ;
            </li>
            <li>cliquez sur la pastille de couleur pour changer la couleur d’une courbe.</li>
          </ul>
          <p>
            Les valeurs interdites et les asymptotes sont gérées (1/x n’est pas reliée en 0). Chaque modification
            s’affiche aussitôt chez tout le monde. Double-cliquez sur un repère pour le modifier.
          </p>
        </section>

        <section id="pages">
          <h2>Pages, fonds et PDF</h2>
          <ul>
            <li>
              Les pages sont des onglets en bas de l’écran. Le prof peut en ajouter (+), les renommer (double-clic), et
              via le menu « ⋯ » de la page active : dupliquer, déplacer, supprimer, changer le fond (blanc, Seyès,
              petits carreaux, points, sombre).
            </li>
            <li>
              <strong>Importer un PDF</strong> (icône à côté du +) : chaque page du PDF devient une page du tableau,
              avec le PDF en fond. Idéal pour annoter un énoncé ou un corrigé. Jusqu’à 30 pages.
            </li>
          </ul>
        </section>

        <section id="classe">
          <h2>Gérer la classe (prof)</h2>
          <ul>
            <li>
              <strong>Mains levées</strong> : une notification apparaît, et l’onglet Participants affiche la file dans
              l’ordre d’arrivée. <em>Donner la main</em> autorise l’élève à écrire (plusieurs élèves peuvent l’avoir en
              même temps) ; <em>Retirer la main</em> le remet en lecture seule.
            </li>
            <li>
              Menu <strong>⚙</strong> : geler le tableau (plus personne n’écrit sauf vous), verrouiller la salle (plus
              de nouvelles entrées), autoriser le laser aux élèves, ouvrir ou couper le chat, limiter le nombre de
              participants.
            </li>
            <li>
              <strong>Exclure</strong> déconnecte l’élève. <strong>Bannir</strong> bloque aussi son adresse IP :
              attention, des élèves sur le même Wi-Fi peuvent être bloqués par erreur. La liste des bannis permet de
              lever un ban.
            </li>
            <li>
              <strong>Co-admins</strong> : dans la fenêtre de partage (clic sur le code de la salle), créez un lien pour
              un collègue. Vous pouvez le révoquer à tout moment.
            </li>
          </ul>
        </section>

        <section id="historique">
          <h2>Annuler et journal</h2>
          <p>
            <K>Ctrl</K> + <K>Z</K> annule votre dernière action, <K>Ctrl</K> + <K>Y</K> la rétablit. Chacun n’annule
            que ses propres actions, jamais celles des autres.
          </p>
          <p>
            Le prof dispose d’un <strong>Journal</strong> (onglet du panneau latéral) : « Léa a ajouté un trait »,
            « Tom a effacé une formule »… Le bouton d’annulation à côté de chaque ligne rétablit l’état d’avant ; si
            l’élément a été modifié depuis, une confirmation est demandée.
          </p>
        </section>

        <section id="exporter">
          <h2>Exporter le travail</h2>
          <p>
            Bouton <strong>Exporter</strong> en haut à droite : la <strong>page actuelle en PNG</strong> ou{' '}
            <strong>toutes les pages en PDF</strong>. L’export se fait dans votre navigateur ; tout le monde peut
            exporter, y compris les élèves.
          </p>
        </section>

        <section id="tablette">
          <h2>Tablette et téléphone</h2>
          <ul>
            <li>
              Avec un stylet, la <strong>paume est ignorée</strong> : dès que le stylet est détecté, les doigts servent
              seulement à déplacer et à zoomer.
            </li>
            <li>Sans stylet, un doigt dessine ; deux doigts déplacent et zooment.</li>
            <li>Sur téléphone, la barre d’outils passe en bas de l’écran.</li>
          </ul>
        </section>

        <section id="raccourcis">
          <h2>Raccourcis clavier</h2>
          <table>
            <tbody>
              <tr>
                <td>
                  <K>V</K> <K>P</K> <K>S</K> <K>E</K>
                </td>
                <td>sélection, stylo, surligneur, gomme</td>
              </tr>
              <tr>
                <td>
                  <K>T</K> <K>F</K> <K>G</K>
                </td>
                <td>texte, formule, repère</td>
              </tr>
              <tr>
                <td>
                  <K>L</K> <K>H</K>
                </td>
                <td>laser, main</td>
              </tr>
              <tr>
                <td>
                  <K>Espace</K> + glisser
                </td>
                <td>déplacer la vue</td>
              </tr>
              <tr>
                <td>
                  <K>Ctrl</K> + molette
                </td>
                <td>zoomer</td>
              </tr>
              <tr>
                <td>
                  <K>Ctrl</K> + <K>Z</K> / <K>Y</K>
                </td>
                <td>annuler / rétablir</td>
              </tr>
              <tr>
                <td>
                  <K>Suppr</K>
                </td>
                <td>effacer la sélection</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section id="vie-privee">
          <h2>Vie privée</h2>
          <p>
            Aucun compte, aucun cookie, aucune statistique. Seuls le prénom saisi et le contenu de la séance sont
            conservés, le temps de la séance, puis tout est effacé. Le détail est dans les{' '}
            <a
              href="/mentions-legales"
              onClick={(e) => {
                e.preventDefault()
                navigate('/mentions-legales')
              }}
            >
              mentions légales
            </a>
            .
          </p>
          <p className="note">
            Le service est gratuit et hébergé sur l’offre gratuite de Cloudflare : en cas de très forte utilisation
            dans la journée, le tableau peut passer en lecture seule jusqu’au lendemain (vers 2 h du matin). Un message
            le signale ; exportez alors votre travail.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
