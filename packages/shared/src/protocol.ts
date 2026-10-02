import { z } from 'zod'
import { colorSchema, elementSchema, idSchema, PAGE_BACKGROUNDS, pageSchema } from './elements'
import type { BoardElement, Page } from './elements'
import { LIMITS } from './limits'
import type { Role } from './permissions'

const coord = z.number().finite().min(-1e7).max(1e7)
const pageName = pageSchema.shape.name

export const opSchema = z.discriminatedUnion('o', [
  z.object({ o: z.literal('put'), el: elementSchema }),
  z.object({ o: z.literal('del'), id: idSchema }),
])
export type Op = z.infer<typeof opSchema>

const pageAction = z.discriminatedUnion('a', [
  z.object({ a: z.literal('add'), id: idSchema, name: pageName, ord: z.number().finite() }),
  z.object({ a: z.literal('rename'), id: idSchema, name: pageName }),
  z.object({ a: z.literal('move'), id: idSchema, ord: z.number().finite() }),
  z.object({ a: z.literal('dup'), id: idSchema, newId: idSchema, name: pageName, ord: z.number().finite() }),
  z.object({ a: z.literal('del'), id: idSchema }),
  z.object({ a: z.literal('bg'), id: idSchema, bg: z.enum(PAGE_BACKGROUNDS) }),
])
export type PageAction = z.infer<typeof pageAction>

/** Messages client → serveur. */
export const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('join'),
    name: z.string().max(200),
    session: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
    admin: z.string().max(100).optional(),
  }),
  z.object({
    t: z.literal('ops'),
    seq: z.number().int().nonnegative(),
    ops: z.array(opSchema).min(1).max(LIMITS.maxOpsPerMessage),
  }),
  z.object({
    t: z.literal('live'),
    id: idSchema,
    pageId: idSchema,
    tool: z.enum(['pen', 'highlighter']),
    color: colorSchema,
    size: z.number().min(0.5).max(80),
    /** Points absolus (x, y, pression) ajoutés depuis le dernier envoi. */
    pts: z.array(coord).max(LIMITS.maxLiveNumbers),
    end: z.boolean().optional(),
  }),
  z.object({
    t: z.literal('laser'),
    pageId: idSchema,
    pts: z.array(coord).max(LIMITS.maxLaserNumbers),
  }),
  z.object({ t: z.literal('page'), action: pageAction }),
  z.object({ t: z.literal('view'), pageId: idSchema }),
  z.object({ t: z.literal('grant'), pid: idSchema, on: z.boolean() }),
  z.object({
    t: z.literal('settings'),
    frozen: z.boolean().optional(),
    locked: z.boolean().optional(),
    laserForStudents: z.boolean().optional(),
    maxParticipants: z.number().int().min(LIMITS.minParticipants).max(LIMITS.maxParticipants).optional(),
  }),
])
export type ClientMessage = z.infer<typeof clientMessageSchema>

export interface RoomSettings {
  frozen: boolean
  locked: boolean
  laserForStudents: boolean
  maxParticipants: number
}

export interface ParticipantInfo {
  id: string
  name: string
  role: Role
  canWrite: boolean
  online: boolean
}

export interface Me {
  id: string
  name: string
  role: Role
  canWrite: boolean
}

export type ErrorCode =
  | 'not_found'
  | 'banned'
  | 'kicked'
  | 'locked'
  | 'full'
  | 'replaced'
  | 'bad_message'
  | 'forbidden'
  | 'rate_limited'
  | 'quota'

/** Messages serveur → client. */
export type ServerMessage =
  | {
      t: 'welcome'
      you: Me
      settings: RoomSettings
      pages: Page[]
      elements: BoardElement[]
      participants: ParticipantInfo[]
      adminPage: string | null
    }
  | { t: 'ops'; by: string; ops: Op[] }
  | { t: 'ack'; seq: number }
  | { t: 'nack'; seq: number; reason: string; restore: Op[] }
  | {
      t: 'live'
      by: string
      id: string
      pageId: string
      tool: 'pen' | 'highlighter'
      color: string
      size: number
      pts: number[]
      end?: boolean
    }
  | { t: 'laser'; by: string; pageId: string; pts: number[] }
  | { t: 'pages'; pages: Page[] }
  | { t: 'participants'; participants: ParticipantInfo[] }
  | { t: 'you'; you: Me }
  | { t: 'settings'; settings: RoomSettings }
  | { t: 'view'; pageId: string }
  | { t: 'error'; code: ErrorCode; message: string }

/** Codes de fermeture WebSocket applicatifs (4000-4999). */
export const CLOSE_CODES = {
  notFound: 4404,
  banned: 4403,
  kicked: 4401,
  locked: 4423,
  full: 4429,
  replaced: 4409,
} as const

export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > LIMITS.maxMessageBytes) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  const res = clientMessageSchema.safeParse(data)
  return res.success ? res.data : null
}
