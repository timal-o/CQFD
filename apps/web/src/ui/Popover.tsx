import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

const WIDTH = 210
const GAP = 6

/**
 * Menu flottant rendu dans <body>, positionné sur son bouton. Un menu placé dans une zone
 * qui défile (barre d'onglets, liste des participants) y serait coupé.
 * S'ouvre vers le bas s'il y a la place, sinon vers le haut ; se ferme au clic extérieur,
 * avec Échap ou au redimensionnement.
 */
export function Popover({
  anchor,
  onClose,
  children,
  ignore,
}: {
  anchor: DOMRect
  onClose: () => void
  children: React.ReactNode
  /** Sélecteur du bouton déclencheur : un clic dessus est géré par le bouton lui-même. */
  ignore?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: PointerEvent) => {
      const target = e.target as Element
      if (ref.current?.contains(target)) return
      if (ignore && target.closest?.(ignore)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose, ignore])

  const below = window.innerHeight - anchor.bottom
  const above = anchor.top
  const openDown = below >= 220 || below >= above
  const style: React.CSSProperties = {
    position: 'fixed',
    top: openDown ? anchor.bottom + GAP : 'auto',
    bottom: openDown ? 'auto' : window.innerHeight - anchor.top + GAP,
    right: 'auto',
    left: Math.max(8, Math.min(anchor.right - WIDTH, window.innerWidth - WIDTH - 8)),
    minWidth: WIDTH,
    maxHeight: Math.max(160, (openDown ? below : above) - 16),
    overflowY: 'auto',
    zIndex: 60,
  }
  return createPortal(
    <div ref={ref} className="menu" style={style} role="menu" onClick={(e) => (e.target as HTMLElement).tagName === 'BUTTON' && onClose()}>
      {children}
    </div>,
    document.body,
  )
}
