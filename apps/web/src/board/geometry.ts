import { randomId, type BoardElement, type FormulaElement, type StrokeElement, type TextElement } from '@cqfd/shared'
import type { Box, Camera } from './types'

export const screenToWorld = (cam: Camera, sx: number, sy: number) => ({
  x: (sx - cam.x) / cam.z,
  y: (sy - cam.y) / cam.z,
})

export const worldToScreen = (cam: Camera, wx: number, wy: number) => ({
  x: wx * cam.z + cam.x,
  y: wy * cam.z + cam.y,
})

export function viewportBox(cam: Camera, width: number, height: number): Box {
  const a = screenToWorld(cam, 0, 0)
  const b = screenToWorld(cam, width, height)
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y }
}

export const intersects = (a: Box, b: Box) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY

export const contains = (outer: Box, inner: Box) =>
  inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY

export function unionBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null
  return boxes.reduce((u, b) => ({
    minX: Math.min(u.minX, b.minX),
    minY: Math.min(u.minY, b.minY),
    maxX: Math.max(u.maxX, b.maxX),
    maxY: Math.max(u.maxY, b.maxY),
  }))
}

const strokeBoxes = new WeakMap<StrokeElement, Box>()

function strokeBox(el: StrokeElement): Box {
  let box = strokeBoxes.get(el)
  if (box) return box
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < el.pts.length; i += 3) {
    const x = el.pts[i]!
    const y = el.pts[i + 1]!
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const pad = el.size / 2 + 1
  box = { minX: el.x + minX - pad, minY: el.y + minY - pad, maxX: el.x + maxX + pad, maxY: el.y + maxY + pad }
  strokeBoxes.set(el, box)
  return box
}

export interface DomSize {
  w: number
  h: number
}

/** Taille estimée d'un élément DOM tant qu'il n'a pas été mesuré. */
function estimateSize(el: TextElement | FormulaElement): DomSize {
  if (el.type === 'text') return { w: el.w, h: Math.max(1, el.blocks.length) * el.fs * 1.5 }
  return { w: Math.max(el.fs * 1.5, el.latex.length * el.fs * 0.45), h: el.fs * 1.8 }
}

export function elementBox(el: BoardElement, domSizes: Map<string, DomSize>): Box {
  if (el.type === 'stroke') return strokeBox(el)
  if (el.type === 'graph') return { minX: el.x, minY: el.y, maxX: el.x + el.w, maxY: el.y + el.h }
  const measured = domSizes.get(el.id) ?? estimateSize(el)
  const w = el.type === 'text' ? el.w : measured.w
  return { minX: el.x, minY: el.y, maxX: el.x + w, maxY: el.y + measured.h }
}

function distToSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len = dx * dx + dy * dy
  let t = len === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx - px
  const cy = ay + t * dy - py
  return cx * cx + cy * cy
}

export function hitStroke(el: StrokeElement, px: number, py: number, radius: number): boolean {
  const box = strokeBox(el)
  if (px < box.minX - radius || px > box.maxX + radius || py < box.minY - radius || py > box.maxY + radius) {
    return false
  }
  const r = radius + el.size / 2
  const r2 = r * r
  const pts = el.pts
  if (pts.length === 3) {
    const dx = el.x + pts[0]! - px
    const dy = el.y + pts[1]! - py
    return dx * dx + dy * dy <= r2
  }
  for (let i = 0; i + 5 < pts.length; i += 3) {
    const d = distToSegmentSq(px, py, el.x + pts[i]!, el.y + pts[i + 1]!, el.x + pts[i + 3]!, el.y + pts[i + 4]!)
    if (d <= r2) return true
  }
  return false
}

export function hitElement(
  el: BoardElement,
  px: number,
  py: number,
  radius: number,
  domSizes: Map<string, DomSize>,
): boolean {
  if (el.type === 'stroke') return hitStroke(el, px, py, radius)
  const b = elementBox(el, domSizes)
  return px >= b.minX - radius && px <= b.maxX + radius && py >= b.minY - radius && py <= b.maxY + radius
}

export const round = (v: number) => Math.round(v * 10) / 10
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export function translateElement<T extends BoardElement>(el: T, dx: number, dy: number): T {
  return { ...el, x: round(el.x + dx), y: round(el.y + dy) }
}

/** Mise à l'échelle uniforme autour de (ox, oy). */
export function scaleElement(el: BoardElement, ox: number, oy: number, s: number): BoardElement {
  const x = round(ox + (el.x - ox) * s)
  const y = round(oy + (el.y - oy) * s)
  if (el.type === 'stroke') {
    return {
      ...el,
      x,
      y,
      size: clamp(round(el.size * s), 0.5, 80),
      pts: el.pts.map((v, i) => (i % 3 === 2 ? v : round(v * s))),
    }
  }
  if (el.type === 'formula') return { ...el, x, y, fs: clamp(round(el.fs * s), 8, 200) }
  if (el.type === 'graph') return { ...el, x, y, w: clamp(round(el.w * s), 60, 5000), h: clamp(round(el.h * s), 60, 5000) }
  return { ...el, x, y, w: clamp(round(el.w * s), 20, 5000), fs: clamp(round(el.fs * s), 8, 200) }
}

/** Construit un trait à partir de points absolus (x, y, pression). */
export function makeStroke(base: Omit<StrokeElement, 'x' | 'y' | 'pts' | 'type'>, absolute: number[]): StrokeElement {
  let minX = Infinity
  let minY = Infinity
  for (let i = 0; i < absolute.length; i += 3) {
    minX = Math.min(minX, absolute[i]!)
    minY = Math.min(minY, absolute[i + 1]!)
  }
  const x = round(minX)
  const y = round(minY)
  const pts: number[] = []
  for (let i = 0; i < absolute.length; i += 3) {
    pts.push(round(absolute[i]! - x), round(absolute[i + 1]! - y), Math.round(absolute[i + 2]! * 100) / 100)
  }
  return { ...base, type: 'stroke', x, y, pts }
}

/** Retire les points trop proches du précédent (réduit la taille des messages). */
export function simplify(pts: number[], minDist: number): number[] {
  if (pts.length <= 6) return pts
  const out = [pts[0]!, pts[1]!, pts[2]!]
  const min2 = minDist * minDist
  for (let i = 3; i < pts.length - 3; i += 3) {
    const dx = pts[i]! - out[out.length - 3]!
    const dy = pts[i + 1]! - out[out.length - 2]!
    if (dx * dx + dy * dy >= min2) out.push(pts[i]!, pts[i + 1]!, pts[i + 2]!)
  }
  out.push(pts[pts.length - 3]!, pts[pts.length - 2]!, pts[pts.length - 1]!)
  return out
}

/**
 * Gomme pixel : retire les points du trait sous la gomme et renvoie les morceaux
 * restants (nouveaux identifiants, même auteur). Renvoie null si le trait n'est pas touché.
 */
export function eraseFromStroke(el: StrokeElement, px: number, py: number, radius: number): StrokeElement[] | null {
  if (!hitStroke(el, px, py, radius)) return null
  const r = radius + el.size * 0.35
  const r2 = r * r
  const step = Math.max(0.5, r / 3)

  // Densifie pour pouvoir couper entre deux points éloignés.
  const dense: number[] = []
  const src = el.pts
  for (let i = 0; i < src.length; i += 3) {
    const x = el.x + src[i]!
    const y = el.y + src[i + 1]!
    const p = src[i + 2]!
    if (i > 0) {
      const lx = dense[dense.length - 3]!
      const ly = dense[dense.length - 2]!
      const lp = dense[dense.length - 1]!
      const n = Math.floor(Math.hypot(x - lx, y - ly) / step)
      for (let k = 1; k < n; k++) {
        const t = k / n
        dense.push(lx + (x - lx) * t, ly + (y - ly) * t, lp + (p - lp) * t)
      }
    }
    dense.push(x, y, p)
  }

  const pieces: number[][] = []
  let current: number[] = []
  for (let i = 0; i < dense.length; i += 3) {
    const dx = dense[i]! - px
    const dy = dense[i + 1]! - py
    if (dx * dx + dy * dy <= r2) {
      if (current.length > 0) pieces.push(current)
      current = []
    } else {
      current.push(dense[i]!, dense[i + 1]!, dense[i + 2]!)
    }
  }
  if (current.length > 0) pieces.push(current)

  const { id: _id, x: _x, y: _y, pts: _pts, type: _type, ...base } = el
  return pieces
    .filter((p) => p.length >= 6)
    .map((p) => makeStroke({ ...base, id: randomId() }, simplify(p, step * 0.8)))
}
