import { useEffect, useReducer, useRef, useState } from 'react'
import { worldToScreen } from './geometry'
import { ACTIVITY_MS, type BoardStore } from './store'

const MARGIN = 8

/** Zone où placer les flèches : évite la barre d'outils (à gauche, ou en bas sur téléphone). */
function safeInsets(w: number) {
  const phone = w <= 640
  return { left: phone ? 70 : 100, right: 72, top: 26, bottom: phone ? 90 : 26 }
}

/**
 * Flèches au bord de l'écran vers l'activité hors du champ de vision
 * (laser, tracé ou modification d'un autre participant). Un clic recentre la vue.
 * Aucun message réseau supplémentaire : tout est déduit de ce qu'on reçoit déjà.
 */
export function OffscreenIndicators({ store }: { store: BoardStore }) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [, force] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    const node = ref.current!
    const ro = new ResizeObserver(([e]) => e && setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(node)
    let raf = 0
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), force()))
    }
    const unsub = store.onRender(schedule)
    // Fait disparaître les flèches périmées même sans nouvel événement.
    const timer = setInterval(() => store.activity.size > 0 && schedule(), 500)
    return () => {
      ro.disconnect()
      unsub()
      clearInterval(timer)
      cancelAnimationFrame(raf)
    }
  }, [store])

  const now = performance.now()
  const cam = store.camera()
  const { w, h } = size
  const arrows: { by: string; x: number; y: number; angle: number; wx: number; wy: number; kind: string }[] = []

  for (const [by, a] of store.activity) {
    if (now - a.t > ACTIVITY_MS) {
      store.activity.delete(by)
      continue
    }
    if (a.pageId !== store.pageId || w === 0) continue
    const s = worldToScreen(cam, a.x, a.y)
    if (s.x >= MARGIN && s.x <= w - MARGIN && s.y >= MARGIN && s.y <= h - MARGIN) continue
    // Intersection du rayon centre → activité avec le rectangle sûr.
    const ins = safeInsets(w)
    const cx = (ins.left + w - ins.right) / 2
    const cy = (ins.top + h - ins.bottom) / 2
    const dx = s.x - cx
    const dy = s.y - cy
    const tx = dx > 0 ? (w - ins.right - cx) / dx : dx < 0 ? (ins.left - cx) / dx : Infinity
    const ty = dy > 0 ? (h - ins.bottom - cy) / dy : dy < 0 ? (ins.top - cy) / dy : Infinity
    const t = Math.min(tx, ty)
    arrows.push({ by, x: cx + dx * t, y: cy + dy * t, angle: Math.atan2(dy, dx), wx: a.x, wy: a.y, kind: a.kind })
  }

  return (
    <div ref={ref} className="offscreen">
      {arrows.map((a) => (
        <button
          key={a.by}
          className={`offscreen-arrow ${a.kind}`}
          style={{ left: a.x, top: a.y }}
          title={`${store.participantName(a.by)} : voir`}
          aria-label={`Aller voir l'activité de ${store.participantName(a.by)}`}
          onClick={() => {
            const z = store.camera().z
            store.setCamera({ z, x: w / 2 - a.wx * z, y: h / 2 - a.wy * z })
            store.activity.delete(a.by)
          }}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" style={{ transform: `rotate(${a.angle}rad)` }} aria-hidden>
            <path d="M3 11h13M11 5l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{store.participantName(a.by)}</span>
        </button>
      ))}
    </div>
  )
}
