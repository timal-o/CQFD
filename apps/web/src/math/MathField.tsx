import { useEffect, useRef, useState } from 'react'
import { INLINE_SHORTCUTS } from './config'
import { loadMathLive } from './mathlive'

export interface FieldProps {
  onChange: (latex: string) => void
  onEnter: () => void
  onEscape: () => void
}

/** Champ MathLive (une seule instance montée à la fois dans l'application). */
export function MathField({ initial, onChange, onEnter, onEscape }: FieldProps & { initial: string }) {
  const host = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onChange, onEnter, onEscape })
  callbacks.current = { onChange, onEnter, onEscape }
  const fieldRef = useRef<{ value: string } | null>(null)
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
        fieldRef.current = field
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
          // L'événement « input » de MathLive peut arriver après Entrée : on relit la valeur.
          if (fieldRef.current) callbacks.current.onChange(fieldRef.current.value)
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
