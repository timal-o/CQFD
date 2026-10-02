import { useEffect, useRef, useState } from 'react'
import { LIMITS } from '@cqfd/shared'
import { Download, Hand, Lock, MessageSquare, Settings, Share2, Snowflake, Users } from 'lucide-react'
import type { BoardStore } from '../board/store'
import { exportPdf, exportPng } from '../lib/export'
import type { PanelTab } from './SidePanel'

function MyStatus({ store }: { store: BoardStore }) {
  const me = store.me
  if (!me) return null
  if (me.role === 'admin') return <span className="badge admin">Professeur</span>
  if (store.settings.frozen) return <span className="badge frozen">Tableau gelé</span>
  return me.canWrite ? (
    <span className="badge write">Vous avez la main</span>
  ) : (
    <span className="badge read">Lecture seule</span>
  )
}

export function TopBar({
  store,
  onShare,
  onPanel,
}: {
  store: BoardStore
  onShare: () => void
  onPanel: (tab: PanelTab) => void
}) {
  const online = store.participants.filter((p) => p.online).length
  const hands = store.participants.filter((p) => p.handAt !== null && p.online).length
  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="logo small">CQFD</span>
        <button className="chip mono" onClick={onShare} title="Partager la salle">
          {store.code}
          <Share2 size={14} />
        </button>
        <span className={`dot ${store.status}`} title={store.status === 'open' ? 'Connecté' : 'Connexion…'} />
      </div>
      <div className="topbar-center">
        <MyStatus store={store} />
        {store.settings.frozen && store.isAdmin && (
          <span className="badge frozen">
            <Snowflake size={12} /> Gelé
          </span>
        )}
        {store.settings.locked && store.isAdmin && (
          <span className="badge">
            <Lock size={12} /> Verrouillée
          </span>
        )}
      </div>
      <div className="topbar-right">
        {!store.isAdmin && store.me && !store.me.canWrite && (
          <button
            className={`chip hand-btn ${store.handUp ? 'up' : ''}`}
            onClick={() => store.send({ t: 'hand', up: !store.handUp })}
            aria-pressed={store.handUp}
          >
            <Hand size={16} /> {store.handUp ? 'Main levée' : 'Lever la main'}
          </button>
        )}
        {!store.isAdmin && (
          <label className="toggle" title="Afficher automatiquement la page du professeur">
            <input type="checkbox" checked={store.follow} onChange={(e) => store.setFollow(e.target.checked)} />
            Suivre le prof
          </label>
        )}
        <ExportMenu store={store} />
        {store.isAdmin && <RoomSettingsMenu store={store} />}
        <button className="chip" onClick={() => onPanel('chat')} title="Chat" aria-label={`Chat, ${store.unreadChat} non lus`}>
          <MessageSquare size={16} />
          {store.unreadChat > 0 && <span className="count">{store.unreadChat}</span>}
        </button>
        <button className="chip" onClick={() => onPanel('people')} title="Participants" aria-label={`Participants : ${online} en ligne`}>
          <Users size={16} /> {online}
          {store.isAdmin && hands > 0 && (
            <span className="count hand-count">
              <Hand size={11} /> {hands}
            </span>
          )}
        </button>
      </div>
    </header>
  )
}

function RoomSettingsMenu({ store }: { store: BoardStore }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const s = store.settings
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="chip" onClick={() => setOpen((v) => !v)} title="Réglages de la salle" aria-expanded={open}>
        <Settings size={16} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <label className="menu-row">
            <input type="checkbox" checked={s.frozen} onChange={(e) => store.send({ t: 'settings', frozen: e.target.checked })} />
            Geler le tableau (seul le prof écrit)
          </label>
          <label className="menu-row">
            <input type="checkbox" checked={s.locked} onChange={(e) => store.send({ t: 'settings', locked: e.target.checked })} />
            Verrouiller la salle (plus de nouvelles entrées)
          </label>
          <label className="menu-row">
            <input
              type="checkbox"
              checked={s.laserForStudents}
              onChange={(e) => store.send({ t: 'settings', laserForStudents: e.target.checked })}
            />
            Laser autorisé aux élèves qui ont la main
          </label>
          <label className="menu-row">
            <input type="checkbox" checked={s.chatEnabled} onChange={(e) => store.send({ t: 'settings', chatEnabled: e.target.checked })} />
            Chat ouvert aux élèves
          </label>
          <label className="menu-row">
            Participants max
            <input
              type="number"
              min={LIMITS.minParticipants}
              max={LIMITS.maxParticipants}
              value={s.maxParticipants}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value))
                if (n >= LIMITS.minParticipants && n <= LIMITS.maxParticipants) {
                  store.send({ t: 'settings', maxParticipants: n })
                }
              }}
            />
          </label>
        </div>
      )}
    </div>
  )
}

function ExportMenu({ store }: { store: BoardStore }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const run = async (fn: (s: BoardStore) => Promise<void>) => {
    setOpen(false)
    setBusy(true)
    try {
      await fn(store)
    } catch (err) {
      console.error(err)
      store.toast('L’export a échoué.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="menu-wrap" ref={ref}>
      <button className="chip" onClick={() => setOpen((v) => !v)} title="Exporter" aria-expanded={open} disabled={busy}>
        <Download size={16} />
        {busy && <span className="small-text">…</span>}
      </button>
      {open && (
        <div className="menu" role="menu">
          <button onClick={() => run(exportPng)}>Page actuelle en PNG</button>
          <button onClick={() => run(exportPdf)}>Toutes les pages en PDF</button>
          <p className="menu-note">Rien n’est sauvegardé sur le serveur : exportez avant de quitter.</p>
        </div>
      )}
    </div>
  )
}
