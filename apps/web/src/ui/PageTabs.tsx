import { useEffect, useRef, useState } from 'react'
import { LIMITS, PAGE_BACKGROUNDS, randomId, type Page, type PageBackground } from '@cqfd/shared'
import { FileUp, MoreHorizontal, Plus } from 'lucide-react'
import type { BoardStore } from '../board/store'
import { importPdf } from '../lib/pdfImport'

const BG_LABELS: Record<PageBackground, string> = {
  blank: 'Blanc',
  seyes: 'Seyès',
  grid: 'Petits carreaux',
  dots: 'Points',
  dark: 'Sombre',
}

export function PageTabs({ store }: { store: BoardStore }) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const pages = store.pages
  const admin = store.isAdmin

  const pageAction = (action: Parameters<BoardStore['send']>[0] & { t: 'page' }) => store.send(action)

  const add = () => {
    const last = pages[pages.length - 1]
    const id = randomId()
    pageAction({ t: 'page', action: { a: 'add', id, name: `Page ${pages.length + 1}`, ord: (last?.ord ?? 0) + 1 } })
    pendingSwitch.current = id
  }
  const pendingSwitch = useRef<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (pendingSwitch.current && pages.some((p) => p.id === pendingSwitch.current)) {
      store.setPage(pendingSwitch.current)
      pendingSwitch.current = null
    }
  }, [pages, store])

  const ordBetween = (a: Page | undefined, b: Page | undefined) =>
    a && b ? (a.ord + b.ord) / 2 : a ? a.ord + 1 : b ? b.ord - 1 : 1

  const duplicate = (p: Page, i: number) => {
    const newId = randomId()
    const name = `${p.name} (copie)`.slice(0, LIMITS.pageNameMaxLength)
    pageAction({ t: 'page', action: { a: 'dup', id: p.id, newId, name, ord: ordBetween(p, pages[i + 1]) } })
    pendingSwitch.current = newId
  }

  const move = (p: Page, i: number, dir: -1 | 1) => {
    const ord = dir < 0 ? ordBetween(pages[i - 2], pages[i - 1]) : ordBetween(pages[i + 1], pages[i + 2])
    pageAction({ t: 'page', action: { a: 'move', id: p.id, ord } })
  }

  return (
    <nav className="tabs" aria-label="Pages">
      <div className="tabs-scroll">
        {pages.map((p, i) => (
          <div key={p.id} className={`tab ${p.id === store.pageId ? 'active' : ''}`}>
            {renaming === p.id ? (
              <RenameInput
                initial={p.name}
                onDone={(name) => {
                  setRenaming(null)
                  if (name && name !== p.name) pageAction({ t: 'page', action: { a: 'rename', id: p.id, name } })
                }}
              />
            ) : (
              <button
                className="tab-label"
                onClick={() => store.setPage(p.id)}
                onDoubleClick={() => admin && setRenaming(p.id)}
                title={admin ? 'Double-clic pour renommer' : p.name}
              >
                {p.name}
                {!admin && p.id === store.adminPage && <span className="prof-here" title="Page affichée par le professeur" />}
              </button>
            )}
            {admin && p.id === store.pageId && (
              <div className="menu-wrap">
                <button className="tab-more" onClick={() => setMenu(menu === p.id ? null : p.id)} aria-label="Options de la page">
                  <MoreHorizontal size={16} />
                </button>
                {menu === p.id && (
                  <PageMenu onClose={() => setMenu(null)}>
                    <button onClick={() => setRenaming(p.id)}>Renommer</button>
                    <button onClick={() => duplicate(p, i)}>Dupliquer</button>
                    <button disabled={i === 0} onClick={() => move(p, i, -1)}>
                      Déplacer à gauche
                    </button>
                    <button disabled={i === pages.length - 1} onClick={() => move(p, i, 1)}>
                      Déplacer à droite
                    </button>
                    <div className="menu-sep">Fond</div>
                    {PAGE_BACKGROUNDS.map((bg) => (
                      <button
                        key={bg}
                        className={p.bg === bg ? 'checked' : ''}
                        onClick={() => pageAction({ t: 'page', action: { a: 'bg', id: p.id, bg } })}
                      >
                        {BG_LABELS[bg]}
                      </button>
                    ))}
                    <div className="menu-sep" />
                    <button
                      className="danger"
                      disabled={pages.length <= 1}
                      onClick={() => {
                        if (confirm(`Supprimer « ${p.name} » et tout son contenu ?`)) {
                          pageAction({ t: 'page', action: { a: 'del', id: p.id } })
                        }
                      }}
                    >
                      Supprimer la page
                    </button>
                  </PageMenu>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {admin && pages.length < LIMITS.maxPages && (
        <button className="tab-add" onClick={add} aria-label="Ajouter une page" title="Ajouter une page">
          <Plus size={16} />
        </button>
      )}
      {admin && (
        <>
          <button className="tab-add" onClick={() => fileInput.current?.click()} aria-label="Importer un PDF" title="Importer un PDF (une page de PDF par page du tableau)">
            <FileUp size={16} />
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) {
                importPdf(store, file).catch((err) => {
                  console.error(err)
                  store.toast('Import du PDF impossible.')
                })
              }
            }}
          />
        </>
      )}
    </nav>
  )
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <input
      className="tab-input"
      value={value}
      autoFocus
      maxLength={LIMITS.pageNameMaxLength}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(value.trim())
        if (e.key === 'Escape') onDone(initial)
      }}
    />
  )
}

function PageMenu({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [onClose])
  return (
    <div ref={ref} className="menu up" role="menu" onClick={(e) => (e.target as HTMLElement).tagName === 'BUTTON' && onClose()}>
      {children}
    </div>
  )
}
