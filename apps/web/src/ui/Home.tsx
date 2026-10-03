import { useState } from 'react'
import { CODE_LENGTH, isValidCode, LIMITS, normalizeCode, sanitizeName } from '@cqfd/shared'
import { createRoom } from '../lib/api'
import { CQFD_MEANINGS, isPiDay } from '../lib/easterEggs'
import { session } from '../lib/session'
import { navigate } from './router'
import { SiteFooter, SiteHeader } from './SiteHeader'

export function Home() {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [profName, setProfName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [meaning, setMeaning] = useState(0)
  const [piDay] = useState(() => isPiDay())

  const join = (e: React.FormEvent) => {
    e.preventDefault()
    const c = normalizeCode(code)
    const n = sanitizeName(name)
    if (!isValidCode(c)) return setError('Le code de salle comporte 6 caractères (lettres et chiffres).')
    if (!n) return setError('Indiquez votre prénom.')
    session.setName(c, n)
    navigate(`/s/${c}`)
  }

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const room = await createRoom()
      session.setAdminToken(room.code, room.adminToken)
      session.setName(room.code, sanitizeName(profName) || 'Professeur')
      session.markShare(room.code)
      navigate(`/s/${room.code}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Création impossible.')
      setBusy(false)
    }
  }

  return (
    <div className="doc-layout">
      <SiteHeader />
      <main className="home">
        <header className="home-header">
          <h1 className="logo">
            <button
              className="logo-button"
              onClick={() => setMeaning((m) => (m + 1) % CQFD_MEANINGS.length)}
              title={piDay ? 'Joyeux jour de π !' : 'CQFD, ça veut dire quoi déjà ?'}
            >
              CQFD
              <span className={`qed${piDay ? ' pi' : ''}`} aria-hidden>
                {piDay ? 'π' : '∎'}
              </span>
            </button>
          </h1>
          <p>
            <span key={meaning} className={meaning ? 'meaning flip' : 'meaning'}>
              {CQFD_MEANINGS[meaning]}
            </span>
            {meaning === 0 ? ' : le tableau blanc de maths de la classe, en temps réel.' : ''}
          </p>
          {piDay && <p className="piday">🥧 Joyeux jour de π ! π ≈ 3,14159 26535 89793…</p>}
        </header>

        <div className="home-cards">
          <form className="card" onSubmit={join}>
            <h2>Rejoindre un tableau</h2>
            <label>
              Code de la salle
              <input
                className="code-input"
                value={code}
                onChange={(e) => setCode(normalizeCode(e.target.value).slice(0, CODE_LENGTH))}
                placeholder="ABC234"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                inputMode="text"
                required
              />
            </label>
            <label>
              Votre prénom
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={LIMITS.nameMaxLength}
                autoComplete="off"
                required
              />
            </label>
            <button className="primary" type="submit">
              Rejoindre
            </button>
          </form>

          <div className="card">
            <h2>Créer un tableau</h2>
            <p className="muted">Pour le professeur. Pas de compte : vous recevez un code pour la classe et un lien administrateur secret.</p>
            <label>
              Votre nom (affiché aux élèves)
              <input
                value={profName}
                onChange={(e) => setProfName(e.target.value)}
                maxLength={LIMITS.nameMaxLength}
                placeholder="Professeur"
                autoComplete="off"
              />
            </label>
            <button className="primary" type="button" onClick={create} disabled={busy}>
              {busy ? 'Création…' : 'Créer un tableau'}
            </button>
          </div>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <footer className="home-footer">
          Aucun compte, aucun cookie, aucune statistique. Seul le prénom saisi est conservé, le temps de la séance :
          tout est effacé quand la salle se vide.
        </footer>
      </main>
      <SiteFooter />
    </div>
  )
}
