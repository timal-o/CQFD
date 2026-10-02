import { useEffect, useRef, useState } from 'react'
import { LIMITS } from '@cqfd/shared'
import { Lock, Settings, Share2, Snowflake, Users } from 'lucide-react'
import type { BoardStore } from '../board/store'

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

export function TopBar({ store, onShare, onPeople }: { store: BoardStore; onShare: () => void; onPeople: () => void }) {
  const online = store.participants.filter((p) => p.online).length
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
        {!store.isAdmin && (
          <label className="toggle" title="Afficher automatiquement la page du professeur">
            <input type="checkbox" checked={store.follow} onChange={(e) => store.setFollow(e.target.checked)} />
            Suivre le prof
          </label>
        )}
        {store.isAdmin && <RoomSettingsMenu store={store} />}
        <button className="chip" onClick={onPeople} title="Participants">
          <Users size={16} /> {online}
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
