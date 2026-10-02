import {
  CLOSE_CODES,
  HEARTBEAT_REQUEST,
  HEARTBEAT_RESPONSE,
  SEND_INTERVALS,
  type ClientMessage,
  type ServerMessage,
} from '@cqfd/shared'

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

const FATAL = new Set<number>(Object.values(CLOSE_CODES))

export interface SocketHandlers {
  onMessage(msg: ServerMessage): void
  onStatus(status: SocketStatus): void
  /** Message `join` à envoyer à chaque (re)connexion. */
  join(): ClientMessage
}

/** WebSocket avec reconnexion automatique et heartbeat (traité sans réveiller le serveur). */
export class RoomSocket {
  private ws: WebSocket | null = null
  private retry = 0
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private stopped = false

  constructor(
    private readonly code: string,
    private readonly handlers: SocketHandlers,
  ) {}

  connect(): void {
    this.stopped = false
    this.handlers.onStatus(this.retry === 0 ? 'connecting' : 'reconnecting')
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${proto}//${location.host}/ws/${this.code}`)
    this.ws = ws

    ws.onopen = () => {
      this.retry = 0
      ws.send(JSON.stringify(this.handlers.join()))
      this.heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(HEARTBEAT_REQUEST)
      }, SEND_INTERVALS.heartbeat)
    }

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string' || ev.data === HEARTBEAT_RESPONSE) return
      let msg: ServerMessage
      try {
        msg = JSON.parse(ev.data) as ServerMessage
      } catch {
        return
      }
      if (msg.t === 'welcome') this.handlers.onStatus('open')
      this.handlers.onMessage(msg)
    }

    ws.onclose = (ev) => {
      clearInterval(this.heartbeat)
      if (this.ws !== ws) return
      this.ws = null
      if (this.stopped || FATAL.has(ev.code)) {
        this.handlers.onStatus('closed')
        return
      }
      this.handlers.onStatus('reconnecting')
      const delay = Math.min(10_000, 500 * 2 ** this.retry) * (0.75 + Math.random() * 0.5)
      this.retry++
      this.reconnectTimer = setTimeout(() => this.connect(), delay)
    }
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  send(msg: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(msg))
    return true
  }

  close(): void {
    this.stopped = true
    clearTimeout(this.reconnectTimer)
    clearInterval(this.heartbeat)
    this.ws?.close(1000, 'bye')
    this.ws = null
  }
}
