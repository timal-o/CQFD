import { getStroke } from 'perfect-freehand'
import type { PageBackground, StrokeElement } from '@cqfd/shared'
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
