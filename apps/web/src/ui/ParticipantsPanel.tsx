import { X } from 'lucide-react'
import type { BoardStore } from '../board/store'

export function ParticipantsPanel({ store, onClose }: { store: BoardStore; onClose: () => void }) {
  const list = [...store.participants].sort(
    (a, b) =>
      Number(b.online) - Number(a.online) ||
      Number(b.role === 'admin') - Number(a.role === 'admin') ||
      a.name.localeCompare(b.name, 'fr'),
  )
  return (
    <aside className="panel" aria-label="Participants">
      <header>
        <h3>Participants ({store.participants.filter((p) => p.online).length} en ligne)</h3>
        <button className="icon" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>
      </header>
      <ul className="people">
        {list.map((p) => (
          <li key={p.id} className={p.online ? '' : 'offline'}>
            <span className={`dot ${p.online ? 'open' : 'closed'}`} />
            <span className="person-name">
              {p.name}
              {p.id === store.me?.id && ' (vous)'}
            </span>
            {p.role === 'admin' ? (
              <span className="badge admin">Prof</span>
            ) : p.canWrite ? (
              <span className="badge write">a la main</span>
            ) : null}
            {store.isAdmin && p.role !== 'admin' && (
              <button className="small" onClick={() => store.send({ t: 'grant', pid: p.id, on: !p.canWrite })}>
                {p.canWrite ? 'Retirer la main' : 'Donner la main'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </aside>
  )
}
