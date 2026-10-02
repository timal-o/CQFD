import { useEffect, useReducer, useRef, useState } from 'react'
import { LIMITS, randomId, type Curve, type GraphElement } from '@cqfd/shared'
import { Check, Keyboard, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { BoardStore } from '../board/store'
import { curveStatus, loadMath } from './curves'
import { renderLatex } from './katex'
import { MathField } from './MathField'
import { MathKeyboard } from './MathKeyboard'

export const CURVE_COLORS = ['#1d4ed8', '#dc2626', '#15803d', '#7c3aed', '#ea580c', '#0891b2', '#be185d', '#111827']

const parseNumber = (s: string) => Number(s.replace(',', '.').replace('−', '-'))

/**
 * Panneau d'édition d'un repère : fenêtre, grille, liste des courbes y = f(x).
 * Chaque modification validée est envoyée aussitôt : tout le monde voit le repère se mettre à jour.
 */
export function GraphEditor({ store }: { store: BoardStore }) {
  const id = store.editingId!
  const [, force] = useReducer((n: number) => n + 1, 0)
  useEffect(() => store.onRender((k) => k === 'doc' && force()), [store])
  useEffect(() => {
    void loadMath().then(force)
    store.finishEditing = () => store.closeEditing()
    return () => {
      store.finishEditing = null
    }
  }, [store])

  const el = store.elements.get(id)
  const [editing, setEditingState] = useState<{ curveId: string; latex: string } | null>(null)
  // Valeur courante lue à la validation : la touche Entrée peut arriver avant le rendu React.
  const editingRef = useRef(editing)
  const setEditing = (next: { curveId: string; latex: string } | null) => {
    editingRef.current = next
    setEditingState(next)
  }
  const [keyboard, setKeyboard] = useState(() => window.matchMedia('(pointer: coarse)').matches)
  if (el?.type !== 'graph') return null

  const update = (patch: Partial<GraphElement>) => {
    const cur = store.elements.get(id)
    if (cur?.type === 'graph') store.commit([{ o: 'put', el: { ...cur, ...patch } }])
  }

  const saveCurve = () => {
    const editing = editingRef.current
    const cur = store.elements.get(id)
    if (!editing || cur?.type !== 'graph') return
    const latex = editing.latex.trim()
    const exists = cur.curves.some((c) => c.id === editing.curveId)
    let curves: Curve[]
    if (!latex) curves = cur.curves.filter((c) => c.id !== editing.curveId)
    else if (exists) curves = cur.curves.map((c) => (c.id === editing.curveId ? { ...c, latex } : c))
    else curves = [...cur.curves, { id: editing.curveId, latex, color: CURVE_COLORS[cur.curves.length % CURVE_COLORS.length]! }]
    update({ curves })
    setEditing(null)
  }

  return (
    <>
      <div
        className="formula-editor graph-editor"
        data-no-shortcuts
        role="dialog"
        aria-label="Édition du repère"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) e.preventDefault()
        }}
      >
        <div className="fe-head">
          <strong>Repère</strong>
          <WindowField label="x min" value={el.xmin} onCommit={(v) => v < el.xmax && update({ xmin: v })} />
          <WindowField label="x max" value={el.xmax} onCommit={(v) => v > el.xmin && update({ xmax: v })} />
          <WindowField label="y min" value={el.ymin} onCommit={(v) => v < el.ymax && update({ ymin: v })} />
          <WindowField label="y max" value={el.ymax} onCommit={(v) => v > el.ymin && update({ ymax: v })} />
          <label className="toggle">
            <input type="checkbox" checked={el.grid} onChange={(e) => update({ grid: e.target.checked })} />
            Grille
          </label>
          <span className="fe-spacer" />
          <button className="fe-btn primary" onClick={() => store.closeEditing()}>
            <Check size={16} /> Terminer
          </button>
        </div>

        <ul className="curves">
          {el.curves.map((c) =>
            editing?.curveId === c.id ? null : (
              <CurveRow
                key={c.id}
                curve={c}
                onColor={() => {
                  const next = CURVE_COLORS[(CURVE_COLORS.indexOf(c.color) + 1) % CURVE_COLORS.length]!
                  update({ curves: el.curves.map((x) => (x.id === c.id ? { ...x, color: next } : x)) })
                }}
                onEdit={() => setEditing({ curveId: c.id, latex: c.latex })}
                onDelete={() => update({ curves: el.curves.filter((x) => x.id !== c.id) })}
              />
            ),
          )}
        </ul>

        {editing ? (
          <div className="curve-edit">
            <span className="curve-prefix">y =</span>
            <MathField
              key={editing.curveId}
              initial={editing.latex}
              onChange={(latex) => editingRef.current && setEditing({ ...editingRef.current, latex })}
              onEnter={saveCurve}
              onEscape={() => setEditing(null)}
            />
            <div className="curve-actions">
              <span className={`curve-status ${curveStatus(editing.latex)}`}>
                {curveStatus(editing.latex) === 'invalid' ? 'Expression non reconnue' : ''}
              </span>
              <button className={`fe-btn ${keyboard ? 'on' : ''}`} onClick={() => setKeyboard((k) => !k)}>
                <Keyboard size={16} /> Clavier
              </button>
              <button className="fe-btn" onClick={() => setEditing(null)}>
                <X size={16} /> Annuler
              </button>
              <button className="fe-btn primary" onClick={saveCurve}>
                <Check size={16} /> Valider
              </button>
            </div>
          </div>
        ) : (
          el.curves.length < LIMITS.maxCurves && (
            <button className="fe-btn add-curve" onClick={() => setEditing({ curveId: randomId(), latex: '' })}>
              <Plus size={16} /> Ajouter une courbe y = f(x)
            </button>
          )
        )}
      </div>
      {editing && keyboard && <MathKeyboard onClose={() => setKeyboard(false)} />}
    </>
  )
}

function WindowField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value).replace('.', ','))
  useEffect(() => setText(String(value).replace('.', ',')), [value])
  const commit = () => {
    const v = parseNumber(text)
    if (Number.isFinite(v) && Math.abs(v) <= 1e6) onCommit(v)
    else setText(String(value).replace('.', ','))
  }
  return (
    <label className="window-field">
      {label}
      <input
        value={text}
        inputMode="decimal"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  )
}

function CurveRow({ curve, onColor, onEdit, onDelete }: { curve: Curve; onColor: () => void; onEdit: () => void; onDelete: () => void }) {
  const status = curveStatus(curve.latex)
  return (
    <li className="curve-row">
      <button className="curve-color" style={{ background: curve.color }} onClick={onColor} title="Changer de couleur" aria-label="Changer de couleur" />
      <span className="curve-tex" dangerouslySetInnerHTML={{ __html: renderLatex(`y=${curve.latex}`) }} />
      {status === 'invalid' && <span className="curve-status invalid">non reconnue</span>}
      <button className="icon" onClick={onEdit} aria-label="Modifier la courbe" title="Modifier">
        <Pencil size={16} />
      </button>
      <button className="icon" onClick={onDelete} aria-label="Supprimer la courbe" title="Supprimer">
        <Trash2 size={16} />
      </button>
    </li>
  )
}
