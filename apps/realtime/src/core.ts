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
  type BanInfo,
  type BoardElement,
  type ChatMessage,
  type ClientMessage,
  type ExistingElement,
  type InviteInfo,
  type LogEntry,
  type Me,
  type Op,
  type Page,
  type PageAction,
  type PageImage,
  type ParticipantInfo,
  type QuotaLevel,
  type Role,
  type RoomFlags,
  type RoomSettings,
  type ServerMessage,
} from '@cqfd/shared'
import { summarize, type Change } from './summary'

export type SqlValue = string | number | null | ArrayBuffer | Uint8Array

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

const SCHEMA_VERSION = 2

const SCHEMA = [
  `CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID`,
  `CREATE TABLE pages (id TEXT PRIMARY KEY, name TEXT NOT NULL, ord REAL NOT NULL, bg TEXT NOT NULL, image TEXT) WITHOUT ROWID`,
  `CREATE TABLE elements (id TEXT PRIMARY KEY, page_id TEXT NOT NULL, author_id TEXT NOT NULL, data TEXT NOT NULL) WITHOUT ROWID`,
  `CREATE TABLE participants (id TEXT PRIMARY KEY, session_hash TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
     can_write INTEGER NOT NULL, kicked INTEGER NOT NULL DEFAULT 0, joined_at INTEGER NOT NULL,
     hand_at INTEGER, ip_hash TEXT NOT NULL DEFAULT '', invite_id TEXT) WITHOUT ROWID`,
  `CREATE TABLE bans (id TEXT PRIMARY KEY, ip_hash TEXT NOT NULL, session_hash TEXT NOT NULL, name TEXT NOT NULL,
     at INTEGER NOT NULL) WITHOUT ROWID`,
  ...SCHEMA_V2_TABLES(),
]

function SCHEMA_V2_TABLES(): string[] {
  return [
    `CREATE TABLE chat (seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, author_id TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL)`,
    `CREATE TABLE log (seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, author_id TEXT NOT NULL, name TEXT NOT NULL,
       summary TEXT NOT NULL, detail TEXT)`,
    `CREATE TABLE invites (id TEXT PRIMARY KEY, hash TEXT NOT NULL, label TEXT NOT NULL, at INTEGER NOT NULL) WITHOUT ROWID`,
    `CREATE TABLE assets (id TEXT NOT NULL, idx INTEGER NOT NULL, page_id TEXT NOT NULL, mime TEXT NOT NULL,
       total INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (id, idx)) WITHOUT ROWID`,
  ]
}

/** Migration des salles créées avant l'ajout des tables de la phase 3. */
const MIGRATIONS_V2 = [
  `ALTER TABLE pages ADD COLUMN image TEXT`,
  `ALTER TABLE participants ADD COLUMN hand_at INTEGER`,
  `ALTER TABLE participants ADD COLUMN ip_hash TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE participants ADD COLUMN invite_id TEXT`,
  ...SCHEMA_V2_TABLES(),
]

type ParticipantRow = {
  id: string
  session_hash: string
  name: string
  role: string
  can_write: number
  kicked: number
  hand_at: number | null
  ip_hash: string
  invite_id: string | null
}

type BucketKind = 'ops' | 'live' | 'laser' | 'admin' | 'chat' | 'hand' | 'asset'
const BUCKETS: Record<BucketKind, { rate: number; burst: number }> = {
  ops: { rate: 20, burst: 60 },
  live: { rate: 30, burst: 60 },
  laser: { rate: 30, burst: 60 },
  admin: { rate: 5, burst: 30 },
  chat: { rate: 1, burst: 5 },
  hand: { rate: 0.5, burst: 4 },
  asset: { rate: 20, burst: 100 },
}

/** Messages entrants par salle et par jour (1 requête facturée = 20 messages). */
export const QUOTA_THRESHOLDS = { warn: 300_000, degraded: 500_000 }

/** Taille max du détail conservé dans une ligne du journal (une ligne SQLite fait au plus 2 Mo). */
const MAX_LOG_DETAIL = 1_500_000

export type AdminAccess = { kind: 'owner' } | { kind: 'invite'; id: string } | null

export interface JoinRequest {
  name: string
  sessionHash: string
  admin: AdminAccess
}

const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g

const IMAGE_SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v),
  'image/webp': (b) =>
    String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP',
}

function hasImageSignature(bytes: Uint8Array, mime: string): boolean {
  return IMAGE_SIGNATURES[mime]?.(bytes) ?? false
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Logique d'une salle. Tout l'état durable est dans SQLite ; seuls des caches
 * dérivés (compteur d'éléments) et des compteurs éphémères (débit, quota) sont
 * en mémoire, et ils se reconstruisent après hibernation.
 */
export class RoomCore {
  private elementCount: number | null = null
  /**
   * Copies en mémoire des réglages et des pages : relues à chaque message sinon
   * (≈ 11 lignes lues par trait en direct), ce qui épuisait le quota de lignes lues.
   * SQLite reste la source de vérité ; toute écriture invalide la copie.
   */
  private metaCache: Record<string, string> | null = null
  private pagesCache: Page[] | null = null
  private buckets = new Map<string, { tokens: number; at: number }>()
  private migrated = false
  private incoming = { day: '', count: 0 }
  private quotaLevel: QuotaLevel = 'ok'
  private inserts = { chat: 0, log: 0 }

  constructor(
    private readonly sql: Sql,
    private readonly conns: () => Conn[],
    private readonly now: () => number = Date.now,
  ) {}

  // ---------------------------------------------------------------- cycle de vie

  isInitialized(): boolean {
    const exists = this.sql.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'`).length > 0
    if (exists && !this.migrated) this.migrate()
    return exists
  }

  private migrate(): void {
    this.migrated = true
    const version = Number(this.sql.exec<{ v: string }>(`SELECT v FROM meta WHERE k = 'schema'`)[0]?.v ?? 1)
    if (version >= SCHEMA_VERSION) return
    this.invalidate()
    this.sql.transaction(() => {
      for (const statement of MIGRATIONS_V2) this.sql.exec(statement)
      this.sql.exec(`INSERT OR REPLACE INTO meta (k, v) VALUES ('schema', ?)`, String(SCHEMA_VERSION))
    })
  }

  /** Crée la salle. Renvoie false si le code est déjà utilisé. */
  init(adminHash: string, ipSalt: string, firstPageId: string = randomId()): boolean {
    if (this.isInitialized()) return false
    this.sql.transaction(() => {
      for (const statement of SCHEMA) this.sql.exec(statement)
      const meta: Record<string, string> = {
        schema: String(SCHEMA_VERSION),
        admin_hash: adminHash,
        ip_salt: ipSalt,
        created_at: String(this.now()),
        frozen: '0',
        locked: '0',
        laser_students: '0',
        chat_enabled: '1',
        max_participants: String(LIMITS.maxParticipants),
        admin_page: firstPageId,
        asset_bytes: '0',
      }
      for (const [k, v] of Object.entries(meta)) this.sql.exec(`INSERT INTO meta (k, v) VALUES (?, ?)`, k, v)
      this.sql.exec(`INSERT INTO pages (id, name, ord, bg) VALUES (?, 'Page 1', 1, 'blank')`, firstPageId)
    })
    this.migrated = true
    this.invalidate()
    this.elementCount = 0
    return true
  }

  /** À appeler après un effacement complet du stockage. */
  reset(): void {
    this.elementCount = null
    this.invalidate()
    this.migrated = false
    this.buckets.clear()
  }

  ipSalt(): string {
    return this.meta().ip_salt ?? ''
  }

  /** Accès admin correspondant au hash d'un jeton (propriétaire ou invitation co-admin). */
  adminAccess(tokenHash: string, equal: (a: string, b: string) => boolean): AdminAccess {
    if (equal(tokenHash, this.meta().admin_hash ?? '')) return { kind: 'owner' }
    for (const inv of this.sql.exec<{ id: string; hash: string }>(`SELECT id, hash FROM invites`)) {
      if (equal(tokenHash, inv.hash)) return { kind: 'invite', id: inv.id }
    }
    return null
  }

  // ---------------------------------------------------------------- quota

  /** Compte un message entrant et ajuste le niveau de quota (alerte, mode dégradé). */
  noteIncoming(): void {
    const day = new Date(this.now()).toISOString().slice(0, 10)
    if (this.incoming.day !== day) this.incoming = { day, count: 0 }
    this.incoming.count++
    if (this.quotaLevel === 'exceeded') return
    const level: QuotaLevel =
      this.incoming.count >= QUOTA_THRESHOLDS.degraded ? 'degraded' : this.incoming.count >= QUOTA_THRESHOLDS.warn ? 'warn' : 'ok'
    if (level !== this.quotaLevel) this.setQuota(level)
  }

  private setQuota(level: QuotaLevel): void {
    this.quotaLevel = level
    this.broadcast({ t: 'quota', level })
  }

  /** Une écriture SQLite a échoué (quota journalier atteint) : la salle passe en lecture seule. */
  private storageFailed(): void {
    if (this.quotaLevel !== 'exceeded') this.setQuota('exceeded')
  }

  // ---------------------------------------------------------------- lecture d'état

  private invalidate(): void {
    this.metaCache = null
    this.pagesCache = null
  }

  private meta(): Record<string, string> {
    if (this.metaCache) return this.metaCache
    const out: Record<string, string> = {}
    for (const row of this.sql.exec<{ k: string; v: string }>(`SELECT k, v FROM meta`)) out[row.k] = row.v
    this.metaCache = out
    return out
  }

  private setMeta(k: string, v: string): void {
    this.metaCache = null
    this.sql.exec(`INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)`, k, v)
  }

  private settingsFrom(meta: Record<string, string>): RoomSettings {
    return {
      frozen: meta.frozen === '1',
      locked: meta.locked === '1',
      laserForStudents: meta.laser_students === '1',
      chatEnabled: meta.chat_enabled !== '0',
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
    if (this.pagesCache) return this.pagesCache
    this.pagesCache = this.sql
      .exec<{ id: string; name: string; ord: number; bg: string; image: string | null }>(
        `SELECT id, name, ord, bg, image FROM pages ORDER BY ord, id`,
      )
      .map((r) => ({
        id: r.id,
        name: r.name,
        ord: r.ord,
        bg: r.bg as Page['bg'],
        image: r.image ? (JSON.parse(r.image) as PageImage) : null,
      }))
    return this.pagesCache
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
      `SELECT id, session_hash, name, role, can_write, kicked, hand_at, ip_hash, invite_id FROM participants ORDER BY joined_at, name`,
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
        handAt: r.hand_at ?? null,
      }))
  }

  chat(limit = 100): ChatMessage[] {
    return this.sql
      .exec<{ seq: number; at: number; author_id: string; name: string; text: string }>(
        `SELECT seq, at, author_id, name, text FROM chat ORDER BY seq DESC LIMIT ?`,
        limit,
      )
      .reverse()
      .map((r) => ({ seq: r.seq, at: r.at, by: r.author_id, name: r.name, text: r.text }))
  }

  bans(): BanInfo[] {
    return this.sql.exec<BanInfo & Record<string, SqlValue>>(`SELECT id, name, at FROM bans ORDER BY at`)
  }

  log(limit = 100): LogEntry[] {
    return this.sql
      .exec<{ seq: number; at: number; author_id: string; name: string; summary: string; has_detail: number }>(
        `SELECT seq, at, author_id, name, summary, detail IS NOT NULL AS has_detail FROM log ORDER BY seq DESC LIMIT ?`,
        limit,
      )
      .reverse()
      .map((r) => ({ seq: r.seq, at: r.at, by: r.author_id, name: r.name, summary: r.summary, revertable: r.has_detail === 1 }))
  }

  invites(): InviteInfo[] {
    return this.sql.exec<InviteInfo & Record<string, SqlValue>>(`SELECT id, label, at FROM invites ORDER BY at`)
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

  private toAdmins(msg: ServerMessage): void {
    const data = JSON.stringify(msg)
    for (const c of this.joined()) if (c.att.role === 'admin') c.send(data)
  }

  private broadcastParticipants(except?: Conn): void {
    this.broadcast({ t: 'participants', participants: this.participants() }, except)
  }

  private refuse(conn: Conn, code: keyof typeof CLOSE_CODES, error: ServerMessage & { t: 'error' }): void {
    this.send(conn, error)
    conn.close(CLOSE_CODES[code], error.code)
  }

  private nameOf(pid: string): string {
    return this.sql.exec<{ name: string }>(`SELECT name FROM participants WHERE id = ?`, pid)[0]?.name ?? '?'
  }

  join(conn: Conn, req: JoinRequest): void {
    if (conn.att.pid) return
    const { ipHash } = conn.att
    const isAdmin = req.admin !== null
    if (!isAdmin) {
      const banned = this.sql.exec(
        `SELECT id FROM bans WHERE (ip_hash = ? AND ip_hash != '') OR session_hash = ? LIMIT 1`,
        ipHash,
        req.sessionHash,
      )
      if (banned.length > 0) {
        return this.refuse(conn, 'banned', { t: 'error', code: 'banned', message: 'Vous avez été banni de cette salle.' })
      }
    }

    const rows = this.participantRows()
    const known = rows.find((r) => r.session_hash === req.sessionHash) ?? null
    if (known?.kicked && !isAdmin) {
      return this.refuse(conn, 'kicked', { t: 'error', code: 'kicked', message: 'Vous avez été exclu de cette salle.' })
    }

    const settings = this.settings()
    if (!isAdmin) {
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

    const inviteId = req.admin?.kind === 'invite' ? req.admin.id : null
    let me: Me
    if (known) {
      const role: Role = isAdmin ? 'admin' : (known.role as Role)
      if (role !== known.role || known.kicked || known.ip_hash !== ipHash || (isAdmin && known.invite_id !== inviteId)) {
        this.sql.exec(
          `UPDATE participants SET role = ?, kicked = 0, ip_hash = ?, invite_id = ? WHERE id = ?`,
          role,
          ipHash,
          isAdmin ? inviteId : known.invite_id,
          known.id,
        )
      }
      me = { id: known.id, name: known.name, role, canWrite: role === 'admin' || known.can_write === 1 }
    } else {
      const name = dedupeName(
        sanitizeName(req.name) || 'Anonyme',
        rows.map((r) => r.name),
      )
      const role: Role = isAdmin ? 'admin' : 'participant'
      me = { id: randomId(), name, role, canWrite: role === 'admin' }
      this.sql.exec(
        `INSERT INTO participants (id, session_hash, name, role, can_write, kicked, joined_at, ip_hash, invite_id)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        me.id,
        req.sessionHash,
        me.name,
        me.role,
        me.canWrite ? 1 : 0,
        this.now(),
        ipHash,
        inviteId,
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
      chat: this.chat(),
      quota: this.quotaLevel,
      admin: me.role === 'admin' ? { bans: this.bans(), log: this.log(), invites: this.invites() } : undefined,
    })
    this.broadcastParticipants(conn)
  }

  onClose(conn: Conn): void {
    const pid = conn.att.pid
    if (!pid) return
    if (!this.joined().some((c) => c.att.pid === pid && c.key !== conn.key)) {
      for (const kind of Object.keys(BUCKETS)) this.buckets.delete(`${pid}:${kind}`)
    }
    this.broadcastParticipants(conn)
  }

  // ---------------------------------------------------------------- messages

  private take(pid: string, kind: BucketKind): boolean {
    let { rate, burst } = BUCKETS[kind]
    // Mode dégradé : le tracé en direct est ralenti.
    if (kind === 'live' && this.quotaLevel !== 'ok' && this.quotaLevel !== 'warn') rate = 8
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
    const forbidden = () => this.send(conn, { t: 'error', code: 'forbidden', message: 'Action réservée au professeur.' })

    switch (msg.t) {
      case 'ops':
        return this.handleOps(conn, actor, msg.seq, msg.ops)
      case 'live': {
        if (!this.take(actor.id, 'live') || !canWrite(actor, this.flags())) return
        const { t: _t, ...rest } = msg
        return this.broadcast({ t: 'live', by: actor.id, ...rest }, conn)
      }
      case 'laser': {
        if (this.quotaLevel === 'degraded' || this.quotaLevel === 'exceeded') return
        if (!this.take(actor.id, 'laser') || !canUseLaser(actor, this.flags())) return
        return this.broadcast({ t: 'laser', by: actor.id, pageId: msg.pageId, pts: msg.pts }, conn)
      }
      case 'chat':
        return this.handleChat(conn, actor, msg.text)
      case 'hand':
        if (msg.pid && msg.pid !== actor.id) {
          if (actor.role !== 'admin') return forbidden()
          return this.setHand(msg.pid, false)
        }
        if (actor.role === 'admin' || !this.take(actor.id, 'hand')) return
        return this.setHand(actor.id, msg.up)
      default:
        break
    }

    // Messages réservés aux admins.
    if (actor.role !== 'admin') return forbidden()
    if (msg.t === 'asset') return this.handleAsset(conn, msg)
    if (!this.take(actor.id, 'admin')) {
      return this.send(conn, { t: 'error', code: 'rate_limited', message: 'Trop d’actions, patientez un instant.' })
    }
    switch (msg.t) {
      case 'page':
        return this.handlePage(conn, actor, msg.action)
      case 'view':
        if (!this.pages().some((p) => p.id === msg.pageId)) return
        this.setMeta('admin_page', msg.pageId)
        return this.broadcast({ t: 'view', pageId: msg.pageId }, conn)
      case 'grant':
        return this.grant(msg.pid, msg.on)
      case 'settings':
        return this.updateSettings(msg)
      case 'kick':
        return this.kick(conn, msg.pid, false)
      case 'ban':
        return this.kick(conn, msg.pid, true)
      case 'unban':
        return this.unban(msg.id)
      case 'revert':
        return this.revert(conn, actor, msg.seq, msg.force ?? false)
      case 'revokeInvite':
        return this.revokeInvite(msg.id)
      default:
        return
    }
  }

  // ---------------------------------------------------------------- éléments

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

    if (this.quotaLevel === 'exceeded') return reject('Quota gratuit du jour atteint : le tableau est en lecture seule.')
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

    if (!this.applyBatch(actor, ops, { except: conn })) return reject('Enregistrement impossible (quota du jour atteint).')
    this.send(conn, { t: 'ack', seq })
  }

  /**
   * Écrit un lot validé, l'inscrit au journal et le diffuse.
   * Renvoie false si l'écriture a échoué (quota SQLite du jour).
   */
  private applyBatch(actor: Actor, ops: Op[], opts: { except?: Conn; summary?: string }): boolean {
    // État avant le lot, pour le journal (une seule fois par élément).
    const before = new Map<string, BoardElement | null>()
    const after = new Map<string, BoardElement | null>()
    for (const op of ops) {
      const id = op.o === 'put' ? op.el.id : op.id
      if (!before.has(id)) before.set(id, this.element(id))
      after.set(id, op.o === 'put' ? op.el : null)
    }
    const changes: (Change & { id: string })[] = [...after].map(([id, a]) => ({ id, before: before.get(id) ?? null, after: a }))
    const summary = opts.summary ?? summarize(changes)
    let detail: string | null = JSON.stringify(changes)
    if (detail.length > MAX_LOG_DETAIL) detail = null

    let entrySeq = 0
    try {
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
        const row = this.sql.exec<{ seq: number }>(
          `INSERT INTO log (at, author_id, name, summary, detail) VALUES (?, ?, ?, ?, ?) RETURNING seq`,
          this.now(),
          actor.id,
          this.nameOf(actor.id),
          summary,
          detail,
        )[0]
        entrySeq = row?.seq ?? 0
      })
    } catch {
      this.storageFailed()
      return false
    }
    this.elementCount = null
    this.pruneLog()
    this.broadcast({ t: 'ops', by: actor.id, ops }, opts.except)
    this.toAdmins({
      t: 'log',
      entries: [{ seq: entrySeq, at: this.now(), by: actor.id, name: this.nameOf(actor.id), summary, revertable: detail !== null }],
    })
    return true
  }

  private pruneLog(): void {
    if (++this.inserts.log % 50 !== 0) return
    this.sql.exec(`DELETE FROM log WHERE seq <= (SELECT MAX(seq) FROM log) - ?`, LIMITS.logHistory)
  }

  /** Annulation par l'admin d'une action du journal : rétablit l'état des éléments concernés. */
  private revert(conn: Conn, actor: Actor, seq: number, force: boolean): void {
    const row = this.sql.exec<{ name: string; summary: string; detail: string | null }>(
      `SELECT name, summary, detail FROM log WHERE seq = ?`,
      seq,
    )[0]
    if (!row?.detail) {
      return this.send(conn, { t: 'error', code: 'forbidden', message: 'Cette action ne peut plus être annulée.' })
    }
    const changes = JSON.parse(row.detail) as (Change & { id: string })[]
    const conflicts = changes.filter((c) => JSON.stringify(this.element(c.id)) !== JSON.stringify(c.after))
    if (conflicts.length > 0 && !force) {
      return this.send(conn, {
        t: 'revertConflict',
        seq,
        message:
          conflicts.length === 1
            ? 'Un élément a été modifié depuis par quelqu’un d’autre. Écraser cette modification ?'
            : `${conflicts.length} éléments ont été modifiés depuis par quelqu’un d’autre. Écraser ces modifications ?`,
      })
    }
    const pageIds = new Set(this.pages().map((p) => p.id))
    const ops: Op[] = changes.flatMap((c): Op[] => {
      if (c.before) return pageIds.has(c.before.pageId) ? [{ o: 'put', el: c.before }] : []
      return [{ o: 'del', id: c.id }]
    })
    if (ops.length === 0) return
    this.applyBatch(actor, ops, { summary: `a annulé « ${row.summary} » (${row.name})` })
  }

  // ---------------------------------------------------------------- pages

  private handlePage(conn: Conn, actor: Actor, action: PageAction): void {
    const pages = this.pages()
    // Toute action de page modifie la table : la copie en mémoire sera relue.
    this.pagesCache = null
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
        const page = pages.find((p) => p.id === action.id)
        if (!page) return
        if (pages.length <= 1) return fail('Impossible de supprimer la dernière page.')
        this.sql.transaction(() => {
          this.sql.exec(`DELETE FROM elements WHERE page_id = ?`, action.id)
          this.sql.exec(`DELETE FROM pages WHERE id = ?`, action.id)
          if (page.image && !pages.some((p) => p.id !== page.id && p.image?.id === page.image?.id)) this.deleteAsset(page.image.id)
        })
        this.elementCount = null
        const meta = this.meta()
        if (meta.admin_page === action.id) {
          const fallback = pages.find((p) => p.id !== action.id)!.id
          this.setMeta('admin_page', fallback)
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
            `INSERT INTO pages (id, name, ord, bg, image) VALUES (?, ?, ?, ?, ?)`,
            action.newId,
            action.name,
            action.ord,
            source.bg,
            source.image ? JSON.stringify(source.image) : null,
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
        this.elementCount = null
        this.pagesCache = null
    this.broadcast({ t: 'pages', pages: this.pages() })
        if (copies.length > 0) this.broadcast({ t: 'ops', by: actor.id, ops: copies.map((el) => ({ o: 'put', el })) })
        return
      }
    }
    this.pagesCache = null
    this.broadcast({ t: 'pages', pages: this.pages() })
  }

  // ---------------------------------------------------------------- images de fond

  private handleAsset(conn: Conn, msg: ClientMessage & { t: 'asset' }): void {
    const fail = (message: string) => this.send(conn, { t: 'error', code: 'forbidden', message })
    if (!this.take(conn.att.pid!, 'asset')) return fail('Envoi trop rapide, réessayez.')
    if (!this.pages().some((p) => p.id === msg.pageId)) return fail('Page inconnue.')
    if (msg.idx >= msg.total) return fail('Morceau invalide.')
    let bytes: Uint8Array
    try {
      bytes = base64ToBytes(msg.data)
    } catch {
      return fail('Image invalide.')
    }
    // Le premier morceau doit commencer par la signature du format annoncé (pas de HTML déguisé).
    if (msg.idx === 0 && !hasImageSignature(bytes, msg.mime)) return fail('Image invalide.')
    const meta = this.meta()
    const roomBytes = Number(meta.asset_bytes ?? 0)
    const assetBytes = Number(
      this.sql.exec<{ n: number | null }>(`SELECT SUM(length(data)) AS n FROM assets WHERE id = ?`, msg.id)[0]?.n ?? 0,
    )
    if (assetBytes + bytes.length > LIMITS.maxAssetBytes) return fail('Image trop lourde.')
    if (roomBytes + bytes.length > LIMITS.maxAssetBytesPerRoom) {
      return fail('Plafond de stockage des fonds atteint pour cette salle (50 Mo).')
    }
    try {
      this.sql.transaction(() => {
        this.sql.exec(
          `INSERT OR REPLACE INTO assets (id, idx, page_id, mime, total, data) VALUES (?, ?, ?, ?, ?, ?)`,
          msg.id,
          msg.idx,
          msg.pageId,
          msg.mime,
          msg.total,
          bytes,
        )
        this.setMeta('asset_bytes', String(roomBytes + bytes.length))
      })
    } catch {
      this.storageFailed()
      return fail('Enregistrement impossible (quota du jour atteint).')
    }
    const received = Number(this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM assets WHERE id = ?`, msg.id)[0]?.n ?? 0)
    if (received < msg.total) return

    // Image complète : elle devient le fond de la page (l'ancienne est supprimée).
    const page = this.pages().find((p) => p.id === msg.pageId)
    const image: PageImage = { id: msg.id, w: msg.w, h: msg.h }
    this.sql.transaction(() => {
      if (page?.image && page.image.id !== msg.id) this.deleteAsset(page.image.id)
      this.sql.exec(`UPDATE pages SET image = ? WHERE id = ?`, JSON.stringify(image), msg.pageId)
    })
    this.pagesCache = null
    this.pagesCache = null
    this.broadcast({ t: 'pages', pages: this.pages() })
  }

  private deleteAsset(id: string): void {
    const n = Number(this.sql.exec<{ n: number | null }>(`SELECT SUM(length(data)) AS n FROM assets WHERE id = ?`, id)[0]?.n ?? 0)
    this.sql.exec(`DELETE FROM assets WHERE id = ?`, id)
    this.setMeta('asset_bytes', String(Math.max(0, Number(this.meta().asset_bytes ?? 0) - n)))
  }

  /** Contenu d'une image de fond (morceaux concaténés), ou null si absente ou incomplète. */
  readAsset(id: string): { mime: string; bytes: Uint8Array } | null {
    const rows = this.sql.exec<{ mime: string; total: number; data: ArrayBuffer | Uint8Array }>(
      `SELECT mime, total, data FROM assets WHERE id = ? ORDER BY idx`,
      id,
    )
    if (rows.length === 0 || rows.length !== rows[0]!.total) return null
    const size = rows.reduce((n, r) => n + r.data.byteLength, 0)
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const r of rows) {
      bytes.set(new Uint8Array(r.data), offset)
      offset += r.data.byteLength
    }
    return { mime: rows[0]!.mime, bytes }
  }

  // ---------------------------------------------------------------- participants

  private setHand(pid: string, up: boolean): void {
    const row = this.participantRows().find((r) => r.id === pid)
    if (!row || row.role === 'admin' || row.kicked) return
    if (up === (row.hand_at !== null)) return
    this.sql.exec(`UPDATE participants SET hand_at = ? WHERE id = ?`, up ? this.now() : null, pid)
    this.broadcastParticipants()
    if (up) this.toAdmins({ t: 'hand', name: row.name })
  }

  private grant(pid: string, on: boolean): void {
    const row = this.participantRows().find((r) => r.id === pid)
    if (!row || row.role === 'admin') return
    // Donner la main baisse la main levée.
    this.sql.exec(`UPDATE participants SET can_write = ?, hand_at = CASE WHEN ? THEN NULL ELSE hand_at END WHERE id = ?`, on ? 1 : 0, on ? 1 : 0, pid)
    for (const c of this.joined()) {
      if (c.att.pid !== pid) continue
      c.setAtt({ ...c.att, canWrite: on })
      this.send(c, { t: 'you', you: { id: pid, name: row.name, role: 'participant', canWrite: on } })
    }
    this.broadcastParticipants()
  }

  /** Exclusion (et bannissement si `ban`) : déconnexion immédiate, pas de retour avec le même jeton ni, si banni, la même IP. */
  private kick(conn: Conn, pid: string, ban: boolean): void {
    const row = this.participantRows().find((r) => r.id === pid)
    if (!row) return
    if (row.role === 'admin') {
      return this.send(conn, { t: 'error', code: 'forbidden', message: 'Impossible d’exclure un professeur.' })
    }
    this.sql.transaction(() => {
      this.sql.exec(`UPDATE participants SET kicked = 1, can_write = 0, hand_at = NULL WHERE id = ?`, pid)
      if (ban) {
        this.sql.exec(
          `INSERT INTO bans (id, ip_hash, session_hash, name, at) VALUES (?, ?, ?, ?, ?)`,
          randomId(),
          row.ip_hash,
          row.session_hash,
          row.name,
          this.now(),
        )
      }
    })
    for (const c of this.joined()) {
      if (c.att.pid !== pid) continue
      if (ban) this.refuse(c, 'banned', { t: 'error', code: 'banned', message: 'Vous avez été banni de cette salle.' })
      else this.refuse(c, 'kicked', { t: 'error', code: 'kicked', message: 'Vous avez été exclu de cette salle.' })
    }
    this.broadcastParticipants()
    if (ban) this.toAdmins({ t: 'bans', bans: this.bans() })
  }

  private unban(id: string): void {
    const ban = this.sql.exec<{ session_hash: string }>(`SELECT session_hash FROM bans WHERE id = ?`, id)[0]
    if (!ban) return
    this.sql.transaction(() => {
      this.sql.exec(`DELETE FROM bans WHERE id = ?`, id)
      this.sql.exec(`UPDATE participants SET kicked = 0 WHERE session_hash = ?`, ban.session_hash)
    })
    this.toAdmins({ t: 'bans', bans: this.bans() })
    this.broadcastParticipants()
  }

  // ---------------------------------------------------------------- co-admins

  /** Crée une invitation co-admin ; le jeton n'est envoyé qu'au créateur (seul son hash est stocké). */
  createInvite(conn: Conn, id: string, tokenHash: string, token: string, label: string): void {
    if (conn.att.role !== 'admin') return
    if (this.invites().length >= LIMITS.maxInvites) {
      return this.send(conn, { t: 'error', code: 'forbidden', message: 'Nombre maximal de liens co-admin atteint.' })
    }
    const clean = label.replace(CONTROL_CHARS, '').trim().slice(0, 40) || 'Co-admin'
    this.sql.exec(`INSERT INTO invites (id, hash, label, at) VALUES (?, ?, ?, ?)`, id, tokenHash, clean, this.now())
    this.send(conn, { t: 'inviteCreated', id, token })
    this.toAdmins({ t: 'invites', invites: this.invites() })
  }

  private revokeInvite(id: string): void {
    const demoted = this.participantRows().filter((r) => r.invite_id === id && r.role === 'admin')
    this.sql.transaction(() => {
      this.sql.exec(`DELETE FROM invites WHERE id = ?`, id)
      this.sql.exec(`UPDATE participants SET role = 'participant', can_write = 0, invite_id = NULL WHERE invite_id = ?`, id)
    })
    for (const row of demoted) {
      for (const c of this.joined()) {
        if (c.att.pid !== row.id) continue
        c.setAtt({ ...c.att, role: 'participant', canWrite: false })
        this.send(c, { t: 'you', you: { id: row.id, name: row.name, role: 'participant', canWrite: false } })
      }
    }
    this.toAdmins({ t: 'invites', invites: this.invites() })
    this.broadcastParticipants()
  }

  // ---------------------------------------------------------------- chat et réglages

  private handleChat(conn: Conn, actor: Actor, raw: string): void {
    if (actor.role !== 'admin' && !this.settings().chatEnabled) {
      return this.send(conn, { t: 'error', code: 'forbidden', message: 'Le chat est désactivé par le professeur.' })
    }
    if (!this.take(actor.id, 'chat')) {
      return this.send(conn, { t: 'error', code: 'rate_limited', message: 'Un message par seconde au maximum.' })
    }
    const text = raw.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.maxChatChars)
    if (!text) return
    const name = this.nameOf(actor.id)
    const at = this.now()
    let seq: number
    try {
      seq =
        this.sql.exec<{ seq: number }>(
          `INSERT INTO chat (at, author_id, name, text) VALUES (?, ?, ?, ?) RETURNING seq`,
          at,
          actor.id,
          name,
          text,
        )[0]?.seq ?? 0
    } catch {
      this.storageFailed()
      return
    }
    if (++this.inserts.chat % 20 === 0) {
      this.sql.exec(`DELETE FROM chat WHERE seq <= (SELECT MAX(seq) FROM chat) - ?`, LIMITS.chatHistory)
    }
    this.broadcast({ t: 'chat', msg: { seq, at, by: actor.id, name, text } })
  }

  private updateSettings(msg: ClientMessage & { t: 'settings' }): void {
    const updates: [string, string][] = []
    if (msg.frozen !== undefined) updates.push(['frozen', msg.frozen ? '1' : '0'])
    if (msg.locked !== undefined) updates.push(['locked', msg.locked ? '1' : '0'])
    if (msg.laserForStudents !== undefined) updates.push(['laser_students', msg.laserForStudents ? '1' : '0'])
    if (msg.chatEnabled !== undefined) updates.push(['chat_enabled', msg.chatEnabled ? '1' : '0'])
    if (msg.maxParticipants !== undefined) updates.push(['max_participants', String(msg.maxParticipants)])
    if (updates.length === 0) return
    this.sql.transaction(() => {
      for (const [k, v] of updates) this.setMeta(k, v)
    })
    this.broadcast({ t: 'settings', settings: this.settings() })
  }
}
