import { DurableObject } from 'cloudflare:workers'
import {
  CLOSE_CODES,
  HEARTBEAT_REQUEST,
  HEARTBEAT_RESPONSE,
  parseClientMessage,
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
          sql.exec<T>(query, ...bindings).toArray(),
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
    await this.ctx.storage.deleteAlarm()
    return new Response(null, { status: 101, webSocket: client })
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const conn = wrap(ws)
    const msg = typeof message === 'string' ? parseClientMessage(message) : null
    if (!msg) {
      conn.send(JSON.stringify({ t: 'error', code: 'bad_message', message: 'Message invalide.' } satisfies ServerMessage))
      return
    }
    if (msg.t === 'join') {
      if (conn.att.pid) return
      const sessionHash = await sha256(msg.session)
      const isAdmin = msg.admin ? timingSafeEqual(await sha256(msg.admin), this.core.adminHash()) : false
      this.core.join(conn, { name: msg.name, sessionHash, isAdmin })
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
    if (this.openConns().length === 0) await this.ctx.storage.setAlarm(Date.now() + this.graceMs())
  }

  /** Délai de grâce écoulé : si la salle est toujours vide, on efface tout. */
  override async alarm(): Promise<void> {
    if (this.openConns().length > 0) return
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
    this.core.reset()
  }
}
