import { useEffect, useRef, useState } from 'react'
import { INLINE_SHORTCUTS } from './config'
import { atEnvEnd, shouldGrowOnTab } from './lines'
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
  const fieldRef = useRef<{
    value: string
    position: number
    lastOffset: number
    executeCommand(cmd: string): boolean
    getValue(start: number, end: number, format: 'latex'): string
  } | null>(null)
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
        const f = fieldRef.current
        if (e.key === 'Tab' && !e.shiftKey && f && f.position < f.lastOffset) {
          // Tab dans la dernière case d'un système ou d'une matrice (la position suivante sort de
          // l'environnement) : nouvelle ligne si la dernière est remplie, sinon on sort juste après
          // la matrice pour continuer à écrire (MathLive, lui, quitterait le champ).
          const before = f.getValue(0, f.position + 1, 'latex')
          if (atEnvEnd(before)) {
            e.preventDefault()
            e.stopPropagation()
            if (shouldGrowOnTab(before)) {
              if (f.executeCommand('addRowAfter')) callbacks.current.onChange(f.value)
            } else {
              f.position = f.position + 1
            }
            return
          }
        }
        if (e.key === 'Enter' && e.shiftKey) {
          // Maj+Entrée : nouvelle ligne (rangée suivante dans un tableau, sinon formule sur plusieurs lignes).
          e.preventDefault()
          e.stopPropagation()
          if (fieldRef.current?.executeCommand('addRowAfter')) callbacks.current.onChange(fieldRef.current.value)
        } else if (e.key === 'Enter' && !e.shiftKey) {
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
