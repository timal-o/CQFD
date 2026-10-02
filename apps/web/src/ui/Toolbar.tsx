import { ChartSpline, Eraser, Hand, Highlighter, Minus, MousePointer2, Pen, Plus, Redo2, Sigma, Target, Trash2, Type, Undo2 } from 'lucide-react'
import type { BoardController } from '../board/controller'
import { HIGHLIGHTER_COLORS, PEN_COLORS, PEN_SIZES, type BoardStore } from '../board/store'
import type { Tool } from '../board/types'

const TOOLS: { tool: Tool; label: string; key: string; icon: React.ReactNode; write?: boolean }[] = [
  { tool: 'select', label: 'Sélection', key: 'V', icon: <MousePointer2 size={20} /> },
  { tool: 'pen', label: 'Stylo', key: 'P', icon: <Pen size={20} />, write: true },
  { tool: 'highlighter', label: 'Surligneur', key: 'S', icon: <Highlighter size={20} />, write: true },
  { tool: 'eraser', label: 'Gomme', key: 'E', icon: <Eraser size={20} />, write: true },
  { tool: 'text', label: 'Texte', key: 'T', icon: <Type size={20} />, write: true },
  { tool: 'formula', label: 'Formule', key: 'F', icon: <Sigma size={20} />, write: true },
  { tool: 'graph', label: 'Repère et courbes', key: 'G', icon: <ChartSpline size={20} />, write: true },
  { tool: 'laser', label: 'Pointeur laser', key: 'L', icon: <Target size={20} /> },
  { tool: 'hand', label: 'Déplacer la vue', key: 'H', icon: <Hand size={20} /> },
]

export function Toolbar({ store, controller }: { store: BoardStore; controller: BoardController | null }) {
  const t = store.tools
  const canWrite = store.canWrite
  const zoom = store.pageId ? store.camera().z : 1

  const zoomBy = (factor: number) => {
    const board = document.querySelector('.board')
    if (!board || !controller) return
    const r = board.getBoundingClientRect()
    controller.zoomAt(r.width / 2, r.height / 2, factor)
    store.emit()
  }

  return (
    <aside className="toolbar" aria-label="Outils">
      <div className="tool-group">
        {TOOLS.filter((x) => x.tool !== 'laser' || store.canLaser).map((x) => (
          <button
            key={x.tool}
            className={`tool ${t.tool === x.tool ? 'active' : ''}`}
            onClick={() => store.setTools({ tool: x.tool })}
            title={`${x.label} (${x.key})${x.write && !canWrite ? ' : il faut avoir la main' : ''}`}
            aria-label={x.label}
            aria-pressed={t.tool === x.tool}
            disabled={x.write && !canWrite}
          >
            {x.icon}
          </button>
        ))}
      </div>

      {canWrite && t.tool === 'pen' && (
        <div className="tool-group">
          {PEN_COLORS.map((c) => (
            <Swatch key={c} color={c} active={t.penColor === c} onClick={() => store.setTools({ penColor: c })} />
          ))}
          {PEN_SIZES.map((s) => (
            <button
              key={s}
              className={`tool ${t.penSize === s ? 'active' : ''}`}
              onClick={() => store.setTools({ penSize: s })}
              aria-label={`Épaisseur ${s}`}
              title={`Épaisseur ${s}`}
            >
              <span className="size-dot" style={{ width: s + 2, height: s + 2 }} />
            </button>
          ))}
        </div>
      )}

      {canWrite && t.tool === 'highlighter' && (
        <div className="tool-group">
          {HIGHLIGHTER_COLORS.map((c) => (
            <Swatch key={c} color={c} active={t.hlColor === c} onClick={() => store.setTools({ hlColor: c })} />
          ))}
        </div>
      )}

      {canWrite && (t.tool === 'text' || t.tool === 'formula') && (
        <div className="tool-group">
          {PEN_COLORS.map((c) => (
            <Swatch key={c} color={c} active={t.textColor === c} onClick={() => store.setTools({ textColor: c })} />
          ))}
        </div>
      )}

      {canWrite && t.tool === 'eraser' && (
        <div className="tool-group">
          <button
            className={`tool text-btn ${t.eraserMode === 'stroke' ? 'active' : ''}`}
            onClick={() => store.setTools({ eraserMode: 'stroke' })}
            title="Efface le trait entier"
          >
            Trait
          </button>
          <button
            className={`tool text-btn ${t.eraserMode === 'pixel' ? 'active' : ''}`}
            onClick={() => store.setTools({ eraserMode: 'pixel' })}
            title="Efface seulement la zone touchée"
          >
            Pixel
          </button>
        </div>
      )}

      {t.tool === 'select' && store.selection.size > 0 && (
        <div className="tool-group">
          <button className="tool" onClick={() => controller?.deleteSelection()} title="Supprimer (Suppr)" aria-label="Supprimer la sélection">
            <Trash2 size={20} />
          </button>
        </div>
      )}

      {canWrite && (
        <div className="tool-group">
          <button className="tool" onClick={() => store.undo()} disabled={!store.canUndo} aria-label="Annuler" title="Annuler (Ctrl+Z)">
            <Undo2 size={18} />
          </button>
          <button className="tool" onClick={() => store.redo()} disabled={!store.canRedo} aria-label="Rétablir" title="Rétablir (Ctrl+Y)">
            <Redo2 size={18} />
          </button>
        </div>
      )}

      <div className="tool-group">
        <button className="tool" onClick={() => zoomBy(1.25)} aria-label="Zoomer" title="Zoomer (Ctrl + molette)">
          <Plus size={18} />
        </button>
        <button
          className="tool text-btn"
          onClick={() => {
            store.setCamera({ x: 0, y: 0, z: 1 })
            store.emit()
          }}
          title="Revenir à 100 % et à l'origine"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button className="tool" onClick={() => zoomBy(0.8)} aria-label="Dézoomer" title="Dézoomer">
          <Minus size={18} />
        </button>
      </div>
    </aside>
  )
}

function Swatch({ color, active, onClick }: { color: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`tool swatch ${active ? 'active' : ''}`} onClick={onClick} aria-label={`Couleur ${color}`} title={color}>
      <span style={{ background: color }} />
    </button>
  )
}
