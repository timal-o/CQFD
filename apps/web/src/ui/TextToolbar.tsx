import { Bold, Check, Heading1, Heading2, Italic, Pilcrow } from 'lucide-react'
import { PEN_COLORS, type BoardStore } from '../board/store'

/** Barre de mise en forme du texte en cours d'édition. Les boutons ne prennent pas le focus. */
export function TextToolbar({ store }: { store: BoardStore }) {
  const el = store.editingId ? store.elements.get(store.editingId) : undefined
  if (!el || el.type !== 'text') return null

  const keep = (e: React.MouseEvent) => e.preventDefault()
  const exec = (cmd: string, value?: string) => document.execCommand(cmd, false, value)
  const setFs = (fs: number) => {
    store.applyLocal([{ o: 'put', el: { ...el, fs: Math.max(8, Math.min(200, Math.round(fs))) } }])
    store.emit()
  }

  return (
    <div className="text-toolbar" data-text-toolbar onMouseDown={keep}>
      <button onClick={() => exec('bold')} title="Gras (Ctrl+B)" aria-label="Gras">
        <Bold size={16} />
      </button>
      <button onClick={() => exec('italic')} title="Italique (Ctrl+I)" aria-label="Italique">
        <Italic size={16} />
      </button>
      <span className="sep" />
      <button onClick={() => exec('formatBlock', 'h1')} title="Titre 1" aria-label="Titre 1">
        <Heading1 size={16} />
      </button>
      <button onClick={() => exec('formatBlock', 'h2')} title="Titre 2" aria-label="Titre 2">
        <Heading2 size={16} />
      </button>
      <button onClick={() => exec('formatBlock', 'div')} title="Paragraphe" aria-label="Paragraphe">
        <Pilcrow size={16} />
      </button>
      <span className="sep" />
      {PEN_COLORS.map((c) => (
        <button key={c} className="swatch" onClick={() => exec('foreColor', c)} aria-label={`Couleur ${c}`}>
          <span style={{ background: c }} />
        </button>
      ))}
      <span className="sep" />
      <button onClick={() => setFs(el.fs / 1.15)} title="Plus petit" aria-label="Plus petit">
        A−
      </button>
      <button onClick={() => setFs(el.fs * 1.15)} title="Plus grand" aria-label="Plus grand">
        A+
      </button>
      <span className="sep" />
      <button className="done" onClick={() => store.finishEditing?.()} title="Terminer (Échap)">
        <Check size={16} /> Terminer
      </button>
    </div>
  )
}
