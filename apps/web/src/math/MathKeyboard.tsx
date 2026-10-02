import { useEffect, useRef, useState } from 'react'
import { GripHorizontal, X } from 'lucide-react'
import { loadMathLive } from './mathlive'

const WIDTH = 680

/** Clavier mathématique MathLive, affiché dans un panneau flottant déplaçable. */
export function MathKeyboard({ onClose }: { onClose: () => void }) {
  const body = useRef<HTMLDivElement>(null)
  // Ancré par le bas, juste au-dessus de l'éditeur : un onglet plus haut fait grandir le clavier vers le haut.
  const [pos, setPos] = useState(() => {
    const w = Math.min(WIDTH, window.innerWidth - 16)
    const editorTop = document.querySelector('.formula-editor')?.getBoundingClientRect().top ?? window.innerHeight - 160
    return { x: Math.max(8, (window.innerWidth - w) / 2), bottom: window.innerHeight - editorTop + 8 }
  })
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const moved = useRef(false)

  // Tant que l'utilisateur ne l'a pas déplacé, le clavier reste juste au-dessus de l'éditeur (qui grandit avec la formule).
  useEffect(() => {
    const editor = document.querySelector('.formula-editor')
    if (!editor) return
    const follow = () => {
      if (moved.current) return
      const top = editor.getBoundingClientRect().top
      setPos((p) => ({ ...p, bottom: window.innerHeight - top + 8 }))
    }
    const ro = new ResizeObserver(follow)
    ro.observe(editor)
    window.addEventListener('resize', follow)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', follow)
    }
  }, [])

  useEffect(() => {
    let disposed = false
    loadMathLive().then(() => {
      if (disposed || !body.current) return
      const kb = window.mathVirtualKeyboard
      kb.container = body.current
      kb.show({ animate: false })
    })
    return () => {
      disposed = true
      const kb = window.mathVirtualKeyboard
      if (kb) {
        kb.hide({ animate: false })
        kb.container = document.body
      }
    }
  }, [])

  return (
    <div className="math-keyboard" style={{ left: pos.x, bottom: pos.bottom }} data-no-shortcuts>
      <div
        className="mk-head"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return
          e.preventDefault()
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          drag.current = { dx: e.clientX - pos.x, dy: window.innerHeight - e.clientY - pos.bottom }
          moved.current = true
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          setPos({
            x: Math.min(window.innerWidth - 80, Math.max(-WIDTH + 80, e.clientX - drag.current.dx)),
            bottom: Math.min(window.innerHeight - 40, Math.max(-200, window.innerHeight - e.clientY - drag.current.dy)),
          })
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <GripHorizontal size={16} aria-hidden />
        <span>Clavier mathématique</span>
        <button className="icon" onMouseDown={(e) => e.preventDefault()} onClick={onClose} aria-label="Fermer le clavier">
          <X size={16} />
        </button>
      </div>
      <div ref={body} className="mk-body" onMouseDown={(e) => e.preventDefault()} />
    </div>
  )
}
