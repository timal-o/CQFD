import {
  canUseLaser,
  canWrite,
  checkDel,
  checkPut,
  CLOSE_CODES,
  dedupeName,
  LIMITS,
  randomId,
  sanitizeName,
  type Actor,
  type BoardElement,
  type ClientMessage,
  type ExistingElement,
  type Me,
  type Op,
  type Page,
  type PageAction,
  type ParticipantInfo,
  type Role,
  type RoomFlags,
  type RoomSettings,
  type ServerMessage,
} from '@cqfd/shared'

export type SqlValue = string | number | null

/** Sous-ensemble de l'API SQL du Durable Object (testable avec node:sqlite). */
export interface Sql {
  exec<T extends Record<string, SqlValue> = Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]): T[]
  transaction<T>(fn: () => T): T
}

/** Métadonnées d'une connexion, conservées à travers l'hibernation (serializeAttachment). */
export interface Attachment {
  ipHash: string
  pid?: string
  role?: Role
  canWrite?: boolean
}

export interface Conn {
  /** Identité de la socket sous-jacente. */
  readonly key: unknown
  readonly att: Attachment
  setAtt(att: Attachment): void
  send(data: string): void
  close(code: number, reason: string): void
}

const SCHEMA = [
  `CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID`,
  `CREATE TABLE pages (id TEXT PRIMARY KEY, name TEXT NOT NULL, ord REAL NOT NULL, bg TEXT NOT NULL) WITHOUT ROWID`,
  `CREATE TABLE elements (id TEXT PRIMARY KEY, page_id TEXT NOT NULL, author_id TEXT NOT NULL, data TEXT NOT NULL) WITHOUT ROWID`,
  `CREATE TABLE participants (id TEXT PRIMARY KEY, session_hash TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
     can_write INTEGER NOT NULL, kicked INTEGER NOT NULL DEFAULT 0, joined_at INTEGER NOT NULL) WITHOUT ROWID`,
  `CREATE TABLE bans (id TEXT PRIMARY KEY, ip_hash TEXT NOT NULL, session_hash TEXT NOT NULL, name TEXT NOT NULL,
     at INTEGER NOT NULL) WITHOUT ROWID`,
]

type ParticipantRow = {
  id: string
  session_hash: string
  name: string
  role: string
  can_write: number
  kicked: number
}

type BucketKind = 'ops' | 'live' | 'laser' | 'admin'
const BUCKETS: Record<BucketKind, { rate: number; burst: number }> = {
  ops: { rate: 20, burst: 60 },
  live: { rate: 30, burst: 60 },
  laser: { rate: 30, burst: 60 },
  admin: { rate: 5, burst: 30 },
}

export interface JoinRequest {
  name: string
  sessionHash: string
  isAdmin: boolean
}

/**
 * Logique d'une salle. Tout l'état durable est dans SQLite ; seuls des caches
 * dérivés (compteur d'éléments) et des compteurs éphémères (débit) sont en mémoire,
 * et ils se reconstruisent après hibernation.
 */
export class RoomCore {
  private elementCount: number | null = null
  private buckets = new Map<string, { tokens: number; at: number }>()

  constructor(
    private readonly sql: Sql,
    private readonly conns: () => Conn[],
    private readonly now: () => number = Date.now,
  ) {}

  // ---------------------------------------------------------------- cycle de vie

  isInitialized(): boolean {
    return this.sql.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'`).length > 0
  }

  /** Crée la salle. Renvoie false si le code est déjà utilisé. */
  init(adminHash: string, ipSalt: string, firstPageId: string = randomId()): boolean {
    if (this.isInitialized()) return false
    this.sql.transaction(() => {
      for (const statement of SCHEMA) this.sql.exec(statement)
      const meta: Record<string, string> = {
        admin_hash: adminHash,
        ip_salt: ipSalt,
        created_at: String(this.now()),
        frozen: '0',
        locked: '0',
        laser_students: '0',
        max_participants: String(LIMITS.maxParticipants),
        admin_page: firstPageId,
      }
      for (const [k, v] of Object.entries(meta)) this.sql.exec(`INSERT INTO meta (k, v) VALUES (?, ?)`, k, v)
      this.sql.exec(`INSERT INTO pages (id, name, ord, bg) VALUES (?, 'Page 1', 1, 'blank')`, firstPageId)
    })
    this.elementCount = 0
    return true
  }

  /** À appeler après un effacement complet du stockage. */
  reset(): void {
    this.elementCount = null
    this.buckets.clear()
  }

  adminHash(): string {
    return this.meta().admin_hash ?? ''
  }

  ipSalt(): string {
    return this.meta().ip_salt ?? ''
  }

  // ---------------------------------------------------------------- lecture d'état

  private meta(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const row of this.sql.exec<{ k: string; v: string }>(`SELECT k, v FROM meta`)) out[row.k] = row.v
    return out
  }

  private settingsFrom(meta: Record<string, string>): RoomSettings {
    return {
      frozen: meta.frozen === '1',
      locked: meta.locked === '1',
      laserForStudents: meta.laser_students === '1',
      maxParticipants: Number(meta.max_participants ?? LIMITS.maxParticipants),
    }
  }

  settings(): RoomSettings {
    return this.settingsFrom(this.meta())
  }

  private flags(): RoomFlags {
    const s = this.settings()
    return { frozen: s.frozen, laserForStudents: s.laserForStudents }
  }

  pages(): Page[] {
    return this.sql
      .exec<{ id: string; name: string; ord: number; bg: string }>(`SELECT id, name, ord, bg FROM pages ORDER BY ord, id`)
      .map((r) => ({ id: r.id, name: r.name, ord: r.ord, bg: r.bg as Page['bg'] }))
  }

  elements(): BoardElement[] {
    return this.sql.exec<{ data: string }>(`SELECT data FROM elements`).map((r) => JSON.parse(r.data) as BoardElement)
  }

  private element(id: string): BoardElement | null {
    const row = this.sql.exec<{ data: string }>(`SELECT data FROM elements WHERE id = ?`, id)[0]
    return row ? (JSON.parse(row.data) as BoardElement) : null
  }

  private existing(id: string): ExistingElement | null {
    const row = this.sql.exec<{ author_id: string; page_id: string }>(
      `SELECT author_id, page_id FROM elements WHERE id = ?`,
      id,
    )[0]
    return row ? { authorId: row.author_id, pageId: row.page_id } : null
  }

  private count(): number {
    if (this.elementCount === null) {
      this.elementCount = Number(this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM elements`)[0]?.n ?? 0)
    }
    return this.elementCount
  }

  private participantRows(): ParticipantRow[] {
    return this.sql.exec<ParticipantRow>(
      `SELECT id, session_hash, name, role, can_write, kicked FROM participants ORDER BY joined_at, name`,
    )
  }

  participants(): ParticipantInfo[] {
    const online = new Set(this.joined().map((c) => c.att.pid))
    return this.participantRows()
      .filter((r) => !r.kicked)
      .map((r) => ({
        id: r.id,
        name: r.name,
        role: r.role as Role,
        canWrite: r.can_write === 1,
        online: online.has(r.id),
      }))
  }

  // ---------------------------------------------------------------- connexions

  private joined(): Conn[] {
    return this.conns().filter((c) => c.att.pid)
  }

  private static actor(conn: Conn): Actor | null {
    const { pid, role, canWrite } = conn.att
    if (!pid || !role) return null
    return { id: pid, role, canWrite: canWrite ?? false }
  }

  private send(conn: Conn, msg: ServerMessage): void {
    conn.send(JSON.stringify(msg))
  }

  private broadcast(msg: ServerMessage, except?: Conn): void {
    const data = JSON.stringify(msg)
    for (const c of this.joined()) if (c.key !== except?.key) c.send(data)
  }

  private refuse(conn: Conn, code: keyof typeof CLOSE_CODES, error: ServerMessage & { t: 'error' }): void {
    this.send(conn, error)
    conn.close(CLOSE_CODES[code], error.code)
  }

  join(conn: Conn, req: JoinRequest): void {
    if (conn.att.pid) return
    const { ipHash } = conn.att
    if (!req.isAdmin) {
      const banned = this.sql.exec(
        `SELECT id FROM bans WHERE ip_hash = ? OR session_hash = ? LIMIT 1`,
        ipHash,
        req.sessionHash,
      )
      if (banned.length > 0) {
        return this.refuse(conn, 'banned', { t: 'error', code: 'banned', message: 'Vous avez été banni de cette salle.' })
      }
    }

    const rows = this.participantRows()
    const known = rows.find((r) => r.session_hash === req.sessionHash) ?? null
    if (known?.kicked && !req.isAdmin) {
      return this.refuse(conn, 'kicked', { t: 'error', code: 'kicked', message: 'Vous avez été exclu de cette salle.' })
    }

    const settings = this.settings()
    if (!req.isAdmin) {
      if (settings.locked && !known) {
        return this.refuse(conn, 'locked', {
          t: 'error',
          code: 'locked',
          message: 'La salle est verrouillée : le professeur n’accepte plus de nouvelles entrées.',
        })
      }
      const others = this.joined().filter((c) => c.att.role !== 'admin' && c.att.pid !== known?.id)
      if (others.length >= settings.maxParticipants) {
        return this.refuse(conn, 'full', { t: 'error', code: 'full', message: 'La salle est pleine.' })
      }
    }

    let me: Me
    if (known) {
      const role: Role = req.isAdmin ? 'admin' : (known.role as Role)
      if (role !== known.role || known.kicked) {
        this.sql.exec(`UPDATE participants SET role = ?, kicked = 0 WHERE id = ?`, role, known.id)
      }
      me = { id: known.id, name: known.name, role, canWrite: role === 'admin' || known.can_write === 1 }
    } else {
      const name = dedupeName(
        sanitizeName(req.name) || 'Anonyme',
        rows.map((r) => r.name),
      )
      const role: Role = req.isAdmin ? 'admin' : 'participant'
      me = { id: randomId(), name, role, canWrite: role === 'admin' }
      this.sql.exec(
        `INSERT INTO participants (id, session_hash, name, role, can_write, kicked, joined_at) VALUES (?, ?, ?, ?, ?, 0, ?)`,
        me.id,
        req.sessionHash,
        me.name,
        me.role,
        me.canWrite ? 1 : 0,
        this.now(),
      )
    }

    // Une même session ouverte dans un autre onglet : l'ancienne connexion cède la place.
    for (const c of this.joined()) {
      if (c.att.pid === me.id && c.key !== conn.key) {
        this.refuse(c, 'replaced', {
          t: 'error',
          code: 'replaced',
          message: 'Cette session a été ouverte dans un autre onglet.',
        })
      }
    }

    conn.setAtt({ ipHash, pid: me.id, role: me.role, canWrite: me.canWrite })
    const meta = this.meta()
    this.send(conn, {
      t: 'welcome',
      you: me,
      settings: this.settingsFrom(meta),
      pages: this.pages(),
      elements: this.elements(),
      participants: this.participants(),
      adminPage: meta.admin_page ?? null,
    })
    this.broadcast({ t: 'participants', participants: this.participants() }, conn)
  }

  onClose(conn: Conn): void {
    const pid = conn.att.pid
    if (!pid) return
    if (!this.joined().some((c) => c.att.pid === pid && c.key !== conn.key)) {
      for (const kind of Object.keys(BUCKETS)) this.buckets.delete(`${pid}:${kind}`)
    }
    this.broadcast({ t: 'participants', participants: this.participants() }, conn)
  }

  // ---------------------------------------------------------------- messages

  private take(pid: string, kind: BucketKind): boolean {
    const { rate, burst } = BUCKETS[kind]
    const key = `${pid}:${kind}`
    const t = this.now()
    const b = this.buckets.get(key) ?? { tokens: burst, at: t }
    b.tokens = Math.min(burst, b.tokens + ((t - b.at) / 1000) * rate)
    b.at = t
    const allowed = b.tokens >= 1
    if (allowed) b.tokens -= 1
    this.buckets.set(key, b)
    return allowed
  }

  handle(conn: Conn, msg: ClientMessage): void {
    const actor = RoomCore.actor(conn)
    if (!actor || msg.t === 'join') return

    switch (msg.t) {
      case 'ops':
        return this.handleOps(conn, actor, msg.seq, msg.ops)
      case 'live': {
        if (!this.take(actor.id, 'live') || !canWrite(actor, this.flags())) return
        const { t: _t, ...rest } = msg
        return this.broadcast({ t: 'live', by: actor.id, ...rest }, conn)
      }
      case 'laser': {
        if (!this.take(actor.id, 'laser') || !canUseLaser(actor, this.flags())) return
        return this.broadcast({ t: 'laser', by: actor.id, pageId: msg.pageId, pts: msg.pts }, conn)
      }
      default:
        break
    }

    // Messages réservés aux admins.
    if (actor.role !== 'admin') {
      return this.send(conn, { t: 'error', code: 'forbidden', message: 'Action réservée au professeur.' })
    }
    if (!this.take(actor.id, 'admin')) {
      return this.send(conn, { t: 'error', code: 'rate_limited', message: 'Trop d’actions, patientez un instant.' })
    }
    switch (msg.t) {
      case 'page':
        return this.handlePage(conn, actor, msg.action)
      case 'view':
        if (!this.pages().some((p) => p.id === msg.pageId)) return
        this.sql.exec(`INSERT OR REPLACE INTO meta (k, v) VALUES ('admin_page', ?)`, msg.pageId)
        return this.broadcast({ t: 'view', pageId: msg.pageId }, conn)
      case 'grant':
        return this.grant(msg.pid, msg.on)
      case 'settings':
        return this.updateSettings(msg)
    }
  }

  private restoreOps(ids: Iterable<string>): Op[] {
    const out: Op[] = []
    for (const id of new Set(ids)) {
      const el = this.element(id)
      out.push(el ? { o: 'put', el } : { o: 'del', id })
    }
    return out
  }

  private handleOps(conn: Conn, actor: Actor, seq: number, ops: Op[]): void {
    const ids = ops.map((op) => (op.o === 'put' ? op.el.id : op.id))
    const reject = (reason: string) => this.send(conn, { t: 'nack', seq, reason, restore: this.restoreOps(ids) })

    if (!this.take(actor.id, 'ops')) return reject('Trop de modifications, ralentissez un peu.')

    const flags = this.flags()
    const pageIds = new Set(this.pages().map((p) => p.id))
    const overlay = new Map<string, ExistingElement | null>()
    const lookup = (id: string) => (overlay.has(id) ? (overlay.get(id) ?? null) : this.existing(id))
    let delta = 0

    for (const op of ops) {
      if (op.o === 'put') {
        const { el } = op
        if (!pageIds.has(el.pageId)) return reject('Page inconnue')
        const ex = lookup(el.id)
        const check = checkPut(actor, flags, el, ex)
        if (!check.ok) return reject(check.reason)
        if (!ex) delta++
        overlay.set(el.id, { authorId: el.authorId, pageId: el.pageId })
      } else {
        const ex = lookup(op.id)
        const check = checkDel(actor, flags, ex)
        if (!check.ok) return reject(check.reason)
        if (ex) delta--
        overlay.set(op.id, null)
      }
    }
    if (this.count() + delta > LIMITS.maxElementsPerRoom) {
      return reject('La salle a atteint le nombre maximal d’éléments.')
    }

    this.sql.transaction(() => {
      for (const op of ops) {
        if (op.o === 'put') {
          this.sql.exec(
            `INSERT OR REPLACE INTO elements (id, page_id, author_id, data) VALUES (?, ?, ?, ?)`,
            op.el.id,
            op.el.pageId,
            op.el.authorId,
            JSON.stringify(op.el),
          )
        } else {
          this.sql.exec(`DELETE FROM elements WHERE id = ?`, op.id)
        }
      }
    })
    this.elementCount = this.count() + delta
    this.send(conn, { t: 'ack', seq })
    this.broadcast({ t: 'ops', by: actor.id, ops }, conn)
  }

  private handlePage(conn: Conn, actor: Actor, action: PageAction): void {
    const pages = this.pages()
    const fail = (message: string) => this.send(conn, { t: 'error', code: 'forbidden', message })
    const exists = (id: string) => pages.some((p) => p.id === id)

    switch (action.a) {
      case 'add':
        if (pages.length >= LIMITS.maxPages) return fail('Nombre maximal de pages atteint.')
        if (exists(action.id)) return
        this.sql.exec(`INSERT INTO pages (id, name, ord, bg) VALUES (?, ?, ?, 'blank')`, action.id, action.name, action.ord)
        break
      case 'rename':
        this.sql.exec(`UPDATE pages SET name = ? WHERE id = ?`, action.name, action.id)
        break
      case 'move':
        this.sql.exec(`UPDATE pages SET ord = ? WHERE id = ?`, action.ord, action.id)
        break
      case 'bg':
        this.sql.exec(`UPDATE pages SET bg = ? WHERE id = ?`, action.bg, action.id)
        break
      case 'del': {
        if (!exists(action.id)) return
        if (pages.length <= 1) return fail('Impossible de supprimer la dernière page.')
        this.sql.transaction(() => {
          this.sql.exec(`DELETE FROM elements WHERE page_id = ?`, action.id)
          this.sql.exec(`DELETE FROM pages WHERE id = ?`, action.id)
        })
        this.elementCount = null
        const meta = this.meta()
        if (meta.admin_page === action.id) {
          const fallback = pages.find((p) => p.id !== action.id)!.id
          this.sql.exec(`UPDATE meta SET v = ? WHERE k = 'admin_page'`, fallback)
          this.broadcast({ t: 'view', pageId: fallback })
        }
        break
      }
      case 'dup': {
        const source = pages.find((p) => p.id === action.id)
        if (!source || exists(action.newId)) return
        if (pages.length >= LIMITS.maxPages) return fail('Nombre maximal de pages atteint.')
        const copies = this.sql
          .exec<{ data: string }>(`SELECT data FROM elements WHERE page_id = ?`, action.id)
          .map((r) => ({ ...(JSON.parse(r.data) as BoardElement), id: randomId(), pageId: action.newId }))
        if (this.count() + copies.length > LIMITS.maxElementsPerRoom) {
          return fail('La salle a atteint le nombre maximal d’éléments.')
        }
        this.sql.transaction(() => {
          this.sql.exec(
            `INSERT INTO pages (id, name, ord, bg) VALUES (?, ?, ?, ?)`,
            action.newId,
            action.name,
            action.ord,
            source.bg,
          )
          for (const el of copies) {
            this.sql.exec(
              `INSERT INTO elements (id, page_id, author_id, data) VALUES (?, ?, ?, ?)`,
              el.id,
              el.pageId,
              el.authorId,
              JSON.stringify(el),
            )
          }
        })
        this.elementCount = this.count() + copies.length
        this.broadcast({ t: 'pages', pages: this.pages() })
        if (copies.length > 0) this.broadcast({ t: 'ops', by: actor.id, ops: copies.map((el) => ({ o: 'put', el })) })
        return
      }
    }
    this.broadcast({ t: 'pages', pages: this.pages() })
  }

  private grant(pid: string, on: boolean): void {
    const row = this.participantRows().find((r) => r.id === pid)
    if (!row || row.role === 'admin') return
    this.sql.exec(`UPDATE participants SET can_write = ? WHERE id = ?`, on ? 1 : 0, pid)
    for (const c of this.joined()) {
      if (c.att.pid !== pid) continue
      c.setAtt({ ...c.att, canWrite: on })
      this.send(c, { t: 'you', you: { id: pid, name: row.name, role: 'participant', canWrite: on } })
    }
    this.broadcast({ t: 'participants', participants: this.participants() })
  }

  private updateSettings(msg: ClientMessage & { t: 'settings' }): void {
    const updates: [string, string][] = []
    if (msg.frozen !== undefined) updates.push(['frozen', msg.frozen ? '1' : '0'])
    if (msg.locked !== undefined) updates.push(['locked', msg.locked ? '1' : '0'])
    if (msg.laserForStudents !== undefined) updates.push(['laser_students', msg.laserForStudents ? '1' : '0'])
    if (msg.maxParticipants !== undefined) updates.push(['max_participants', String(msg.maxParticipants)])
    if (updates.length === 0) return
    this.sql.transaction(() => {
      for (const [k, v] of updates) this.sql.exec(`INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)`, k, v)
    })
    this.broadcast({ t: 'settings', settings: this.settings() })
  }
}
