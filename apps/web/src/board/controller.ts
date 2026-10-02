import {
  LIMITS,
  randomId,
  SEND_INTERVALS,
  type BoardElement,
  type FormulaElement,
  type GraphElement,
  type Op,
  type StrokeElement,
  type TextElement,
} from '@cqfd/shared'
import {
  eraseFromStroke,
  elementBox,
  hitElement,
  hitStroke,
  intersects,
  makeStroke,
  scaleElement,
  screenToWorld,
  simplify,
  translateElement,
  unionBox,
  worldToScreen,
} from './geometry'
import { HANDLE_SIZE, type Overlay } from './renderer'
import { recognizeShape, snapLineEnd, type Pt } from './shapes'
import type { BoardStore } from './store'
import { LASER_TRAIL_MS, MAX_ZOOM, MIN_ZOOM, type Box, type Camera, type LaserPoint } from './types'

type Gesture =
  | {
      kind: 'draw'
      pointerId: number
      pointerType: string
      id: string
      tool: 'pen' | 'highlighter'
      color: string
      size: number
      /** Points affichés et enregistrés (tracé libre, trait droit ou forme propre). */
      pts: number[]
      /** Tous les points saisis, pour revenir au tracé libre ou reconnaître une forme. */
      raw: number[]
      unsent: number[]
      lastSend: number
      /** Trait droit (Maj enfoncée). */
      straight: boolean
      /** Forme reconnue après un temps d'arrêt : le tracé est figé. */
      snapped: boolean
      holdTimer: ReturnType<typeof setTimeout> | undefined
      holdAnchor: { x: number; y: number }
    }
  | {
      kind: 'erase'
      pointerId: number
      mode: 'stroke' | 'pixel'
      last: { x: number; y: number } | null
      /** Éléments existants avant le geste, supprimés. */
      removed: Set<string>
      /** Leur état d'origine (pour l'annulation). */
      originals: Map<string, StrokeElement>
      /** Morceaux créés pendant le geste (gomme pixel). */
      created: Map<string, StrokeElement>
    }
  | { kind: 'pan'; pointerId: number; sx: number; sy: number; cam: Camera }
  | { kind: 'pinch'; ids: [number, number]; dist: number; mid: { x: number; y: number }; cam: Camera }
  | { kind: 'move'; pointerId: number; start: { x: number; y: number }; originals: Map<string, BoardElement>; moved: boolean }
  | {
      kind: 'resize'
      pointerId: number
      anchor: { x: number; y: number }
      corner: { x: number; y: number }
      originals: Map<string, BoardElement>
    }
  | { kind: 'marquee'; pointerId: number; start: { x: number; y: number }; box: Box; additive: boolean }
  | { kind: 'laser'; pointerId: number; unsent: number[]; lastSend: number }

const ERASER_RADIUS = { stroke: 8, pixel: 12 }
/** Immobilité (ms et px écran) qui déclenche la reconnaissance de forme. */
const HOLD_MS = 550
const HOLD_TOLERANCE = 4
const MAX_STROKE_TRIPLETS = Math.floor(LIMITS.maxStrokeNumbers / 3) - 10

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.tagName === 'MATH-FIELD' ||
    target.closest('[data-no-shortcuts]') !== null)

/**
 * Gestion des entrées : stylet, souris, doigts (rejet de la paume), molette, clavier.
 * Les modifications sont appliquées localement tout de suite et envoyées en fin de geste.
 */
export class BoardController {
  private gesture: Gesture | null = null
  private pointers = new Map<number, { x: number; y: number; type: string }>()
  private penSeen = false
  private spaceDown = false
  private hover: { x: number; y: number } | null = null
  private ownLaser: LaserPoint[] = []
  private lastDeniedToast = -Infinity
  private readonly cleanup: (() => void)[] = []

  constructor(
    private readonly store: BoardStore,
    private readonly el: HTMLElement,
  ) {
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      el.addEventListener(type, fn, opts)
      this.cleanup.push(() => el.removeEventListener(type, fn, opts))
    }
    on('pointerdown', (e) => this.onDown(e))
    on('pointermove', (e) => this.onMove(e))
    on('pointerup', (e) => this.onUp(e))
    on('pointercancel', (e) => this.onUp(e, true))
    on('pointerleave', () => {
      this.hover = null
      this.store.requestRender('live')
    })
    on('wheel', (e) => this.onWheel(e), { passive: false })
    on('dblclick', (e) => this.onDoubleClick(e))
    on('contextmenu', (e) => e.preventDefault())
    // Le tableau ne doit jamais voler le focus (sinon l'éditeur de texte se ferme aussitôt ouvert).
    on('mousedown', (e) => {
      if (!(e.target as HTMLElement).closest('[data-editor]')) e.preventDefault()
    })
    const key = (e: KeyboardEvent) => this.onKey(e)
    window.addEventListener('keydown', key)
    window.addEventListener('keyup', key)
    this.cleanup.push(() => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('keyup', key)
    })
  }

  dispose(): void {
    for (const fn of this.cleanup) fn()
  }

  // ---------------------------------------------------------------- état pour le rendu

  overlay = (): Overlay => {
    const g = this.gesture
    const store = this.store
    const tool = store.tools.tool
    let cursor: Overlay['cursor'] = null
    if (this.hover && tool === 'eraser') {
      cursor = { ...this.hover, radius: ERASER_RADIUS[store.tools.eraserMode], kind: 'eraser' }
    }
    let selectionBox: Box | null = null
    if (store.selection.size > 0 && g?.kind !== 'marquee') {
      selectionBox = unionBox(
        [...store.selection]
          .map((id) => store.elements.get(id))
          .filter((e): e is BoardElement => !!e)
          .map((e) => elementBox(e, store.domSizes)),
      )
    }
    return {
      current:
        g?.kind === 'draw' ? { tool: g.tool, color: g.color, size: g.size, pts: g.pts, geo: g.straight || g.snapped } : null,
      ownLaser: this.ownLaser.filter((p) => performance.now() - p.t < LASER_TRAIL_MS),
      marquee: g?.kind === 'marquee' ? g.box : null,
      cursor,
      selectionBox,
    }
  }

  // ---------------------------------------------------------------- utilitaires

  private local(e: PointerEvent | WheelEvent | MouseEvent) {
    const r = this.el.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  private world(e: PointerEvent | MouseEvent) {
    const p = this.local(e)
    return screenToWorld(this.store.camera(), p.x, p.y)
  }

  private denied(message: string): void {
    const now = performance.now()
    if (now - this.lastDeniedToast > 2500) {
      this.store.toast(message)
      this.lastDeniedToast = now
    }
  }

  private writeDeniedMessage(): string {
    return this.store.settings.frozen ? 'Le tableau est gelé par le professeur.' : 'Levez la main : le professeur doit vous donner la main pour écrire.'
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const cam = this.store.camera()
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.z * factor))
    const wx = (sx - cam.x) / cam.z
    const wy = (sy - cam.y) / cam.z
    this.store.setCamera({ x: sx - wx * z, y: sy - wy * z, z })
  }

  private pressure(e: PointerEvent): number {
    return e.pointerType === 'pen' ? Math.max(0.05, Math.min(1, e.pressure || 0.5)) : 0.5
  }

  // ---------------------------------------------------------------- pointeur

  private onDown(e: PointerEvent): void {
    if ((e.target as HTMLElement).closest('[data-editor]')) return
    // Supprime les événements souris de compatibilité (tactile, stylet).
    e.preventDefault()
    if (this.store.editingId) this.store.finishEditing?.()

    this.pointers.set(e.pointerId, { ...this.local(e), type: e.pointerType })
    if (e.pointerType === 'pen') this.penSeen = true

    // Deux doigts : zoom/déplacement, on abandonne le geste à un doigt en cours.
    const touches = [...this.pointers].filter(([, p]) => p.type === 'touch')
    if (e.pointerType === 'touch' && touches.length === 2) {
      if (this.gesture && this.gesture.kind !== 'pinch') this.cancelGesture()
      const a = touches[0]!
      const b = touches[1]!
      this.gesture = {
        kind: 'pinch',
        ids: [a[0], b[0]],
        dist: Math.hypot(a[1].x - b[1].x, a[1].y - b[1].y) || 1,
        mid: { x: (a[1].x + b[1].x) / 2, y: (a[1].y + b[1].y) / 2 },
        cam: { ...this.store.camera() },
      }
      return
    }
    if (this.gesture) return

    const pos = this.local(e)
    const w = screenToWorld(this.store.camera(), pos.x, pos.y)
    const tool = this.store.tools.tool
    try {
      this.el.setPointerCapture(e.pointerId)
    } catch {
      // pointeur déjà relâché (ou événement synthétique)
    }

    // Rejet de la paume : dès qu'un stylet a été vu, le doigt sert seulement à se déplacer.
    const palm = e.pointerType === 'touch' && this.penSeen
    if (tool === 'hand' || e.button === 1 || this.spaceDown || palm) {
      this.gesture = { kind: 'pan', pointerId: e.pointerId, sx: pos.x, sy: pos.y, cam: { ...this.store.camera() } }
      return
    }
    if (e.button === 2) return

    // Bout gomme du stylet.
    const eraserTip = e.pointerType === 'pen' && (e.buttons & 32) !== 0
    if (tool === 'eraser' || eraserTip) {
      if (!this.store.canWrite) return this.denied(this.writeDeniedMessage())
      this.gesture = {
        kind: 'erase',
        pointerId: e.pointerId,
        mode: eraserTip ? 'stroke' : this.store.tools.eraserMode,
        last: null,
        removed: new Set(),
        originals: new Map(),
        created: new Map(),
      }
      this.eraseAt(w.x, w.y)
      return
    }

    switch (tool) {
      case 'pen':
      case 'highlighter': {
        if (!this.store.canWrite) return this.denied(this.writeDeniedMessage())
        const t = this.store.tools
        const z = this.store.camera().z
        this.gesture = {
          kind: 'draw',
          pointerId: e.pointerId,
          pointerType: e.pointerType,
          id: randomId(),
          tool,
          color: tool === 'pen' ? t.penColor : t.hlColor,
          // L'épaisseur suit le zoom pour rester constante à l'écran.
          size: Math.round(((tool === 'pen' ? t.penSize : t.hlSize) / z) * 10) / 10,
          pts: [w.x, w.y, this.pressure(e)],
          raw: [w.x, w.y, this.pressure(e)],
          unsent: [w.x, w.y, this.pressure(e)],
          lastSend: 0,
          straight: e.shiftKey,
          snapped: false,
          holdTimer: undefined,
          holdAnchor: pos,
        }
        this.armHold(this.gesture)
        this.store.requestRender('live')
        return
      }
      case 'laser': {
        if (!this.store.canLaser) return this.denied('Le pointeur laser est réservé au professeur.')
        this.gesture = { kind: 'laser', pointerId: e.pointerId, unsent: [], lastSend: 0 }
        this.laserAt(w.x, w.y)
        return
      }
      case 'text':
        return this.textAt(w.x, w.y)
      case 'formula':
        return this.formulaAt(w.x, w.y)
      case 'graph':
        return this.graphAt(w.x, w.y)
      case 'select':
        return this.selectDown(e, pos, w)
      default:
        return
    }
  }

  private onMove(e: PointerEvent): void {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { ...this.local(e), type: e.pointerType })
    const pos = this.local(e)
    this.hover = e.pointerType === 'touch' ? null : pos
    const g = this.gesture
    if (!g) {
      if (this.store.tools.tool === 'eraser') this.store.requestRender('live')
      return
    }

    if (g.kind === 'pinch') {
      const a = this.pointers.get(g.ids[0])
      const b = this.pointers.get(g.ids[1])
      if (!a || !b) return
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, g.cam.z * (dist / g.dist)))
      const wx = (g.mid.x - g.cam.x) / g.cam.z
      const wy = (g.mid.y - g.cam.y) / g.cam.z
      this.store.setCamera({ x: mid.x - wx * z, y: mid.y - wy * z, z })
      return
    }
    if ('pointerId' in g && g.pointerId !== e.pointerId) return

    const cam = this.store.camera()
    switch (g.kind) {
      case 'pan':
        this.store.setCamera({ ...g.cam, x: g.cam.x + pos.x - g.sx, y: g.cam.y + pos.y - g.sy })
        return
      case 'draw': {
        // Forme reconnue : le tracé est figé jusqu'au relâchement.
        if (g.snapped) return
        const events = e.getCoalescedEvents?.() ?? [e]
        const r = this.el.getBoundingClientRect()
        for (const ev of events.length > 0 ? events : [e]) {
          const p = screenToWorld(cam, ev.clientX - r.left, ev.clientY - r.top)
          const pr = this.pressure(ev)
          g.raw.push(p.x, p.y, pr)
          g.unsent.push(p.x, p.y, pr)
          if (!g.straight) g.pts.push(p.x, p.y, pr)
        }
        g.straight = e.shiftKey
        this.applyStraight(g)
        // Le geste bouge encore : on relance le délai de reconnaissance de forme.
        if (Math.hypot(pos.x - g.holdAnchor.x, pos.y - g.holdAnchor.y) > HOLD_TOLERANCE) {
          g.holdAnchor = pos
          this.armHold(g)
        }
        const now = performance.now()
        if (now - g.lastSend >= SEND_INTERVALS.live) this.flushLive(g, now)
        this.store.requestRender('live')
        return
      }
      case 'erase': {
        const w = screenToWorld(cam, pos.x, pos.y)
        this.eraseAt(w.x, w.y)
        return
      }
      case 'laser': {
        const w = screenToWorld(cam, pos.x, pos.y)
        this.laserAt(w.x, w.y)
        return
      }
      case 'move': {
        const w = screenToWorld(cam, pos.x, pos.y)
        const dx = w.x - g.start.x
        const dy = w.y - g.start.y
        if (!g.moved && Math.hypot(dx, dy) * cam.z < 3) return
        g.moved = true
        this.store.applyLocal([...g.originals.values()].map((el) => ({ o: 'put', el: translateElement(el, dx, dy) })))
        return
      }
      case 'resize': {
        const w = screenToWorld(cam, pos.x, pos.y)
        const vx = g.corner.x - g.anchor.x
        const vy = g.corner.y - g.anchor.y
        const len = vx * vx + vy * vy || 1
        const s = Math.max(0.05, ((w.x - g.anchor.x) * vx + (w.y - g.anchor.y) * vy) / len)
        this.store.applyLocal(
          [...g.originals.values()].map((el) => ({ o: 'put', el: scaleElement(el, g.anchor.x, g.anchor.y, s) })),
        )
        return
      }
      case 'marquee': {
        const w = screenToWorld(cam, pos.x, pos.y)
        g.box = {
          minX: Math.min(g.start.x, w.x),
          minY: Math.min(g.start.y, w.y),
          maxX: Math.max(g.start.x, w.x),
          maxY: Math.max(g.start.y, w.y),
        }
        this.store.requestRender('live')
        return
      }
    }
  }

  private onUp(e: PointerEvent, cancelled = false): void {
    this.pointers.delete(e.pointerId)
    const g = this.gesture
    if (!g) return
    if (g.kind === 'pinch') {
      if (g.ids.includes(e.pointerId)) this.gesture = null
      return
    }
    if (g.pointerId !== e.pointerId) return
    this.gesture = null
    if (g.kind === 'draw') clearTimeout(g.holdTimer)
    if (cancelled && g.kind === 'draw') {
      this.store.send({ t: 'live', id: g.id, pageId: this.store.pageId!, tool: g.tool, color: g.color, size: g.size, pts: [], end: true })
      this.store.requestRender('live')
      return
    }

    switch (g.kind) {
      case 'draw':
        return this.finishStroke(g)
      case 'erase':
        return this.finishErase(g)
      case 'laser':
        this.flushLaser(g, performance.now())
        return
      case 'move':
        if (g.moved) {
          const ops: Op[] = [...g.originals.keys()]
            .map((id) => this.store.elements.get(id))
            .filter((el): el is BoardElement => !!el)
            .map((el) => ({ o: 'put', el }))
          this.store.commit(ops, { applied: true, before: new Map(g.originals) })
        }
        return
      case 'resize': {
        const ops: Op[] = [...g.originals.keys()]
          .map((id) => this.store.elements.get(id))
          .filter((el): el is BoardElement => !!el)
          .map((el) => ({ o: 'put', el }))
        this.store.commit(ops, { applied: true, before: new Map(g.originals) })
        return
      }
      case 'marquee': {
        if (!g.additive) this.store.selection.clear()
        for (const el of this.store.pageElements()) {
          if (this.store.canEdit(el) && intersects(g.box, elementBox(el, this.store.domSizes))) {
            this.store.selection.add(el.id)
          }
        }
        this.store.requestRender('live')
        this.store.emit()
        return
      }
      default:
        return
    }
  }

  /** Abandonne le geste en cours (par ex. quand un deuxième doigt se pose). */
  private cancelGesture(): void {
    const g = this.gesture
    this.gesture = null
    if (!g) return
    if (g.kind === 'draw') {
      clearTimeout(g.holdTimer)
      this.store.send({ t: 'live', id: g.id, pageId: this.store.pageId!, tool: g.tool, color: g.color, size: g.size, pts: [], end: true })
    } else if (g.kind === 'erase') {
      this.finishErase(g)
    } else if (g.kind === 'move' || g.kind === 'resize') {
      this.store.applyLocal([...g.originals.values()].map((el) => ({ o: 'put', el })))
    }
    this.store.requestRender('live')
  }

  // ---------------------------------------------------------------- tracé

  private flushLive(g: Extract<Gesture, { kind: 'draw' }>, now: number): void {
    if (g.unsent.length === 0 || !this.store.pageId) return
    const pts = g.unsent.splice(0, LIMITS.maxLiveNumbers - (LIMITS.maxLiveNumbers % 3))
    this.store.send({
      t: 'live',
      id: g.id,
      pageId: this.store.pageId,
      tool: g.tool,
      color: g.color,
      size: g.size,
      pts: pts.map((v, i) => (i % 3 === 2 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10)),
    })
    g.lastSend = now
  }

  /** Maj : le tracé devient un trait droit du point de départ au point courant (et inversement). */
  private applyStraight(g: Extract<Gesture, { kind: 'draw' }>): void {
    if (g.snapped) return
    if (g.straight) {
      const n = g.raw.length
      const end = snapLineEnd([g.raw[0]!, g.raw[1]!], [g.raw[n - 3]!, g.raw[n - 2]!])
      g.pts = [g.raw[0]!, g.raw[1]!, 0.5, end[0], end[1], 0.5]
    } else if (g.pts.length !== g.raw.length) {
      g.pts = g.raw.slice()
    }
  }

  /** Arme le délai au bout duquel un geste immobile est remplacé par une forme propre. */
  private armHold(g: Extract<Gesture, { kind: 'draw' }>): void {
    clearTimeout(g.holdTimer)
    g.holdTimer = setTimeout(() => this.snapShape(g), HOLD_MS)
  }

  private snapShape(g: Extract<Gesture, { kind: 'draw' }>): void {
    if (this.gesture !== g || g.snapped || g.straight) return
    const pts: Pt[] = []
    for (let i = 0; i < g.raw.length; i += 3) pts.push([g.raw[i]!, g.raw[i + 1]!])
    const shape = recognizeShape(pts)
    if (!shape) return
    g.snapped = true
    g.pts = shape.points.flatMap(([x, y]) => [x, y, 0.5])
    this.store.requestRender('live')
  }

  private finishStroke(g: Extract<Gesture, { kind: 'draw' }>): void {
    clearTimeout(g.holdTimer)
    const store = this.store
    const me = store.me
    if (!me || !store.pageId) return
    const z = store.camera().z
    const geo = g.straight || g.snapped
    if (geo && g.pts.length >= 6) {
      const el = makeStroke(
        { id: g.id, pageId: store.pageId, authorId: me.id, z: store.nextZ(), tool: g.tool, color: g.color, size: g.size },
        g.pts,
      )
      store.commit([{ o: 'put', el: { ...el, geo: true } }])
      store.send({ t: 'live', id: g.id, pageId: store.pageId, tool: g.tool, color: g.color, size: g.size, pts: [], end: true })
      store.requestRender('live')
      return
    }
    let pts = simplify(g.pts, 0.6 / z)
    const ops: Op[] = []
    let zIndex = store.nextZ()
    // Un trait très long est découpé en plusieurs éléments.
    while (pts.length > 0) {
      const chunk = pts.slice(0, MAX_STROKE_TRIPLETS * 3)
      pts = pts.length > chunk.length ? pts.slice(chunk.length - 3) : []
      ops.push({
        o: 'put',
        el: makeStroke(
          { id: ops.length === 0 ? g.id : randomId(), pageId: store.pageId, authorId: me.id, z: zIndex++, tool: g.tool, color: g.color, size: g.size },
          chunk,
        ),
      })
    }
    store.commit(ops)
    store.send({ t: 'live', id: g.id, pageId: store.pageId, tool: g.tool, color: g.color, size: g.size, pts: [], end: true })
    store.requestRender('live')
  }

  // ---------------------------------------------------------------- gomme

  private eraseAt(x: number, y: number): void {
    const g = this.gesture
    if (g?.kind !== 'erase') return
    const store = this.store
    const radius = ERASER_RADIUS[g.mode] / store.camera().z

    // Échantillonne le segment depuis la dernière position pour ne rien rater.
    const samples: { x: number; y: number }[] = []
    if (g.last) {
      const n = Math.max(1, Math.ceil(Math.hypot(x - g.last.x, y - g.last.y) / (radius / 2)))
      for (let i = 1; i <= n; i++) samples.push({ x: g.last.x + ((x - g.last.x) * i) / n, y: g.last.y + ((y - g.last.y) * i) / n })
    } else {
      samples.push({ x, y })
    }
    g.last = { x, y }

    const ops: Op[] = []
    for (const s of samples) {
      for (const el of store.pageElements()) {
        if (el.type !== 'stroke' || !store.canEdit(el)) continue
        if (g.mode === 'stroke') {
          if (!hitStroke(el, s.x, s.y, radius)) continue
          g.removed.add(el.id)
          g.originals.set(el.id, el)
          ops.push({ o: 'del', id: el.id })
        } else {
          const pieces = eraseFromStroke(el, s.x, s.y, radius)
          if (!pieces) continue
          if (g.created.has(el.id)) g.created.delete(el.id)
          else {
            g.removed.add(el.id)
            g.originals.set(el.id, el)
          }
          ops.push({ o: 'del', id: el.id })
          for (const p of pieces) {
            g.created.set(p.id, p)
            ops.push({ o: 'put', el: p })
          }
        }
      }
      if (ops.length > 0) {
        store.applyLocal(ops)
        ops.length = 0
      }
    }
    this.store.requestRender('live')
  }

  private finishErase(g: Extract<Gesture, { kind: 'erase' }>): void {
    const ops: Op[] = [
      ...[...g.removed].map((id): Op => ({ o: 'del', id })),
      ...[...g.created.values()].map((el): Op => ({ o: 'put', el })),
    ]
    for (let i = 0; i < ops.length; i += LIMITS.maxOpsPerMessage) {
      const chunk = ops.slice(i, i + LIMITS.maxOpsPerMessage)
      const before = new Map(chunk.map((op) => {
        const id = op.o === 'put' ? op.el.id : op.id
        return [id, g.originals.get(id) ?? null] as const
      }))
      this.store.commit(chunk, { applied: true, before })
    }
  }

  // ---------------------------------------------------------------- laser

  private laserAt(x: number, y: number): void {
    const g = this.gesture
    if (g?.kind !== 'laser') return
    const now = performance.now()
    this.ownLaser = this.ownLaser.filter((p) => now - p.t < LASER_TRAIL_MS)
    this.ownLaser.push({ x, y, t: now })
    g.unsent.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10)
    if (now - g.lastSend >= SEND_INTERVALS.laser) this.flushLaser(g, now)
    this.store.requestRender('live')
  }

  private flushLaser(g: Extract<Gesture, { kind: 'laser' }>, now: number): void {
    if (g.unsent.length === 0 || !this.store.pageId) return
    // On garde au plus 8 points par envoi : la traînée reste fluide et le message court.
    const pts = g.unsent.length > 16 ? g.unsent.filter((_, i) => Math.floor(i / 2) % Math.ceil(g.unsent.length / 16) === 0) : g.unsent
    this.store.send({ t: 'laser', pageId: this.store.pageId, pts: pts.slice(0, LIMITS.maxLaserNumbers) })
    g.unsent = []
    g.lastSend = now
  }

  // ---------------------------------------------------------------- sélection

  private topHit(x: number, y: number, editableOnly: boolean): BoardElement | null {
    const radius = 6 / this.store.camera().z
    const list = this.store.pageElements()
    for (let i = list.length - 1; i >= 0; i--) {
      const el = list[i]!
      if (editableOnly && !this.store.canEdit(el)) continue
      if (hitElement(el, x, y, radius, this.store.domSizes)) return el
    }
    return null
  }

  private selectDown(e: PointerEvent, pos: { x: number; y: number }, w: { x: number; y: number }): void {
    const store = this.store
    const cam = store.camera()

    // Poignées de redimensionnement.
    const box = this.overlay().selectionBox
    if (box) {
      const corners = [
        { sx: box.minX, sy: box.minY, ax: box.maxX, ay: box.maxY, ox: -4, oy: -4 },
        { sx: box.maxX, sy: box.minY, ax: box.minX, ay: box.maxY, ox: 4, oy: -4 },
        { sx: box.minX, sy: box.maxY, ax: box.maxX, ay: box.minY, ox: -4, oy: 4 },
        { sx: box.maxX, sy: box.maxY, ax: box.minX, ay: box.minY, ox: 4, oy: 4 },
      ]
      for (const c of corners) {
        const s = worldToScreen(cam, c.sx, c.sy)
        if (Math.abs(s.x + c.ox - pos.x) <= HANDLE_SIZE && Math.abs(s.y + c.oy - pos.y) <= HANDLE_SIZE) {
          this.gesture = {
            kind: 'resize',
            pointerId: e.pointerId,
            anchor: { x: c.ax, y: c.ay },
            corner: { x: c.sx, y: c.sy },
            originals: this.selectedElements(),
          }
          return
        }
      }
    }

    const hit = this.topHit(w.x, w.y, true)
    if (hit) {
      if (e.shiftKey) {
        if (store.selection.has(hit.id)) store.selection.delete(hit.id)
        else store.selection.add(hit.id)
      } else if (!store.selection.has(hit.id)) {
        store.selection.clear()
        store.selection.add(hit.id)
      }
      this.gesture = { kind: 'move', pointerId: e.pointerId, start: w, originals: this.selectedElements(), moved: false }
      store.requestRender('live')
      store.emit()
      return
    }
    this.gesture = {
      kind: 'marquee',
      pointerId: e.pointerId,
      start: w,
      box: { minX: w.x, minY: w.y, maxX: w.x, maxY: w.y },
      additive: e.shiftKey,
    }
    if (!e.shiftKey && store.selection.size > 0) {
      store.selection.clear()
      store.emit()
    }
  }

  private selectedElements(): Map<string, BoardElement> {
    const map = new Map<string, BoardElement>()
    for (const id of this.store.selection) {
      const el = this.store.elements.get(id)
      if (el) map.set(id, el)
    }
    return map
  }

  deleteSelection(): void {
    const ops: Op[] = [...this.store.selection].map((id) => ({ o: 'del', id }))
    this.store.selection.clear()
    this.store.commit(ops)
    this.store.emit()
  }

  // ---------------------------------------------------------------- texte

  private textAt(x: number, y: number): void {
    const store = this.store
    if (!store.canWrite) return this.denied(this.writeDeniedMessage())
    const hit = this.topHit(x, y, true)
    if (hit?.type === 'text') {
      store.startEditing(hit.id)
      return
    }
    const z = store.camera().z
    const el: TextElement = {
      id: randomId(),
      pageId: store.pageId!,
      authorId: store.me!.id,
      z: store.nextZ(),
      type: 'text',
      x: Math.round(x),
      y: Math.round(y - 12 / z),
      w: Math.round(360 / z),
      fs: Math.max(8, Math.min(200, Math.round(22 / z))),
      color: store.tools.textColor,
      blocks: [],
    }
    store.drafts.add(el.id)
    store.applyLocal([{ o: 'put', el }])
    store.startEditing(el.id)
  }

  private formulaAt(x: number, y: number): void {
    const store = this.store
    if (!store.canWrite) return this.denied(this.writeDeniedMessage())
    const hit = this.topHit(x, y, true)
    if (hit?.type === 'formula') {
      store.startEditing(hit.id)
      return
    }
    const z = store.camera().z
    const el: FormulaElement = {
      id: randomId(),
      pageId: store.pageId!,
      authorId: store.me!.id,
      z: store.nextZ(),
      type: 'formula',
      x: Math.round(x),
      y: Math.round(y - 20 / z),
      latex: '',
      fs: Math.max(8, Math.min(200, Math.round(28 / z))),
      color: store.tools.textColor,
    }
    store.drafts.add(el.id)
    store.applyLocal([{ o: 'put', el }])
    store.startEditing(el.id)
  }

  private graphAt(x: number, y: number): void {
    const store = this.store
    if (!store.canWrite) return this.denied(this.writeDeniedMessage())
    const hit = this.topHit(x, y, true)
    if (hit?.type === 'graph') {
      store.startEditing(hit.id)
      return
    }
    const z = store.camera().z
    const el: GraphElement = {
      id: randomId(),
      pageId: store.pageId!,
      authorId: store.me!.id,
      z: store.nextZ(),
      type: 'graph',
      x: Math.round(x),
      y: Math.round(y),
      w: Math.round(440 / z),
      h: Math.round(330 / z),
      xmin: -5,
      xmax: 5,
      ymin: -4,
      ymax: 4,
      grid: true,
      curves: [],
    }
    store.commit([{ o: 'put', el }])
    store.startEditing(el.id)
  }

  private onDoubleClick(e: MouseEvent): void {
    const tool = this.store.tools.tool
    if (tool !== 'select' && tool !== 'text' && tool !== 'formula' && tool !== 'graph') return
    if ((e.target as HTMLElement).closest('[data-editor]')) return
    const w = this.world(e)
    const hit = this.topHit(w.x, w.y, true)
    if (hit && hit.type !== 'stroke' && this.store.canWrite) this.store.startEditing(hit.id)
  }

  // ---------------------------------------------------------------- molette et clavier

  private onWheel(e: WheelEvent): void {
    e.preventDefault()
    const pos = this.local(e)
    if (e.ctrlKey || e.metaKey) {
      this.zoomAt(pos.x, pos.y, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01)))
    } else {
      const cam = this.store.camera()
      const k = e.deltaMode === 1 ? 16 : 1
      this.store.setCamera({ ...cam, x: cam.x - e.deltaX * k, y: cam.y - e.deltaY * k })
    }
  }

  private onKey(e: KeyboardEvent): void {
    // Maj pendant un tracé : bascule trait droit / tracé libre sans attendre un mouvement.
    if (e.key === 'Shift' && this.gesture?.kind === 'draw') {
      this.gesture.straight = e.type === 'keydown'
      this.applyStraight(this.gesture)
      this.store.requestRender('live')
      return
    }
    if (e.key === ' ' && !isTyping(e.target)) {
      this.spaceDown = e.type === 'keydown'
      if (e.type === 'keydown') e.preventDefault()
      return
    }
    if (e.type !== 'keydown' || isTyping(e.target)) return
    const store = this.store
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        store.undo()
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault()
        store.redo()
      }
      return
    }
    if (e.altKey) return
    if ((e.key === 'Delete' || e.key === 'Backspace') && store.selection.size > 0) {
      e.preventDefault()
      this.deleteSelection()
      return
    }
    if (e.key === 'Escape') {
      store.selection.clear()
      store.requestRender('live')
      store.emit()
      return
    }
    const shortcuts: Record<string, Parameters<BoardStore['setTools']>[0]> = {
      v: { tool: 'select' },
      p: { tool: 'pen' },
      s: { tool: 'highlighter' },
      e: { tool: 'eraser' },
      t: { tool: 'text' },
      f: { tool: 'formula' },
      g: { tool: 'graph' },
      l: { tool: 'laser' },
      h: { tool: 'hand' },
    }
    const patch = shortcuts[e.key.toLowerCase()]
    if (patch) store.setTools(patch)
  }
}
