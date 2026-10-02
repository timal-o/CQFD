#!/usr/bin/env node
/**
 * Test de charge : une salle avec N clients (1 prof + N-1 élèves).
 *
 *   node scripts/loadtest.mjs [url] [clients] [secondes]
 *   node scripts/loadtest.mjs http://localhost:8787 50 60
 *
 * Le prof trace en continu (tracé en direct à 15 Hz + un trait validé par seconde),
 * utilise le laser par moments, 5 élèves ont la main et tracent aussi. Tous envoient le heartbeat.
 * Mesures : latence de relais du tracé (émission → réception chez les autres),
 * latence d'accusé de réception des traits, et nombre de messages entrants (= ce qui est facturé :
 * 20 messages WebSocket entrants = 1 requête Durable Object).
 */

const BASE = process.argv[2] ?? 'http://localhost:8787'
const N = Number(process.argv[3] ?? 50)
const SECONDS = Number(process.argv[4] ?? 60)
const WRITERS = 5
const WS_BASE = BASE.replace(/^http/, 'ws')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rand = () => Math.random().toString(36).slice(2, 14).padEnd(16, 'x')
const stamp = () => Date.now() % 1_000_000
const elapsed = (sent) => (stamp() - sent + 1_000_000) % 1_000_000

const sent = { join: 0, live: 0, ops: 0, laser: 0, ping: 0, grant: 0, hand: 0 }
const liveLatency = []
const ackLatency = []
let disconnects = 0

function connect(code, name, admin) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/ws/${code}`)
    const c = { ws, me: null, pageId: null, acks: new Map(), name }
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'join', name, session: rand() + rand(), admin }))
      sent.join++
    }
    ws.onmessage = (e) => {
      if (e.data === 'pong') return
      const m = JSON.parse(e.data)
      if (m.t === 'welcome') {
        c.me = m.you
        c.pageId = m.pages[0].id
        resolve(c)
      } else if (m.t === 'live' && m.pts.length >= 3) {
        liveLatency.push(elapsed(m.pts[0]))
      } else if (m.t === 'ack') {
        const t0 = c.acks.get(m.seq)
        if (t0 !== undefined) ackLatency.push(Date.now() - t0)
      } else if (m.t === 'you') {
        c.me = m.you
      } else if (m.t === 'error') {
        reject(new Error(`${name}: ${m.message}`))
      }
    }
    ws.onclose = () => {
      if (!c.closing) disconnects++
    }
    ws.onerror = () => reject(new Error(`${name}: erreur WebSocket`))
  })
}

/** Un client qui trace : tracé en direct à 15 Hz, trait validé toutes les `strokeMs`. */
function drawLoop(c, stopAt, strokeMs) {
  let seq = 0
  let strokeId = rand()
  let pts = []
  let lastStroke = Date.now()
  const timer = setInterval(() => {
    if (Date.now() > stopAt) return clearInterval(timer)
    const x = stamp()
    const batch = [x, 100 + Math.random() * 400, 0.5, x, 120, 0.5]
    pts.push(...batch)
    c.ws.send(JSON.stringify({ t: 'live', id: strokeId, pageId: c.pageId, tool: 'pen', color: '#111827', size: 3, pts: batch }))
    sent.live++
    if (Date.now() - lastStroke >= strokeMs) {
      lastStroke = Date.now()
      const rel = pts.map((v, i) => (i % 3 === 2 ? v : Math.round((v % 1000) * 10) / 10))
      const el = { id: strokeId, pageId: c.pageId, authorId: c.me.id, z: seq, x: 0, y: 0, type: 'stroke', tool: 'pen', color: '#111827', size: 3, pts: rel }
      seq++
      c.acks.set(seq, Date.now())
      c.ws.send(JSON.stringify({ t: 'ops', seq, ops: [{ o: 'put', el }] }))
      c.ws.send(JSON.stringify({ t: 'live', id: strokeId, pageId: c.pageId, tool: 'pen', color: '#111827', size: 3, pts: [], end: true }))
      sent.ops++
      sent.live++
      strokeId = rand()
      pts = []
    }
  }, 66)
}

async function main() {
  const res = await fetch(`${BASE}/api/rooms`, { method: 'POST' })
  const { code, adminToken } = await res.json()
  console.log(`Salle ${code} — ${N} clients pendant ${SECONDS} s sur ${BASE}`)

  const t0 = Date.now()
  const prof = await connect(code, 'Prof', adminToken)
  const students = []
  for (let i = 1; i < N; i++) {
    students.push(await connect(code, `Élève ${i}`))
    await sleep(20)
  }
  console.log(`Connexions établies en ${Date.now() - t0} ms`)

  for (const s of students.slice(0, WRITERS)) {
    s.ws.send(JSON.stringify({ t: 'hand', up: true }))
    sent.hand++
    prof.ws.send(JSON.stringify({ t: 'grant', pid: s.me.id, on: true }))
    sent.grant++
  }
  await sleep(500)

  const stopAt = Date.now() + SECONDS * 1000
  const all = [prof, ...students]
  // Heartbeat toutes les 20 s, décalé par client.
  const pings = all.map((c, i) =>
    setTimeout(function beat() {
      if (Date.now() > stopAt) return
      c.ws.send('ping')
      sent.ping++
      setTimeout(beat, 20_000)
    }, (i * 400) % 20_000),
  )
  drawLoop(prof, stopAt, 1000)
  for (const s of students.slice(0, WRITERS)) drawLoop(s, stopAt, 2000)
  // Laser du prof : 3 s toutes les 10 s.
  const laser = setInterval(() => {
    if (Date.now() > stopAt) return clearInterval(laser)
    const until = Date.now() + 3000
    const t = setInterval(() => {
      if (Date.now() > until) return clearInterval(t)
      prof.ws.send(JSON.stringify({ t: 'laser', pageId: prof.pageId, pts: [Math.random() * 800, Math.random() * 600] }))
      sent.laser++
    }, 66)
  }, 10_000)

  await sleep(SECONDS * 1000 + 1500)
  pings.forEach(clearTimeout)
  for (const c of all) {
    c.closing = true
    c.ws.close()
  }

  const pct = (arr, p) => {
    if (arr.length === 0) return null
    const s = [...arr].sort((a, b) => a - b)
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
  }
  const wsMessages = Object.values(sent).reduce((a, b) => a + b, 0)
  // 1 requête par ouverture de WebSocket + 1/20 de requête par message entrant.
  const requests = N + wsMessages / 20
  // Séance de 2 h au même rythme : les connexions ne comptent qu'une fois.
  const twoHours = N + (wsMessages / 20) * ((2 * 3600) / SECONDS)
  console.log(
    JSON.stringify(
      {
        messagesEntrants: sent,
        totalMessagesEntrants: wsMessages,
        requetesDOFacturees: Math.round(requests),
        extrapolation2h: Math.round(twoHours),
        latenceTraceEnDirectMs: { p50: pct(liveLatency, 50), p95: pct(liveLatency, 95), max: pct(liveLatency, 100), echantillons: liveLatency.length },
        latenceAccuseTraitMs: { p50: pct(ackLatency, 50), p95: pct(ackLatency, 95), max: pct(ackLatency, 100) },
        deconnexionsInattendues: disconnects,
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
