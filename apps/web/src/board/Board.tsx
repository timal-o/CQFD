import { useEffect, useRef } from 'react'
import { BoardController } from './controller'
import { BoardRenderer } from './renderer'
import type { BoardStore } from './store'
import { TextLayer } from './TextLayer'

const CURSORS: Record<string, string> = {
  select: 'default',
  pen: 'crosshair',
  highlighter: 'crosshair',
  eraser: 'none',
  text: 'text',
  laser: 'crosshair',
  hand: 'grab',
}

export function Board({ store, onController }: { store: BoardStore; onController?: (c: BoardController | null) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const base = useRef<HTMLCanvasElement>(null)
  const top = useRef<HTMLCanvasElement>(null)
  const world = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = container.current!
    const controller = new BoardController(store, el)
    const renderer = new BoardRenderer(store, base.current!, top.current!, world.current!, controller.overlay)
    const ro = new ResizeObserver(([entry]) => {
      if (entry) renderer.resize(entry.contentRect.width, entry.contentRect.height)
    })
    ro.observe(el)
    onController?.(controller)
    return () => {
      ro.disconnect()
      renderer.dispose()
      controller.dispose()
      onController?.(null)
    }
  }, [store, onController])

  return (
    <div ref={container} className="board" style={{ cursor: CURSORS[store.tools.tool] }}>
      <canvas ref={base} className="layer" />
      <div className="text-layer">
        <div ref={world} className="world">
          <TextLayer store={store} />
        </div>
      </div>
      <canvas ref={top} className="layer" />
    </div>
  )
}
