import { useCallback, useEffect, useRef, useState } from 'react'
import { LIMITS, type ParticipantInfo } from '@cqfd/shared'
import { Hand, MoreHorizontal, Send, Undo2, X } from 'lucide-react'
import type { BoardStore } from '../board/store'
import { Popover } from './Popover'

export type PanelTab = 'people' | 'chat' | 'log'

const time = (at: number) => new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

export function SidePanel({
  store,
  tab,
  onTab,
  onClose,
}: {
  store: BoardStore
  tab: PanelTab
  onTab: (t: PanelTab) => void
  onClose: () => void
}) {
  useEffect(() => {
    store.setChatOpen(tab === 'chat')
    return () => store.setChatOpen(false)
  }, [store, tab])

  const hands = store.participants.filter((p) => p.handAt !== null && p.online).length
  return (
    <aside className="panel" aria-label="Panneau latéral">
      <header>
        <div className="panel-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'people'} className={tab === 'people' ? 'on' : ''} onClick={() => onTab('people')}>
            Participants{store.isAdmin && hands > 0 && <span className="count">{hands}</span>}
          </button>
          <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'on' : ''} onClick={() => onTab('chat')}>
            Chat{store.unreadChat > 0 && <span className="count">{store.unreadChat}</span>}
          </button>
          {store.isAdmin && (
            <button role="tab" aria-selected={tab === 'log'} className={tab === 'log' ? 'on' : ''} onClick={() => onTab('log')}>
              Journal
            </button>
          )}
        </div>
        <button className="icon" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>
      </header>
      {tab === 'people' && <People store={store} />}
      {tab === 'chat' && <Chat store={store} />}
      {tab === 'log' && store.isAdmin && <Journal store={store} />}
    </aside>
  )
}

// ---------------------------------------------------------------- participants

function People({ store }: { store: BoardStore }) {
  const admin = store.isAdmin
  const queue = store.participants
    .filter((p) => p.handAt !== null && p.online)
    .sort((a, b) => a.handAt! - b.handAt!)
  const list = [...store.participants].sort(
    (a, b) =>
      Number(b.online) - Number(a.online) ||
      Number(b.role === 'admin') - Number(a.role === 'admin') ||
      a.name.localeCompare(b.name, 'fr'),
  )
  const online = store.participants.filter((p) => p.online).length

  return (
    <div className="panel-body">
      {admin && queue.length > 0 && (
        <section>
          <h4>Mains levées</h4>
          <ol className="people queue">
            {queue.map((p, i) => (
              <li key={p.id}>
                <span className="queue-rank">{i + 1}</span>
                <span className="person-name">{p.name}</span>
                <button className="small primary-small" onClick={() => store.send({ t: 'grant', pid: p.id, on: true })}>
                  Donner la main
                </button>
                <button className="small" onClick={() => store.send({ t: 'hand', up: false, pid: p.id })} title="Baisser sa main">
                  Baisser
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section>
        <h4>
          {online} en ligne sur {store.participants.length}
        </h4>
        <ul className="people">
          {list.map((p) => (
            <Person key={p.id} store={store} p={p} />
          ))}
        </ul>
      </section>

      {admin && store.bans.length > 0 && (
        <section>
          <h4>Bannis</h4>
          <ul className="people">
            {store.bans.map((b) => (
              <li key={b.id}>
                <span className="person-name">{b.name}</span>
                <span className="muted small-text">{time(b.at)}</span>
                <button className="small" onClick={() => store.send({ t: 'unban', id: b.id })}>
                  Lever le ban
                </button>
              </li>
            ))}
          </ul>
          <p className="warning small-text">
            Un ban bloque aussi l’adresse IP : des élèves sur le même Wi-Fi (lycée, internat) peuvent être bloqués par
            erreur. Levez le ban en cas de doute.
          </p>
        </section>
      )}
    </div>
  )
}

function Person({ store, p }: { store: BoardStore; p: ParticipantInfo }) {
  const [menu, setMenu] = useState<DOMRect | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  const adminActions = store.isAdmin && p.role !== 'admin'
  return (
    <li className={p.online ? '' : 'offline'}>
      <span className={`dot ${p.online ? 'open' : 'closed'}`} />
      <span className="person-name">
        {p.name}
        {p.id === store.me?.id && ' (vous)'}
      </span>
      {p.handAt !== null && (
        <span className="badge hand" title="Main levée">
          <Hand size={12} />
        </span>
      )}
      {p.role === 'admin' ? (
        <span className="badge admin">Prof</span>
      ) : p.canWrite ? (
        <span className="badge write">a la main</span>
      ) : null}
      {adminActions && (
        <>
          <button className="small" onClick={() => store.send({ t: 'grant', pid: p.id, on: !p.canWrite })}>
            {p.canWrite ? 'Retirer la main' : 'Donner la main'}
          </button>
          <button
            className="icon person-more"
            onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())}
            aria-label={`Actions pour ${p.name}`}
            aria-expanded={menu !== null}
          >
            <MoreHorizontal size={16} />
          </button>
          {menu && (
            <Popover anchor={menu} onClose={closeMenu} ignore=".person-more">
                <button
                  onClick={() => {
                    if (confirm(`Exclure ${p.name} ? Il ne pourra pas revenir avec le même onglet.`)) {
                      store.send({ t: 'kick', pid: p.id })
                    }
                  }}
                >
                  Exclure
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    if (
                      confirm(
                        `Bannir ${p.name} ? Son adresse IP sera aussi bloquée : d’autres élèves sur le même Wi-Fi pourraient ne plus pouvoir entrer. Vous pourrez lever le ban.`,
                      )
                    ) {
                      store.send({ t: 'ban', pid: p.id })
                    }
                  }}
                >
                  Bannir (IP)
                </button>
            </Popover>
          )}
        </>
      )}
    </li>
  )
}

// ---------------------------------------------------------------- chat

function Chat({ store }: { store: BoardStore }) {
  const [text, setText] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const disabled = !store.settings.chatEnabled && !store.isAdmin
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [store.chat.length])

  return (
    <div className="panel-body chat">
      <div className="chat-list" ref={list} aria-live="polite">
        {store.chat.length === 0 && <p className="muted small-text">Aucun message pour l’instant.</p>}
        {store.chat.map((m) => (
          <div key={m.seq} className={`chat-msg ${m.by === store.me?.id ? 'mine' : ''}`}>
            <div className="chat-meta">
              <strong>{m.name}</strong> <span className="muted">{time(m.at)}</span>
            </div>
            <div className="chat-text">{m.text}</div>
          </div>
        ))}
      </div>
      {!store.settings.chatEnabled && (
        <p className="muted small-text">{store.isAdmin ? 'Le chat est coupé pour les élèves.' : 'Le professeur a coupé le chat.'}</p>
      )}
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault()
          const t = text.trim()
          if (!t) return
          store.send({ t: 'chat', text: t })
          setText('')
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={LIMITS.maxChatChars}
          placeholder={disabled ? 'Chat coupé' : 'Votre message'}
          disabled={disabled}
          aria-label="Message"
        />
        <button type="submit" className="icon" disabled={disabled || !text.trim()} aria-label="Envoyer">
          <Send size={18} />
        </button>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------- journal

function Journal({ store }: { store: BoardStore }) {
  const entries = [...store.log].reverse()
  return (
    <div className="panel-body">
      {entries.length === 0 && <p className="muted small-text">Les actions apparaîtront ici.</p>}
      <ul className="journal">
        {entries.map((e) => (
          <li key={e.seq}>
            <span className="muted small-text">{time(e.at)}</span>
            <span className="journal-text">
              <strong>{e.name}</strong> {e.summary}
            </span>
            {e.revertable && (
              <button
                className="icon"
                title="Annuler cette action"
                aria-label={`Annuler : ${e.name} ${e.summary}`}
                onClick={() => store.send({ t: 'revert', seq: e.seq })}
              >
                <Undo2 size={16} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
