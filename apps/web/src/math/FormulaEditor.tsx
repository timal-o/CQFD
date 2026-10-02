import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormulaElement } from '@cqfd/shared'
import { Check, Keyboard, X } from 'lucide-react'
import type { BoardStore } from '../board/store'
import { INLINE_SHORTCUTS, LATEX_COMMANDS } from './config'
import { renderLatex } from './katex'
import { loadMathLive } from './mathlive'
import { MathKeyboard } from './MathKeyboard'

type Mode = 'visual' | 'latex'

let preferredMode: Mode = 'visual'

/**
 * Éditeur de la formule en cours : mode visuel (MathLive, une seule instance montée)
 * ou LaTeX brut avec aperçu. La source LaTeX est partagée : basculer ne perd rien.
 * L'aperçu sur le tableau est local ; la formule n'est envoyée qu'à la validation.
 */
export function FormulaEditor({ store }: { store: BoardStore }) {
  const id = store.editingId!
  const initial = store.elements.get(id) as FormulaElement
  const [latex, setLatexState] = useState(initial.latex)
  const latexRef = useRef(initial.latex)
  const [mode, setMode] = useState<Mode>(preferredMode)
  const [keyboard, setKeyboard] = useState(() => window.matchMedia('(pointer: coarse)').matches)
  const raf = useRef(0)

  const setLatex = (value: string) => {
    latexRef.current = value
    setLatexState(value)
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      const el = store.elements.get(id)
      if (el?.type === 'formula') store.applyLocal([{ o: 'put', el: { ...el, latex: value } }])
    })
  }

  useEffect(() => {
    const finish = () => store.commitFormula(id, latexRef.current)
    store.finishEditing = finish
    return () => {
      cancelAnimationFrame(raf.current)
      if (store.finishEditing === finish) store.finishEditing = null
    }
  }, [store, id])

  const validate = () => store.finishEditing?.()
  const cancel = () => store.cancelEditing()
  const switchMode = (m: Mode) => {
    preferredMode = m
    setMode(m)
  }

  return (
    <>
      <div
        className="formula-editor"
        data-no-shortcuts
        role="dialog"
        aria-label="Édition de formule"
        onMouseDown={(e) => {
          // Les boutons ne doivent pas retirer le focus du champ de saisie.
          if ((e.target as HTMLElement).closest('button')) e.preventDefault()
        }}
      >
        <div className="fe-head">
          <div className="segmented" role="tablist">
            <button role="tab" aria-selected={mode === 'visual'} className={mode === 'visual' ? 'on' : ''} onClick={() => switchMode('visual')}>
              Visuel
            </button>
            <button role="tab" aria-selected={mode === 'latex'} className={mode === 'latex' ? 'on' : ''} onClick={() => switchMode('latex')}>
              LaTeX brut
            </button>
          </div>
          {mode === 'visual' && (
            <button className={`fe-btn ${keyboard ? 'on' : ''}`} onClick={() => setKeyboard((k) => !k)} aria-pressed={keyboard}>
              <Keyboard size={16} /> Clavier
            </button>
          )}
          <span className="fe-spacer" />
          <button className="fe-btn" onClick={cancel} title="Annuler (Échap)">
            <X size={16} /> Annuler
          </button>
          <button className="fe-btn primary" onClick={validate} title="Valider (Entrée)">
            <Check size={16} /> Valider
          </button>
        </div>
        {mode === 'visual' ? (
          <MathField initial={latex} onChange={setLatex} onEnter={validate} onEscape={cancel} />
        ) : (
          <LatexInput value={latex} onChange={setLatex} onEnter={validate} onEscape={cancel} />
        )}
      </div>
      {mode === 'visual' && keyboard && <MathKeyboard onClose={() => setKeyboard(false)} />}
    </>
  )
}

interface FieldProps {
  onChange: (latex: string) => void
  onEnter: () => void
  onEscape: () => void
}

function MathField({ initial, onChange, onEnter, onEscape }: FieldProps & { initial: string }) {
  const host = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onChange, onEnter, onEscape })
  callbacks.current = { onChange, onEnter, onEscape }
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let mf: HTMLElement | null = null
    loadMathLive()
      .then(({ MathfieldElement }) => {
        if (cancelled || !host.current) return
        const field = new MathfieldElement()
        // MathLive n'accepte certaines options qu'une fois le champ monté.
        host.current.appendChild(field)
        mf = field
        field.mathVirtualKeyboardPolicy = 'manual'
        field.smartFence = true
        field.inlineShortcuts = { ...field.inlineShortcuts, ...INLINE_SHORTCUTS }
        field.value = initial
        field.addEventListener('input', () => callbacks.current.onChange(field.value))
        setReady(true)
        requestAnimationFrame(() => field.focus())
      })
      .catch((err: unknown) => {
        console.error('MathLive', err)
        setFailed(true)
      })
    return () => {
      cancelled = true
      mf?.remove()
    }
    // L'instance est créée une seule fois ; ensuite elle possède sa valeur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={host}
      className="fe-field"
      onKeyDownCapture={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          e.stopPropagation()
          callbacks.current.onEnter()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          callbacks.current.onEscape()
        }
      }}
    >
      {!ready && !failed && <span className="muted">Chargement de l’éditeur…</span>}
      {failed && <span className="error">Éditeur indisponible : utilisez le mode LaTeX brut.</span>}
    </div>
  )
}

function LatexInput({ value, onChange, onEnter, onEscape }: FieldProps & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [suggestions, setSuggestions] = useState<typeof LATEX_COMMANDS>([])
  const [active, setActive] = useState(0)
  const prefix = useRef('')
  const pendingCaret = useRef<number | null>(null)

  // Place le curseur dans le modèle inséré dès le rendu, avant la frappe suivante.
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return
    ref.current?.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = null
  })

  useEffect(() => {
    const ta = ref.current!
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)
  }, [])

  const refreshSuggestions = (text: string, caret: number) => {
    const m = text.slice(0, caret).match(/\\[A-Za-z]*$/)
    prefix.current = m?.[0] ?? ''
    if (!m || m[0].length < 2) return setSuggestions([])
    const list = LATEX_COMMANDS.filter((c) => c.cmd.startsWith(m[0]) && c.cmd !== m[0]).slice(0, 8)
    setSuggestions(list)
    setActive(0)
  }

  const accept = (c: (typeof LATEX_COMMANDS)[number]) => {
    const ta = ref.current!
    const caret = ta.selectionStart
    const start = caret - prefix.current.length
    const cursor = c.template.indexOf('|')
    const insert = c.template.replace('|', '')
    const next = value.slice(0, start) + insert + value.slice(caret)
    pendingCaret.current = start + (cursor >= 0 ? cursor : insert.length)
    onChange(next)
    setSuggestions([])
  }

  const html = value.trim() ? renderLatex(value) : ''

  return (
    <div className="fe-latex">
      <div className="fe-latex-input">
        <textarea
          ref={ref}
          value={value}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          rows={2}
          aria-label="Source LaTeX"
          placeholder="\sum_{k=0}^{n} \binom{n}{k} x^k"
          onChange={(e) => {
            onChange(e.target.value)
            refreshSuggestions(e.target.value, e.target.selectionStart)
          }}
          onKeyDown={(e) => {
            if (suggestions.length > 0) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                const d = e.key === 'ArrowDown' ? 1 : -1
                setActive((a) => (a + d + suggestions.length) % suggestions.length)
                return
              }
              if (e.key === 'Tab' || e.key === 'Enter') {
                e.preventDefault()
                accept(suggestions[active]!)
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setSuggestions([])
                return
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onEnter()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onEscape()
            }
          }}
        />
        {suggestions.length > 0 && (
          <ul className="fe-suggest" role="listbox">
            {suggestions.map((c, i) => (
              <li
                key={c.cmd}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'on' : ''}
                onMouseDown={(e) => {
                  e.preventDefault()
                  accept(c)
                }}
              >
                <code>{c.cmd}</code>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="fe-preview" aria-label="Aperçu" dangerouslySetInnerHTML={{ __html: html || '<span class="muted">Aperçu</span>' }} />
    </div>
  )
}
