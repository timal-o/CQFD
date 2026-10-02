import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { LIMITS, sanitizeName } from '@cqfd/shared'
import { Board } from '../board/Board'
import type { BoardController } from '../board/controller'
import { OffscreenIndicators } from '../board/OffscreenIndicators'
import { BoardStore } from '../board/store'
import { captureAdminFragment, session } from '../lib/session'
import { PageTabs } from './PageTabs'
import { ParticipantsPanel } from './ParticipantsPanel'
import { navigate } from './router'
import { ShareDialog } from './ShareDialog'
import { TextToolbar } from './TextToolbar'
import { Toolbar } from './Toolbar'
import { TopBar } from './TopBar'

export function RoomPage({ code }: { code: string }) {
  // Le jeton admin du fragment est lu avant tout, puis retiré de l'URL.
  useState(() => captureAdminFragment(code))
  const [name, setName] = useState(() => session.name(code))

  if (!name) {
    return (
      <NamePrompt
        code={code}
        isAdmin={!!session.adminToken(code)}
        onDone={(n) => {
          session.setName(code, n)
          setName(n)
        }}
      />
    )
  }
  return <Room code={code} name={name} />
}

function NamePrompt({ code, isAdmin, onDone }: { code: string; isAdmin: boolean; onDone: (name: string) => void }) {
  const [value, setValue] = useState(isAdmin ? 'Professeur' : '')
  return (
    <main className="home">
      <form
        className="card narrow"
        onSubmit={(e) => {
          e.preventDefault()
          const n = sanitizeName(value)
          if (n) onDone(n)
        }}
      >
        <h2>
          Salle <span className="mono">{code}</span>
        </h2>
        <label>
          {isAdmin ? 'Votre nom (affiché aux élèves)' : 'Votre prénom'}
          <input value={value} onChange={(e) => setValue(e.target.value)} maxLength={LIMITS.nameMaxLength} autoFocus required />
        </label>
        <button className="primary" type="submit">
          Entrer
        </button>
      </form>
    </main>
  )
}

function Room({ code, name }: { code: string; name: string }) {
  const store = useMemo(
    () =>
      new BoardStore(code, () => ({
        name,
        session: session.token(code),
        admin: session.adminToken(code) ?? undefined,
      })),
    [code, name],
  )
  useEffect(() => {
    store.connect()
    return () => store.dispose()
  }, [store])
  useSyncExternalStore(store.subscribe, () => store.version)

  const [controller, setController] = useState<BoardController | null>(null)
  const onController = useCallback((c: BoardController | null) => setController(c), [])
  const [shareOpen, setShareOpen] = useState(() => session.takeShare(code))
  const [peopleOpen, setPeopleOpen] = useState(false)

  // Pas de sauvegarde : on prévient le prof avant de fermer l'onglet.
  useEffect(() => {
    if (!store.isAdmin) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [store, store.isAdmin])

  if (store.fatal) {
    return (
      <main className="home">
        <div className="card narrow">
          <h2>Connexion impossible</h2>
          <p>{store.fatal.message}</p>
          {store.fatal.code === 'replaced' ? (
            <button className="primary" onClick={() => location.reload()}>
              Reprendre ici
            </button>
          ) : (
            <button className="primary" onClick={() => navigate('/')}>
              Retour à l’accueil
            </button>
          )}
        </div>
      </main>
    )
  }

  return (
    <div className="room">
      <TopBar store={store} onShare={() => setShareOpen(true)} onPeople={() => setPeopleOpen((v) => !v)} />
      <div className="room-main">
        {store.me ? <Board store={store} onController={onController} /> : <div className="board loading">Connexion…</div>}
        {store.me && <OffscreenIndicators store={store} />}
        <Toolbar store={store} controller={controller} />
        {store.editingId && <TextToolbar store={store} />}
        {peopleOpen && <ParticipantsPanel store={store} onClose={() => setPeopleOpen(false)} />}
        {store.status === 'reconnecting' && <div className="banner">Connexion perdue, reconnexion…</div>}
        <div className="toasts" aria-live="polite">
          {store.toasts.map((t) => (
            <div key={t.id} className="toast">
              {t.text}
            </div>
          ))}
        </div>
      </div>
      <PageTabs store={store} />
      {shareOpen && <ShareDialog store={store} onClose={() => setShareOpen(false)} />}
    </div>
  )
}
