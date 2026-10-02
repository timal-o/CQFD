import { elementBox, intersects, viewportBox, worldToScreen } from './geometry'
import { buildStrokePath, drawBackground, fillStroke, inkColor, strokePath } from './render'
import type { BoardStore, RenderKind } from './store'
import { LASER_TRAIL_MS, type Box, type LaserPoint } from './types'

/** Ce que le contrôleur veut voir dessiné sur le calque actif. */
export interface Overlay {
  current: { tool: 'pen' | 'highlighter'; color: string; size: number; pts: number[] } | null
  ownLaser: LaserPoint[]
  marquee: Box | null
  cursor: { x: number; y: number; radius: number; kind: 'eraser' | 'laser' } | null
  selectionBox: Box | null
}

export const HANDLE_SIZE = 10

/**
 * Deux canvas : le calque de base (éléments validés, redessiné seulement si le document
 * ou la caméra change) et le calque actif (tracés en cours, laser, sélection).
 */
export class BoardRenderer {
  private width = 0
  private height = 0
  private dpr = 1
  private baseDirty = true
  private topDirty = true
  private raf = 0
  private unsub: () => void

  constructor(
    private readonly store: BoardStore,
    private readonly base: HTMLCanvasElement,
    private readonly top: HTMLCanvasElement,
    private readonly world: HTMLElement,
    private readonly overlay: () => Overlay,
  ) {
    this.unsub = store.onRender((kind) => this.invalidate(kind))
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    this.unsub()
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = height
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    for (const c of [this.base, this.top]) {
      c.width = Math.round(width * this.dpr)
      c.height = Math.round(height * this.dpr)
      c.style.width = `${width}px`
      c.style.height = `${height}px`
    }
    this.invalidate('camera')
  }

  invalidate(kind: RenderKind): void {
    if (kind !== 'live') this.baseDirty = true
    this.topDirty = true
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame())
  }

  private frame(): void {
    this.raf = 0
    const cam = this.store.camera()
    this.world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`
    if (this.baseDirty) this.drawBase()
    let animating = false
    if (this.topDirty) animating = this.drawTop()
    this.baseDirty = false
    this.topDirty = animating
    if (animating) this.raf = requestAnimationFrame(() => this.frame())
  }

  private drawBase(): void {
    const ctx = this.base.getContext('2d')!
    const cam = this.store.camera()
    const bg = this.store.page?.bg ?? 'blank'
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    drawBackground(ctx, bg, cam, this.width, this.height)
    ctx.setTransform(this.dpr * cam.z, 0, 0, this.dpr * cam.z, this.dpr * cam.x, this.dpr * cam.y)
    const view = viewportBox(cam, this.width, this.height)
    for (const el of this.store.pageElements()) {
      if (el.type !== 'stroke') continue
      if (!intersects(view, elementBox(el, this.store.textHeights))) continue
      fillStroke(ctx, strokePath(el), el.tool, el.color, bg)
    }
  }

  /** Renvoie true s'il faut continuer à animer (laser qui s'estompe, tracés en direct). */
  private drawTop(): boolean {
    const ctx = this.top.getContext('2d')!
    const store = this.store
    const cam = store.camera()
    const bg = store.page?.bg ?? 'blank'
    const ov = this.overlay()
    const now = performance.now()
    let animating = false

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)
    ctx.setTransform(this.dpr * cam.z, 0, 0, this.dpr * cam.z, this.dpr * cam.x, this.dpr * cam.y)

    // Tracés en direct des autres participants.
    for (const [key, live] of store.live) {
      if (now - live.updatedAt > 5000) {
        store.live.delete(key)
        continue
      }
      if (live.pageId !== store.pageId || live.pts.length < 3) continue
      fillStroke(ctx, buildStrokePath(live.tool, live.size, live.pts, false), live.tool, live.color, bg)
    }

    // Mon tracé en cours.
    if (ov.current && ov.current.pts.length >= 3) {
      const c = ov.current
      fillStroke(ctx, buildStrokePath(c.tool, c.size, c.pts, false), c.tool, c.color, bg)
    }

    // Lasers (le mien et ceux reçus).
    const trails: LaserPoint[][] = [ov.ownLaser]
    for (const [by, trail] of store.lasers) {
      const pts = trail.pts.filter((p) => now - p.t < LASER_TRAIL_MS)
      if (pts.length === 0) store.lasers.delete(by)
      else if (trail.pageId === store.pageId) trails.push(pts)
    }
    for (const pts of trails) {
      const visible = pts.filter((p) => now - p.t < LASER_TRAIL_MS)
      if (visible.length === 0) continue
      animating = true
      drawLaser(ctx, visible, now, cam.z)
    }
    if (store.live.size > 0) animating = true

    // Calques d'interface, en coordonnées écran.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    if (ov.selectionBox) {
      const a = worldToScreen(cam, ov.selectionBox.minX, ov.selectionBox.minY)
      const b = worldToScreen(cam, ov.selectionBox.maxX, ov.selectionBox.maxY)
      ctx.strokeStyle = '#2563eb'
      ctx.lineWidth = 1.5
      ctx.setLineDash([5, 4])
      ctx.strokeRect(a.x - 4, a.y - 4, b.x - a.x + 8, b.y - a.y + 8)
      ctx.setLineDash([])
      ctx.fillStyle = '#ffffff'
      for (const [hx, hy] of [
        [a.x - 4, a.y - 4],
        [b.x + 4, a.y - 4],
        [a.x - 4, b.y + 4],
        [b.x + 4, b.y + 4],
      ] as const) {
        ctx.fillRect(hx - HANDLE_SIZE / 2, hy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE)
        ctx.strokeRect(hx - HANDLE_SIZE / 2, hy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE)
      }
    }
    if (ov.marquee) {
      const a = worldToScreen(cam, ov.marquee.minX, ov.marquee.minY)
      const b = worldToScreen(cam, ov.marquee.maxX, ov.marquee.maxY)
      ctx.fillStyle = 'rgba(37, 99, 235, 0.08)'
      ctx.strokeStyle = '#2563eb'
      ctx.lineWidth = 1
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y)
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
    }
    if (ov.cursor?.kind === 'eraser') {
      ctx.strokeStyle = inkColor('#111827', bg)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(ov.cursor.x, ov.cursor.y, ov.cursor.radius, 0, Math.PI * 2)
      ctx.stroke()
    }
    return animating
  }
}

function drawLaser(ctx: CanvasRenderingContext2D, pts: LaserPoint[], now: number, zoom: number): void {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    const life = 1 - (now - b.t) / LASER_TRAIL_MS
    ctx.strokeStyle = `rgba(239, 68, 68, ${Math.max(0, life) * 0.8})`
    ctx.lineWidth = (2 + 4 * life) / zoom
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  const head = pts[pts.length - 1]!
  if (now - head.t < 400) {
    ctx.fillStyle = '#ef4444'
    ctx.shadowColor = '#ef4444'
    ctx.shadowBlur = 12
    ctx.beginPath()
    ctx.arc(head.x, head.y, 6 / zoom, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
  }
}
