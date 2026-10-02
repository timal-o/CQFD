import { useEffect, useLayoutEffect, useReducer, useRef } from 'react'
import type { FormulaElement, TextElement } from '@cqfd/shared'
import { renderLatex } from '../math/katex'
import { domToBlocks, fillEditor } from './richtext'
import { inkColor } from './render'
import type { BoardStore } from './store'

function useDocVersion(store: BoardStore): void {
  const [, force] = useReducer((n: number) => n + 1, 0)
  useEffect(() => store.onRender((kind) => kind === 'doc' && force()), [store])
  useEffect(() => {
    const unsubscribe = store.subscribe(force)
    return () => {
      unsubscribe()
    }
  }, [store])
}

/** Calque DOM des textes et des formules, transformé par la caméra (voir BoardRenderer). */
export function TextLayer({ store }: { store: BoardStore }) {
  useDocVersion(store)
  const bg = store.page?.bg ?? 'blank'
  return (
    <>
      {store.pageElements().map((el) => {
        if (el.type === 'formula') {
          return <FormulaView key={el.id} store={store} el={el} bg={bg} editing={store.editingId === el.id} />
        }
        if (el.type !== 'text') return null
        return store.editingId === el.id ? (
          <TextEditor key={el.id} store={store} el={el} bg={bg} />
        ) : (
          <TextView key={el.id} store={store} el={el} bg={bg} />
        )
      })}
    </>
  )
}

/** Formule inactive : rendu KaTeX statique (jamais de MathLive ici). */
function FormulaView({ store, el, bg, editing }: { store: BoardStore; el: FormulaElement; bg: string; editing: boolean }) {
  const ref = useMeasure(store, el.id)
  const html = el.latex ? renderLatex(el.latex) : ''
  return (
    <div
      ref={ref}
      className={`formula-el${editing ? ' editing' : ''}${html ? '' : ' empty'}`}
      style={{ left: el.x, top: el.y, fontSize: el.fs, color: inkColor(el.color, bg === 'dark' ? 'dark' : 'blank') }}
      dangerouslySetInnerHTML={{ __html: html || '<span class="formula-empty">formule</span>' }}
    />
  )
}

function useMeasure(store: BoardStore, id: string) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const update = () => {
      const w = node.offsetWidth
      const h = node.offsetHeight
      const prev = store.domSizes.get(id)
      if (prev?.w !== w || prev?.h !== h) {
        store.domSizes.set(id, { w, h })
        store.requestRender('live')
      }
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(node)
    return () => ro.disconnect()
  }, [store, id])
  return ref
}

function boxStyle(el: TextElement, bg: string): React.CSSProperties {
  return {
    left: el.x,
    top: el.y,
    width: el.w,
    fontSize: el.fs,
    color: inkColor(el.color, bg === 'dark' ? 'dark' : 'blank'),
  }
}

function TextView({ store, el, bg }: { store: BoardStore; el: TextElement; bg: string }) {
  const ref = useMeasure(store, el.id)
  return (
    <div ref={ref} className="text-el" style={boxStyle(el, bg)}>
      {el.blocks.map((block, i) => {
        const Tag = block.k === 'p' ? 'div' : block.k
        return (
          <Tag key={i}>
            {block.runs.length === 0 ? <br /> : null}
            {block.runs.map((r, j) => (
              <span
                key={j}
                style={{
                  fontWeight: r.b ? 700 : undefined,
                  fontStyle: r.i ? 'italic' : undefined,
                  color: r.c ? inkColor(r.c, bg === 'dark' ? 'dark' : 'blank') : undefined,
                }}
              >
                {r.s}
              </span>
            ))}
          </Tag>
        )
      })}
    </div>
  )
}

function TextEditor({ store, el, bg }: { store: BoardStore; el: TextElement; bg: string }) {
  const ref = useMeasure(store, el.id)
  const done = useRef(false)

  useLayoutEffect(() => {
    const node = ref.current!
    fillEditor(node, el.blocks)
    node.focus()
    const range = document.createRange()
    range.selectNodeContents(node)
    range.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)

    const finish = () => {
      if (done.current) return
      done.current = true
      const current = store.elements.get(el.id)
      store.commitText(el.id, domToBlocks(node, current?.type === 'text' ? current.color : el.color))
    }
    store.finishEditing = finish
    return () => {
      // Démontage (changement de page, élément supprimé…) : on valide quand même.
      if (!done.current && store.elements.has(el.id)) finish()
      if (store.finishEditing === finish) store.finishEditing = null
    }
    // Le contenu n'est injecté qu'une fois : ensuite le DOM appartient au navigateur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, el.id])

  return (
    <div
      ref={ref}
      data-editor
      className="text-el editing"
      style={boxStyle(el, bg)}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      onBlur={(e) => {
        // Les boutons de mise en forme gardent le focus (preventDefault sur mousedown).
        if (e.relatedTarget instanceof HTMLElement && e.relatedTarget.closest('[data-text-toolbar]')) return
        store.finishEditing?.()
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') {
          e.preventDefault()
          store.finishEditing?.()
        }
      }}
      onPaste={(e) => {
        e.preventDefault()
        const text = e.clipboardData.getData('text/plain')
        document.execCommand('insertText', false, text)
      }}
    />
  )
}
