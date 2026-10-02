import { getStroke } from 'perfect-freehand'
import type { GraphElement, PageBackground, StrokeElement } from '@cqfd/shared'
import { niceStep, type Polyline } from '../math/sampling'
import type { Camera } from './types'

export const DARK_BG = '#1f2328'

function outlineOptions(tool: 'pen' | 'highlighter', size: number, simulatePressure: boolean, last: boolean) {
  return tool === 'highlighter'
    ? { size, thinning: 0, smoothing: 0.5, streamline: 0.4, simulatePressure: false, last, start: { cap: true }, end: { cap: true } }
    : { size, thinning: 0.55, smoothing: 0.5, streamline: 0.45, simulatePressure, last }
}

/** Path2D d'un contour perfect-freehand (courbes quadratiques passant par les milieux). */
function outlineToPath(outline: number[][]): Path2D {
  const path = new Path2D()
  const n = outline.length
  if (n < 3) return path
  const [x0, y0] = outline[0] as [number, number]
  path.moveTo(x0, y0)
  for (let i = 1; i < n; i++) {
    const [ax, ay] = outline[i] as [number, number]
    const [bx, by] = outline[(i + 1) % n] as [number, number]
    path.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2)
  }
  path.closePath()
  return path
}

/** Les points de pression constante 0,5 viennent d'une souris ou d'un doigt : on simule. */
function hasRealPressure(pts: number[]): boolean {
  for (let i = 2; i < pts.length; i += 3) if (pts[i] !== 0.5) return true
  return false
}

export function buildStrokePath(
  tool: 'pen' | 'highlighter',
  size: number,
  absolute: number[],
  last: boolean,
): Path2D {
  const points: [number, number, number][] = []
  for (let i = 0; i < absolute.length; i += 3) points.push([absolute[i]!, absolute[i + 1]!, absolute[i + 2]!])
  if (points.length === 1) {
    const path = new Path2D()
    const [x, y] = points[0]!
    path.arc(x, y, size / 2, 0, Math.PI * 2)
    return path
  }
  return outlineToPath(getStroke(points, outlineOptions(tool, size, !hasRealPressure(absolute), last)))
}

const pathCache = new WeakMap<StrokeElement, Path2D>()

export function strokePath(el: StrokeElement): Path2D {
  let path = pathCache.get(el)
  if (!path) {
    const abs = el.pts.map((v, i) => (i % 3 === 0 ? v + el.x : i % 3 === 1 ? v + el.y : v))
    path = buildStrokePath(el.tool, el.size, abs, true)
    pathCache.set(el, path)
  }
  return path
}

function isDarkColor(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 60
}

/** Sur fond sombre, l'encre noire devient claire pour rester lisible. */
export function inkColor(color: string, bg: PageBackground): string {
  return bg === 'dark' && isDarkColor(color) ? '#f1f5f9' : color
}

export function fillStroke(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  tool: 'pen' | 'highlighter',
  color: string,
  bg: PageBackground,
): void {
  ctx.globalAlpha = tool === 'highlighter' ? 0.35 : 1
  ctx.fillStyle = inkColor(color, bg)
  ctx.fill(path)
  ctx.globalAlpha = 1
}

/** Fond de page dessiné dans l'espace écran (coût indépendant du nombre d'éléments). */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  bg: PageBackground,
  cam: Camera,
  width: number,
  height: number,
): void {
  ctx.fillStyle = bg === 'dark' ? DARK_BG : '#ffffff'
  ctx.fillRect(0, 0, width, height)

  const lines = (step: number, color: string, horizontal: boolean, vertical: boolean, lineWidth = 1) => {
    const s = step * cam.z
    if (s < 5) return
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth
    ctx.beginPath()
    if (vertical) {
      for (let x = (((cam.x % s) + s) % s); x < width; x += s) {
        ctx.moveTo(Math.round(x) + 0.5, 0)
        ctx.lineTo(Math.round(x) + 0.5, height)
      }
    }
    if (horizontal) {
      for (let y = (((cam.y % s) + s) % s); y < height; y += s) {
        ctx.moveTo(0, Math.round(y) + 0.5)
        ctx.lineTo(width, Math.round(y) + 0.5)
      }
    }
    ctx.stroke()
  }

  switch (bg) {
    case 'seyes':
      lines(8, '#c7d2fe', true, false)
      lines(32, '#a78bfa', true, true)
      break
    case 'grid':
      lines(20, '#cbd5e1', true, true)
      break
    case 'dots': {
      const s = 24 * cam.z
      if (s < 6) break
      ctx.fillStyle = '#94a3b8'
      const r = Math.max(1, Math.min(2.5, 1.5 * cam.z))
      for (let x = (((cam.x % s) + s) % s); x < width; x += s) {
        for (let y = (((cam.y % s) + s) % s); y < height; y += s) {
          ctx.fillRect(x - r / 2, y - r / 2, r, r)
        }
      }
      break
    }
    default:
      break
  }
}

// ------------------------------------------------------------ repère et courbes

const AXIS_COLOR = '#334155'
const GRID_COLOR = '#e2e8f0'

function formatTick(v: number, step: number): string {
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  return (Math.abs(v) < step / 1e6 ? 0 : v).toFixed(decimals).replace('.', ',').replace('-', '−')
}

/** Dessine un repère (cadre, grille, axes gradués) et ses courbes, en coordonnées du monde. */
export function drawGraph(
  ctx: CanvasRenderingContext2D,
  el: GraphElement,
  bg: PageBackground,
  samplesFor: (curve: GraphElement['curves'][number]) => Polyline[] | undefined,
): void {
  const { x, y, w, h, xmin, xmax, ymin, ymax } = el
  const sx = (gx: number) => x + ((gx - xmin) / (xmax - xmin)) * w
  const sy = (gy: number) => y + ((ymax - gy) / (ymax - ymin)) * h
  const dark = bg === 'dark'
  const axis = dark ? '#cbd5e1' : AXIS_COLOR
  const label = Math.max(9, Math.min(16, Math.min(w, h) / 26))
  const stepX = niceStep(xmax - xmin, w / 70)
  const stepY = niceStep(ymax - ymin, h / 55)

  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.fillStyle = dark ? 'rgba(15, 23, 42, 0.6)' : 'rgba(255, 255, 255, 0.85)'
  ctx.fill()
  ctx.clip()

  if (el.grid) {
    ctx.strokeStyle = dark ? '#334155' : GRID_COLOR
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let gx = Math.ceil(xmin / stepX) * stepX; gx <= xmax; gx += stepX) {
      ctx.moveTo(sx(gx), y)
      ctx.lineTo(sx(gx), y + h)
    }
    for (let gy = Math.ceil(ymin / stepY) * stepY; gy <= ymax; gy += stepY) {
      ctx.moveTo(x, sy(gy))
      ctx.lineTo(x + w, sy(gy))
    }
    ctx.stroke()
  }

  // Axes (ou bord du cadre si l'origine est hors fenêtre).
  const ax = Math.min(x + w, Math.max(x, sx(0)))
  const ay = Math.min(y + h, Math.max(y, sy(0)))
  ctx.strokeStyle = axis
  ctx.fillStyle = axis
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x, ay)
  ctx.lineTo(x + w, ay)
  ctx.moveTo(ax, y)
  ctx.lineTo(ax, y + h)
  ctx.stroke()
  // Flèches.
  ctx.beginPath()
  ctx.moveTo(x + w, ay)
  ctx.lineTo(x + w - 8, ay - 4)
  ctx.lineTo(x + w - 8, ay + 4)
  ctx.moveTo(ax, y)
  ctx.lineTo(ax - 4, y + 8)
  ctx.lineTo(ax + 4, y + 8)
  ctx.fill()

  // Graduations.
  ctx.font = `${label}px system-ui, sans-serif`
  ctx.lineWidth = 1
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let gx = Math.ceil(xmin / stepX) * stepX; gx <= xmax; gx += stepX) {
    if (Math.abs(gx) < stepX / 2) continue
    const px = sx(gx)
    ctx.beginPath()
    ctx.moveTo(px, ay - 3)
    ctx.lineTo(px, ay + 3)
    ctx.stroke()
    ctx.fillText(formatTick(gx, stepX), px, Math.min(ay + 4, y + h - label - 2))
  }
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let gy = Math.ceil(ymin / stepY) * stepY; gy <= ymax; gy += stepY) {
    if (Math.abs(gy) < stepY / 2) continue
    const py = sy(gy)
    ctx.beginPath()
    ctx.moveTo(ax - 3, py)
    ctx.lineTo(ax + 3, py)
    ctx.stroke()
    ctx.fillText(formatTick(gy, stepY), Math.max(ax - 5, x + label * 2), py)
  }
  if (xmin < 0 && xmax > 0 && ymin < 0 && ymax > 0) {
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    ctx.fillText('0', ax - 4, ay + 4)
  }

  // Courbes.
  ctx.lineWidth = Math.max(1.5, Math.min(w, h) / 160)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  for (const curve of el.curves) {
    const lines = samplesFor(curve)
    if (!lines) continue
    ctx.strokeStyle = inkColor(curve.color, bg)
    ctx.beginPath()
    for (const line of lines) {
      ctx.moveTo(sx(line[0]!), sy(line[1]!))
      for (let i = 2; i < line.length; i += 2) ctx.lineTo(sx(line[i]!), sy(line[i + 1]!))
    }
    ctx.stroke()
  }
  ctx.restore()

  ctx.strokeStyle = dark ? '#475569' : '#cbd5e1'
  ctx.lineWidth = 1
  ctx.strokeRect(x, y, w, h)
}
