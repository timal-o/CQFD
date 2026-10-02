import { generateRoomCode, isValidCode, randomToken } from '@cqfd/shared'
import { sha256 } from './hash'

export { Room } from './room'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

/** Refuse les requêtes venant d'un autre site (création de salle, WebSocket). */
function originAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin')
  if (!origin) return true
  const url = new URL(request.url)
  const extra = (env.EXTRA_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return origin === url.origin || extra.includes(origin)
}

async function createRoom(env: Env): Promise<Response> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode()
    const adminToken = randomToken(16)
    const stub = env.ROOM.get(env.ROOM.idFromName(code))
    if (await stub.create(await sha256(adminToken))) return json({ code, adminToken }, 201)
  }
  return json({ error: 'Impossible de créer une salle, réessayez.' }, 503)
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/rooms') {
      if (request.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405)
      if (!originAllowed(request, env)) return json({ error: 'Origine refusée' }, 403)
      return createRoom(env)
    }

    const ws = url.pathname.match(/^\/ws\/([A-Za-z0-9]+)$/)
    if (ws) {
      const code = ws[1]!.toUpperCase()
      if (!isValidCode(code)) return json({ error: 'Code invalide' }, 404)
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'WebSocket attendu' }, 426)
      if (!originAllowed(request, env)) return json({ error: 'Origine refusée' }, 403)
      // L'IP n'est transmise qu'au Durable Object, qui n'en garde qu'un hash salé.
      const headers = new Headers({ Upgrade: 'websocket', 'x-cqfd-ip': request.headers.get('CF-Connecting-IP') ?? '' })
      const stub = env.ROOM.get(env.ROOM.idFromName(code))
      return stub.fetch(new Request(url.toString(), { headers }))
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'Introuvable' }, 404)
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
