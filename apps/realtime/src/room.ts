import { DurableObject } from 'cloudflare:workers'
import {
  CLOSE_CODES,
  HEARTBEAT_REQUEST,
  HEARTBEAT_RESPONSE,
  parseClientMessage,
  randomId,
  randomToken,
  type ServerMessage,
} from '@cqfd/shared'
import { RoomCore, type Attachment, type Conn, type SqlValue } from './core'
import { sha256, timingSafeEqual } from './hash'

function wrap(ws: WebSocket): Conn {
  return {
    key: ws,
    get att() {
      return (ws.deserializeAttachment() as Attachment | null) ?? { ipHash: '' }
    },
    setAtt: (att) => ws.serializeAttachment(att),
    send: (data) => {
      try {
        ws.send(data)
      } catch {
        // socket déjà fermée
      }
    },
    close: (code, reason) => {
      try {
        ws.close(code, reason)
      } catch {
        // déjà fermée
      }
    },
  }
}

/** Une salle = un Durable Object SQLite. Aucun état de salle n'est gardé en mémoire. */
export class Room extends DurableObject<Env> {
  private readonly core: RoomCore

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Le heartbeat client est traité par le runtime sans réveiller l'objet.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT_REQUEST, HEARTBEAT_RESPONSE))
    const sql = ctx.storage.sql
    this.core = new RoomCore(
      {
        exec: <T extends Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]) =>
          sql
            .exec(
              query,
              // Le runtime attend des ArrayBuffer pour les BLOB.
              ...bindings.map((b) => (b instanceof Uint8Array ? b.slice().buffer : b)),
            )
            .toArray() as unknown as T[],
        transaction: (fn) => ctx.storage.transactionSync(fn),
      },
      () => this.openConns(),
    )
  }

  private graceMs(): number {
    const minutes = Number(this.env.ROOM_GRACE_MINUTES)
    return (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60_000
  }

  private openConns(): Conn[] {
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws.readyState === WebSocket.OPEN)
      .map(wrap)
  }

  /** RPC appelé par le Worker. Renvoie false si le code est déjà pris. */
  async create(adminHash: string): Promise<boolean> {
    const created = this.core.init(adminHash, randomToken(16))
    if (created) await this.ctx.storage.setAlarm(Date.now() + this.graceMs())
    return created
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const asset = url.pathname.match(/^\/asset\/([A-Za-z0-9_-]{1,40})$/)
    if (asset) {
      if (!this.core.isInitialized()) return new Response('Introuvable', { status: 404 })
      const found = this.core.readAsset(asset[1]!)
      if (!found) return new Response('Introuvable', { status: 404 })
      return new Response(found.bytes, {
        headers: {
          'content-type': found.mime,
          // L'identifiant est aléatoire et le contenu ne change jamais.
          'cache-control': 'private, max-age=86400, immutable',
          'x-content-type-options': 'nosniff',
        },
      })
    }
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket attendu', { status: 426 })
    const { 0: client, 1: server } = new WebSocketPair()

    if (!this.core.isInitialized()) {
      // Ne rien écrire : sonder un code inexistant ne doit créer aucune donnée.
      server.accept()
      const msg: ServerMessage = { t: 'error', code: 'not_found', message: 'Salle introuvable ou expirée.' }
      server.send(JSON.stringify(msg))
      server.close(CLOSE_CODES.notFound, 'not_found')
      return new Response(null, { status: 101, webSocket: client })
    }

    const ipHash = await sha256(this.core.ipSalt() + (request.headers.get('x-cqfd-ip') ?? ''))
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ ipHash } satisfies Attachment)
    // Le minuteur d'effacement n'est annulé qu'une fois le participant réellement entré (voir join).
    return new Response(null, { status: 101, webSocket: client })
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    this.core.noteIncoming()
    const conn = wrap(ws)
    const msg = typeof message === 'string' ? parseClientMessage(message) : null
    if (!msg) {
      conn.send(JSON.stringify({ t: 'error', code: 'bad_message', message: 'Message invalide.' } satisfies ServerMessage))
      return
    }
    if (msg.t === 'join') {
      if (conn.att.pid) return
      const sessionHash = await sha256(msg.session)
      const admin = msg.admin ? this.core.adminAccess(await sha256(msg.admin), timingSafeEqual) : null
      this.core.join(conn, { name: msg.name, sessionHash, admin })
      if (wrap(ws).att.pid) await this.ctx.storage.deleteAlarm()
      return
    }
    if (msg.t === 'invite') {
      if (conn.att.role !== 'admin') return
      const token = randomToken(16)
      this.core.createInvite(conn, randomId(), await sha256(token), token, msg.label)
      return
    }
    this.core.handle(conn, msg)
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason)
    } catch {
      // déjà fermée
    }
    await this.afterDisconnect(ws)
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.afterDisconnect(ws)
  }

  private async afterDisconnect(ws: WebSocket): Promise<void> {
    if (!this.core.isInitialized()) return
    this.core.onClose(wrap(ws))
    if (!this.hasParticipants()) await this.ctx.storage.setAlarm(Date.now() + this.graceMs())
  }

  /** Seuls les participants entrés maintiennent la salle en vie (une socket muette ne compte pas). */
  private hasParticipants(): boolean {
    return this.openConns().some((c) => c.att.pid)
  }

  /** Délai de grâce écoulé : si la salle est toujours vide, on efface tout. */
  override async alarm(): Promise<void> {
    if (this.hasParticipants()) return
    for (const c of this.openConns()) c.close(CLOSE_CODES.notFound, 'expired')
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
    this.core.reset()
  }
}
