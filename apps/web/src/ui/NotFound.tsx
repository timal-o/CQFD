import { useEffect } from 'react'
import { navigate } from './router'
import { SiteFooter, SiteHeader } from './SiteHeader'

/** Page 404 : une démonstration par l'absurde, écrite à la craie ligne par ligne. */
export function NotFound({ path }: { path: string }) {
  useEffect(() => {
    document.title = '404 · CQFD'
    return () => {
      document.title = 'CQFD'
    }
  }, [])

  const shown = path.length > 40 ? path.slice(0, 39) + '…' : path
  const lines = [
    <>
      Supposons, par l’absurde, que la page <code>{shown}</code> existe.
    </>,
    <>Alors le serveur l’aurait trouvée.</>,
    <>Or il l’a cherchée partout (même sous le tableau).</>,
    <>Contradiction.</>,
    <>Donc cette page n’existe pas.</>,
  ]

  return (
    <div className="doc-layout">
      <SiteHeader />
      <main className="notfound">
        <p className="notfound-code" aria-hidden>
          404
        </p>
        <div className="chalkboard" role="img" aria-label={`Page introuvable : ${path}`}>
          {lines.map((line, i) => (
            <p key={i} className="chalk-line" style={{ animationDelay: `${0.3 + i * 0.9}s` }}>
              {line}
            </p>
          ))}
          <p className="chalk-line chalk-qed" style={{ animationDelay: `${0.3 + lines.length * 0.9}s` }}>
            CQFD ∎
          </p>
        </div>
        <div className="notfound-actions">
          <button className="primary" onClick={() => navigate('/')}>
            Retourner à l’origine (0, 0)
          </button>
          <button className="chip" onClick={() => navigate('/guide')}>
            Consulter le guide
          </button>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
