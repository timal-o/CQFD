import {
  canEditElement,
  canUseLaser,
  canWrite,
  type BanInfo,
  type BoardElement,
  type ChatMessage,
  type ClientMessage,
  type InviteInfo,
  type LogEntry,
  type Me,
  type Op,
  type Page,
  type ParticipantInfo,
  type QuotaLevel,
  type RoomSettings,
  type ServerMessage,
  type TextBlock,
} from '@cqfd/shared'
import { RoomSocket, type SocketStatus } from '../net/socket'
import { elementBox, type DomSize } from './geometry'
import { LASER_TRAIL_MS, type Camera, type LaserTrail, type LiveStroke, type ToolSettings } from './types'

export type RenderKind = 'doc' | 'live' | 'camera'

/** Dernière activité visible d'un participant (pour les flèches hors-champ). */
export interface Activity {
  pageId: string
  x: number
  y: number
  t: number
  kind: 'write' | 'laser'
}

export const ACTIVITY_MS = 4000

export interface Toast {
  id: number
  text: string
}

/** Une étape d'annulation : état des éléments avant et après une de mes actions. */
interface HistoryEntry {
  before: Map<string, BoardElement | null>
  after: Map<string, BoardElement | null>
}

const MAX_HISTORY = 100

export interface CommitOptions {
  /** Les opérations sont déjà appliquées localement (aperçu pendant le geste). */
  applied?: boolean
  /** État avant l'action, obligatoire pour l'annulation si `applied`. */
  before?: Map<string, BoardElement | null>
  /** Faux pour ne pas créer d'étape d'annulation (annuler / rétablir eux-mêmes). */
  history?: boolean
}

const FATAL_ERRORS = new Set(['not_found', 'banned', 'kicked', 'locked', 'full', 'replaced'])

export const PEN_COLORS = ['#111827', '#1d4ed8', '#dc2626', '#15803d', '#ea580c', '#7c3aed']
export const HIGHLIGHTER_COLORS = ['#facc15', '#4ade80', '#f472b6', '#38bdf8']
export const PEN_SIZES = [2, 4, 8]

/**
 * État client d'une salle : copie locale du document (appliquée de façon optimiste),
 * état d'interface et état éphémère (tracés en direct, laser).
 */
export class BoardStore {
  status: SocketStatus = 'connecting'
  fatal: { code: string; message: string } | null = null
  me: Me | null = null
  settings: RoomSettings = { frozen: false, locked: false, laserForStudents: false, chatEnabled: true, maxParticipants: 50 }
  pages: Page[] = []
  elements = new Map<string, BoardElement>()
  participants: ParticipantInfo[] = []
  adminPage: string | null = null

  pageId: string | null = null
  follow = true
  cameras = new Map<string, Camera>()
  tools: ToolSettings = {
    tool: 'pen',
    penColor: PEN_COLORS[0]!,
    penSize: PEN_SIZES[1]!,
    hlColor: HIGHLIGHTER_COLORS[0]!,
    hlSize: 20,
    eraserMode: 'stroke',
    textColor: PEN_COLORS[0]!,
  }
  selection = new Set<string>()
  editingId: string | null = null
  /** Textes en cours de création, pas encore envoyés. */
  drafts = new Set<string>()
  /** Fourni par l'éditeur de texte monté : valide l'édition en cours. */
  finishEditing: (() => void) | null = null
  private editingOriginal: BoardElement | null = null
  /** Tailles mesurées dans le DOM (textes, formules), en unités du monde. */
  domSizes = new Map<string, DomSize>()
  live = new Map<string, LiveStroke>()
  lasers = new Map<string, LaserTrail>()
  activity = new Map<string, Activity>()
  toasts: Toast[] = []

  chat: ChatMessage[] = []
  unreadChat = 0
  chatOpen = false
  bans: BanInfo[] = []
  log: LogEntry[] = []
  invites: InviteInfo[] = []
  lastInvite: { id: string; token: string } | null = null
  quota: QuotaLevel = 'ok'
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []

  version = 0
  private socket: RoomSocket
  private pending = new Map<number, Op[]>()
  private seq = 0
  private toastId = 0
  private listeners = new Set<() => void>()
  private renderListeners = new Set<(kind: RenderKind) => void>()
  private sortedCache: { key: string; list: BoardElement[] } | null = null
  private docVersion = 0

  constructor(
    readonly code: string,
    private readonly joinInfo: () => { name: string; session: string; admin?: string },
  ) {
    this.socket = new RoomSocket(code, {
      onMessage: (msg) => this.handle(msg),
      onStatus: (status) => {
        this.status = status
        this.emit()
      },
      join: () => ({ t: 'join', ...this.joinInfo() }),
    })
  }

  // ---------------------------------------------------------------- abonnements

  connect(): void {
    this.socket.connect()
  }

  dispose(): void {
    this.socket.close()
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  onRender(fn: (kind: RenderKind) => void): () => void {
    this.renderListeners.add(fn)
    return () => {
      this.renderListeners.delete(fn)
    }
  }

  emit(): void {
    this.version++
    for (const fn of this.listeners) fn()
  }

  requestRender(kind: RenderKind): void {
    for (const fn of this.renderListeners) fn(kind)
  }

  private docChanged(): void {
    this.docVersion++
    this.requestRender('doc')
  }

  toast(text: string): void {
    const id = ++this.toastId
    this.toasts = [...this.toasts, { id, text }].slice(-4)
    this.emit()
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id)
      this.emit()
    }, 4000)
  }

  // ---------------------------------------------------------------- accès dérivés

  get isAdmin(): boolean {
    return this.me?.role === 'admin'
  }

  get flags() {
    return { frozen: this.settings.frozen, laserForStudents: this.settings.laserForStudents }
  }

  get canWrite(): boolean {
    if (this.quota === 'exceeded') return false
    return this.me ? canWrite(this.me, this.flags) : false
  }

  /** Ma main levée (élève). */
  get handUp(): boolean {
    return this.participants.find((p) => p.id === this.me?.id)?.handAt != null
  }

  setChatOpen(open: boolean): void {
    this.chatOpen = open
    if (open) this.unreadChat = 0
    this.emit()
  }

  get canLaser(): boolean {
    return this.me ? canUseLaser(this.me, this.flags) : false
  }

  canEdit(el: BoardElement): boolean {
    return this.me ? canEditElement(this.me, this.flags, el.authorId) : false
  }

  get page(): Page | undefined {
    return this.pages.find((p) => p.id === this.pageId)
  }

  camera(pageId = this.pageId ?? ''): Camera {
    let cam = this.cameras.get(pageId)
    if (!cam) {
      cam = { x: 0, y: 0, z: 1 }
      this.cameras.set(pageId, cam)
    }
    return cam
  }

  setCamera(cam: Camera): void {
    if (!this.pageId) return
    this.cameras.set(this.pageId, cam)
    this.requestRender('camera')
  }

  /** Éléments de la page courante, triés par z. */
  pageElements(): BoardElement[] {
    const key = `${this.pageId}:${this.docVersion}`
    if (this.sortedCache?.key === key) return this.sortedCache.list
    const list = [...this.elements.values()]
      .filter((e) => e.pageId === this.pageId)
      .sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1))
    this.sortedCache = { key, list }
    return list
  }

  nextZ(): number {
    const list = this.pageElements()
    return (list[list.length - 1]?.z ?? 0) + 1
  }

  participantName(id: string): string {
    return this.participants.find((p) => p.id === id)?.name ?? '?'
  }

  // ---------------------------------------------------------------- actions locales

  setPage(pageId: string, fromServer = false): void {
    if (this.pageId === pageId || !this.pages.some((p) => p.id === pageId)) return
    this.pageId = pageId
    this.selection.clear()
    this.editingId = null
    if (this.isAdmin && !fromServer) {
      this.adminPage = pageId
      this.send({ t: 'view', pageId })
    }
    this.docChanged()
    this.emit()
  }

  setFollow(follow: boolean): void {
    this.follow = follow
    if (follow && this.adminPage) this.setPage(this.adminPage, true)
    this.emit()
  }

  setTools(patch: Partial<ToolSettings>): void {
    this.tools = { ...this.tools, ...patch }
    if (patch.tool && patch.tool !== 'select') this.selection.clear()
    this.requestRender('live')
    this.emit()
  }

  send(msg: ClientMessage): boolean {
    return this.socket.send(msg)
  }

  /** Applique des opérations localement, sans les envoyer. */
  applyLocal(ops: Op[]): void {
    for (const op of ops) {
      if (op.o === 'put') this.elements.set(op.el.id, op.el)
      else {
        this.elements.delete(op.id)
        this.selection.delete(op.id)
        this.domSizes.delete(op.id)
        if (this.editingId === op.id) this.editingId = null
      }
    }
    this.docChanged()
  }

  /** Envoie des opérations (appliquées localement d'abord, de façon optimiste). */
  commit(ops: Op[], opts: CommitOptions = {}): void {
    if (ops.length === 0) return
    const ids = ops.map((op) => (op.o === 'put' ? op.el.id : op.id))
    let before = opts.before
    if (!opts.applied) {
      before = new Map(ids.map((id) => [id, this.elements.get(id) ?? null]))
      this.applyLocal(ops)
    }
    if (opts.history !== false && before) {
      const after = new Map(ids.map((id) => [id, this.elements.get(id) ?? null]))
      this.undoStack.push({ before: new Map(ids.map((id) => [id, before.get(id) ?? null])), after })
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift()
      this.redoStack = []
      this.emit()
    }
    const seq = ++this.seq
    this.pending.set(seq, ops)
    this.send({ t: 'ops', seq, ops })
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  undo(): void {
    this.travel(this.undoStack, this.redoStack, 'before', 'after')
  }

  redo(): void {
    this.travel(this.redoStack, this.undoStack, 'after', 'before')
  }

  /**
   * Annulation personnelle : ne touche que mes propres actions. Un élément modifié depuis
   * par quelqu'un d'autre n'est pas écrasé.
   */
  private travel(from: HistoryEntry[], to: HistoryEntry[], target: 'before' | 'after', expected: 'before' | 'after'): void {
    const entry = from.pop()
    if (!entry) return
    if (!this.canWrite) {
      from.push(entry)
      this.toast('Vous n’avez pas la main.')
      return
    }
    const pageIds = new Set(this.pages.map((p) => p.id))
    const ops: Op[] = []
    let skipped = 0
    for (const [id, wanted] of entry[target]) {
      const current = this.elements.get(id) ?? null
      if (JSON.stringify(current) !== JSON.stringify(entry[expected].get(id) ?? null)) {
        skipped++
        continue
      }
      if (wanted && !pageIds.has(wanted.pageId)) continue
      ops.push(wanted ? { o: 'put', el: wanted } : { o: 'del', id })
    }
    if (skipped > 0) this.toast('Certains éléments ont été modifiés depuis par quelqu’un d’autre : ils sont laissés tels quels.')
    this.commit(ops, { history: false })
    to.push(entry)
    this.emit()
  }

  startEditing(id: string): void {
    if (this.editingId === id) return
    if (this.editingId) this.finishEditing?.()
    this.editingId = id
    this.editingOriginal = this.elements.get(id) ?? null
    this.selection.clear()
    this.requestRender('live')
    this.emit()
  }

  /** Termine l'édition d'un texte : l'envoie, ou le supprime s'il est vide. */
  commitText(id: string, blocks: TextBlock[]): void {
    const el = this.elements.get(id)
    const original = this.editingOriginal
    const isDraft = this.drafts.delete(id)
    this.stopEditing(id)
    if (el?.type === 'text') {
      const empty = blocks.every((b) => b.runs.every((r) => r.s.trim() === ''))
      const next = { ...el, blocks }
      // L'élément a pu être prévisualisé localement (taille) : l'état « avant » est l'original.
      const before = new Map([[id, isDraft ? null : original]])
      if (empty) {
        this.applyLocal([{ o: 'del', id }])
        if (!isDraft) this.commit([{ o: 'del', id }], { applied: true, before })
      } else if (isDraft || JSON.stringify(next) !== JSON.stringify(original)) {
        this.applyLocal([{ o: 'put', el: next }])
        this.commit([{ o: 'put', el: next }], { applied: true, before })
      }
    }
    this.emit()
  }

  private noteActivity(by: string, pageId: string, x: number, y: number, kind: Activity['kind']): void {
    if (by === this.me?.id || !Number.isFinite(x) || !Number.isFinite(y)) return
    this.activity.set(by, { pageId, x, y, t: performance.now(), kind })
  }

  /** Termine l'édition d'une formule : l'envoie, ou la supprime si elle est vide. */
  commitFormula(id: string, latex: string): void {
    const el = this.elements.get(id)
    const original = this.editingOriginal
    const isDraft = this.drafts.delete(id)
    this.stopEditing(id)
    if (el?.type === 'formula') {
      const next = { ...el, latex: latex.trim() }
      if (!next.latex) {
        if (isDraft) this.applyLocal([{ o: 'del', id }])
        else {
          this.applyLocal([{ o: 'del', id }])
          this.commit([{ o: 'del', id }], { applied: true, before: new Map([[id, original]]) })
        }
      } else if (isDraft || JSON.stringify(next) !== JSON.stringify(original)) {
        this.applyLocal([{ o: 'put', el: next }])
        this.commit([{ o: 'put', el: next }], { applied: true, before: new Map([[id, isDraft ? null : original]]) })
      }
    }
    this.emit()
  }

  /** Annule l'édition en cours : restaure l'élément d'origine (ou retire le brouillon). */
  cancelEditing(): void {
    const id = this.editingId
    if (!id) return
    const original = this.editingOriginal
    const isDraft = this.drafts.delete(id)
    this.stopEditing(id)
    if (isDraft) this.applyLocal([{ o: 'del', id }])
    else if (original) this.applyLocal([{ o: 'put', el: original }])
    this.emit()
  }

  /** Ferme un éditeur dont les modifications sont déjà envoyées au fil de l'eau (repère). */
  closeEditing(): void {
    if (this.editingId) this.stopEditing(this.editingId)
    this.emit()
  }

  private stopEditing(id: string): void {
    if (this.editingId !== id) return
    this.editingId = null
    this.editingOriginal = null
    this.finishEditing = null
  }

  // ---------------------------------------------------------------- messages serveur

  private handle(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome': {
        this.me = msg.you
        this.settings = msg.settings
        this.pages = msg.pages
        this.participants = msg.participants
        this.adminPage = msg.adminPage
        const drafts = [...this.drafts].map((id) => this.elements.get(id)).filter((e) => !!e)
        this.elements = new Map(msg.elements.map((e) => [e.id, e]))
        for (const d of drafts) this.elements.set(d.id, d)
        this.live.clear()
        this.chat = msg.chat
        this.quota = msg.quota
        this.bans = msg.admin?.bans ?? []
        this.log = msg.admin?.log ?? []
        this.invites = msg.admin?.invites ?? []
        const keep = this.pageId && this.pages.some((p) => p.id === this.pageId)
        const target = this.follow && !this.isAdmin && this.adminPage ? this.adminPage : keep ? this.pageId : msg.adminPage
        this.pageId = target && this.pages.some((p) => p.id === target) ? target : (this.pages[0]?.id ?? null)
        // Reconnexion : on réapplique et renvoie ce qui n'a pas été confirmé.
        for (const [seq, ops] of [...this.pending].sort((a, b) => a[0] - b[0])) {
          this.applyLocal(ops)
          this.send({ t: 'ops', seq, ops })
        }
        this.docChanged()
        break
      }
      case 'ack':
        this.pending.delete(msg.seq)
        return
      case 'nack':
        this.pending.delete(msg.seq)
        this.applyLocal(msg.restore)
        this.toast(msg.reason)
        break
      case 'ops': {
        this.applyLocal(msg.ops)
        const last = [...msg.ops].reverse().find((op) => op.o === 'put')
        if (last?.o === 'put') {
          const b = elementBox(last.el, this.domSizes)
          this.noteActivity(msg.by, last.el.pageId, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 'write')
        }
        break
      }
      case 'live': {
        const key = `${msg.by}:${msg.id}`
        if (msg.end) {
          this.live.delete(key)
        } else {
          const cur = this.live.get(key)
          if (cur) {
            cur.pts.push(...msg.pts)
            cur.updatedAt = performance.now()
          } else {
            this.live.set(key, { ...msg, pts: [...msg.pts], updatedAt: performance.now() })
          }
          const n = msg.pts.length
          if (n >= 3) this.noteActivity(msg.by, msg.pageId, msg.pts[n - 3]!, msg.pts[n - 2]!, 'write')
        }
        this.requestRender('live')
        return
      }
      case 'laser': {
        const now = performance.now()
        const trail = this.lasers.get(msg.by)
        const pts = trail && trail.pageId === msg.pageId ? trail.pts.filter((p) => now - p.t < LASER_TRAIL_MS) : []
        // Répartit les points reçus sur l'intervalle d'envoi pour une traînée fluide.
        const n = msg.pts.length / 2
        for (let i = 0; i < n; i++) {
          pts.push({ x: msg.pts[i * 2]!, y: msg.pts[i * 2 + 1]!, t: now - 66 + (66 * (i + 1)) / n })
        }
        this.lasers.set(msg.by, { pageId: msg.pageId, pts })
        const len = msg.pts.length
        if (len >= 2) this.noteActivity(msg.by, msg.pageId, msg.pts[len - 2]!, msg.pts[len - 1]!, 'laser')
        this.requestRender('live')
        return
      }
      case 'pages':
        this.pages = msg.pages
        if (!this.pages.some((p) => p.id === this.pageId)) {
          this.pageId = this.adminPage && this.pages.some((p) => p.id === this.adminPage) ? this.adminPage : (this.pages[0]?.id ?? null)
        }
        // Les éléments des pages supprimées disparaissent.
        for (const [id, el] of this.elements) if (!this.pages.some((p) => p.id === el.pageId)) this.elements.delete(id)
        this.docChanged()
        break
      case 'participants':
        this.participants = msg.participants
        break
      case 'you': {
        const before = this.me?.canWrite
        this.me = msg.you
        if (before !== msg.you.canWrite && msg.you.role !== 'admin') {
          this.toast(msg.you.canWrite ? 'Le professeur vous a donné la main : vous pouvez écrire.' : 'Vous n’avez plus la main.')
          if (!msg.you.canWrite) this.selection.clear()
        }
        break
      }
      case 'settings':
        if (this.settings.frozen !== msg.settings.frozen && !this.isAdmin) {
          this.toast(msg.settings.frozen ? 'Le tableau est gelé par le professeur.' : 'Le tableau est dégelé.')
        }
        this.settings = msg.settings
        break
      case 'view':
        this.adminPage = msg.pageId
        if (this.follow && !this.isAdmin) this.setPage(msg.pageId, true)
        break
      case 'chat':
        this.chat = [...this.chat, msg.msg].slice(-200)
        if (!this.chatOpen && msg.msg.by !== this.me?.id) this.unreadChat++
        break
      case 'hand':
        this.toast(`✋ ${msg.name} lève la main`)
        break
      case 'bans':
        this.bans = msg.bans
        break
      case 'log':
        this.log = [...this.log, ...msg.entries].slice(-300)
        break
      case 'revertConflict':
        if (confirm(msg.message)) this.send({ t: 'revert', seq: msg.seq, force: true })
        break
      case 'invites':
        this.invites = msg.invites
        break
      case 'inviteCreated':
        this.lastInvite = { id: msg.id, token: msg.token }
        break
      case 'quota':
        this.quota = msg.level
        if (msg.level === 'exceeded') this.toast('Quota gratuit du jour atteint : le tableau passe en lecture seule.')
        break
      case 'error':
        if (FATAL_ERRORS.has(msg.code)) this.fatal = { code: msg.code, message: msg.message }
        else this.toast(msg.message)
        break
    }
    this.emit()
  }
}
