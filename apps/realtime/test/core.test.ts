import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import type { BoardElement, ClientMessage, Op, ServerMessage, StrokeElement } from '@cqfd/shared'
import { RoomCore, type Attachment, type Conn, type Sql, type SqlValue } from '../src/core'

function nodeSql(db: DatabaseSync): Sql {
  return {
    exec: <T extends Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]) =>
      db.prepare(query).all(...bindings) as T[],
    transaction: (fn) => {
      db.exec('BEGIN')
      try {
        const r = fn()
        db.exec('COMMIT')
        return r
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
  }
}

class FakeConn implements Conn {
  readonly key = Symbol()
  att: Attachment
  inbox: ServerMessage[] = []
  closed: { code: number; reason: string } | null = null
  constructor(ip = 'ip-a') {
    this.att = { ipHash: ip }
  }
  setAtt(att: Attachment) {
    this.att = att
  }
  send(data: string) {
    this.inbox.push(JSON.parse(data) as ServerMessage)
  }
  close(code: number, reason: string) {
    this.closed = { code, reason }
  }
  last<T extends ServerMessage['t']>(t: T) {
    return [...this.inbox].reverse().find((m) => m.t === t) as Extract<ServerMessage, { t: T }> | undefined
  }
}

let db: DatabaseSync
let conns: FakeConn[]
let core: RoomCore
let clock: number

const ADMIN = 'hash-admin'

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  conns = []
  clock = 1_000_000
  core = new RoomCore(nodeSql(db), () => conns.filter((c) => !c.closed), () => clock)
  core.init(ADMIN, 'salt', 'page1')
})

function connect(name: string, session: string, opts: { admin?: boolean; ip?: string } = {}) {
  const c = new FakeConn(opts.ip)
  conns.push(c)
  core.join(c, { name, sessionHash: session, isAdmin: opts.admin ?? false })
  return c
}

const pid = (c: FakeConn) => c.att.pid!

function stroke(id: string, authorId: string, pageId = 'page1'): StrokeElement {
  return {
    id,
    pageId,
    authorId,
    z: 1,
    x: 0,
    y: 0,
    type: 'stroke',
    tool: 'pen',
    color: '#000000',
    size: 3,
    pts: [0, 0, 0.5, 10, 10, 0.5],
  }
}

let seq = 0
function send(c: FakeConn, ops: Op[]) {
  seq++
  core.handle(c, { t: 'ops', seq, ops })
  return seq
}

const put = (el: BoardElement): Op => ({ o: 'put', el })

describe('création de salle', () => {
  it("un code déjà utilisé n'est pas réinitialisé", () => {
    expect(core.isInitialized()).toBe(true)
    expect(core.init('autre', 'x')).toBe(false)
    expect(core.adminHash()).toBe(ADMIN)
  })

  it("un objet jamais créé n'a aucune table", () => {
    const empty = new RoomCore(nodeSql(new DatabaseSync(':memory:')), () => [])
    expect(empty.isInitialized()).toBe(false)
  })
})

describe('rejoindre', () => {
  it('envoie un welcome complet et dédoublonne les noms', () => {
    const a = connect('Léa', 's1')
    const b = connect('Léa', 's2')
    expect(a.last('welcome')?.you.name).toBe('Léa')
    expect(b.last('welcome')?.you.name).toBe('Léa (2)')
    expect(a.last('participants')?.participants.map((p) => p.name)).toEqual(['Léa', 'Léa (2)'])
    expect(b.last('welcome')?.pages).toEqual([{ id: 'page1', name: 'Page 1', ord: 1, bg: 'blank' }])
  })

  it("se reconnecter avec le même jeton conserve l'identité", () => {
    const a = connect('Léa', 's1')
    const id = pid(a)
    a.closed = { code: 1000, reason: '' }
    const again = connect('Autre nom', 's1')
    expect(pid(again)).toBe(id)
    expect(again.last('welcome')?.you.name).toBe('Léa')
  })

  it('un deuxième onglet avec la même session remplace le premier', () => {
    const a = connect('Léa', 's1')
    connect('Léa', 's1')
    expect(a.closed?.reason).toBe('replaced')
  })

  it('le jeton admin donne le rôle admin', () => {
    const prof = connect('Prof', 'sp', { admin: true })
    expect(prof.last('welcome')?.you).toMatchObject({ role: 'admin', canWrite: true })
  })

  it('salle verrouillée : nouveaux refusés, anciens acceptés', () => {
    const prof = connect('Prof', 'sp', { admin: true })
    const eleve = connect('Léa', 's1')
    core.handle(prof, { t: 'settings', locked: true })
    eleve.closed = { code: 1000, reason: '' }
    expect(connect('Léa', 's1').closed).toBeNull()
    expect(connect('Nouveau', 's9').closed?.reason).toBe('locked')
  })

  it('limite de participants (le prof ne compte pas)', () => {
    const prof = connect('Prof', 'sp', { admin: true })
    core.handle(prof, { t: 'settings', maxParticipants: 2 })
    connect('A', 'sa')
    connect('B', 'sb')
    expect(connect('C', 'sc').closed?.reason).toBe('full')
  })

  it('bannis refusés par session ou par IP, mais pas le prof', () => {
    db.prepare(`INSERT INTO bans (id, ip_hash, session_hash, name, at) VALUES ('b1', 'ip-bad', 'sbad', 'X', 0)`).run()
    expect(connect('X', 'sbad').closed?.reason).toBe('banned')
    expect(connect('Y', 'snew', { ip: 'ip-bad' }).closed?.reason).toBe('banned')
    expect(connect('Prof', 'sp', { admin: true, ip: 'ip-bad' }).closed).toBeNull()
  })

  it('participant exclu refusé avec le même jeton', () => {
    const a = connect('Léa', 's1')
    db.prepare(`UPDATE participants SET kicked = 1 WHERE id = ?`).run(pid(a))
    a.closed = { code: 1000, reason: '' }
    expect(connect('Léa', 's1').closed?.reason).toBe('kicked')
  })
})

describe('droits sur les éléments (côté serveur)', () => {
  let prof: FakeConn
  let eleve: FakeConn
  let autre: FakeConn

  beforeEach(() => {
    prof = connect('Prof', 'sp', { admin: true })
    eleve = connect('Léa', 's1')
    autre = connect('Tom', 's2')
  })

  it('le prof écrit, les autres reçoivent, lui reçoit un ack', () => {
    const s = send(prof, [put(stroke('e1', pid(prof)))])
    expect(prof.last('ack')?.seq).toBe(s)
    expect(eleve.last('ops')?.ops).toHaveLength(1)
    expect(core.elements()).toHaveLength(1)
  })

  it('un élève sans la main est en lecture seule', () => {
    const s = send(eleve, [put(stroke('e1', pid(eleve)))])
    expect(eleve.last('nack')).toMatchObject({ seq: s, restore: [{ o: 'del', id: 'e1' }] })
    expect(core.elements()).toHaveLength(0)
    expect(autre.last('ops')).toBeUndefined()
  })

  it('avec la main : écrit, mais ne peut pas effacer le travail du prof', () => {
    send(prof, [put(stroke('p1', pid(prof)))])
    core.handle(prof, { t: 'grant', pid: pid(eleve), on: true })
    expect(eleve.last('you')?.you.canWrite).toBe(true)

    send(eleve, [put(stroke('e1', pid(eleve)))])
    expect(core.elements()).toHaveLength(2)

    send(eleve, [{ o: 'del', id: 'p1' }])
    expect(eleve.last('nack')?.restore).toEqual([{ o: 'put', el: stroke('p1', pid(prof)) }])

    send(eleve, [put({ ...stroke('p1', pid(eleve)), x: 50 })])
    expect(eleve.last('nack')?.reason).toMatch(/quelqu'un d'autre/)
    expect(core.elements().find((e) => e.id === 'p1')?.x).toBe(0)
  })

  it("un lot est tout-ou-rien", () => {
    send(prof, [put(stroke('p1', pid(prof)))])
    core.handle(prof, { t: 'grant', pid: pid(eleve), on: true })
    send(eleve, [put(stroke('e1', pid(eleve))), { o: 'del', id: 'p1' }])
    expect(core.elements().map((e) => e.id)).toEqual(['p1'])
  })

  it('retirer la main rend la lecture seule immédiatement', () => {
    core.handle(prof, { t: 'grant', pid: pid(eleve), on: true })
    core.handle(prof, { t: 'grant', pid: pid(eleve), on: false })
    send(eleve, [put(stroke('e1', pid(eleve)))])
    expect(eleve.last('nack')).toBeDefined()
  })

  it('le gel bloque les élèves mais pas le prof', () => {
    core.handle(prof, { t: 'grant', pid: pid(eleve), on: true })
    core.handle(prof, { t: 'settings', frozen: true })
    send(eleve, [put(stroke('e1', pid(eleve)))])
    expect(eleve.last('nack')?.reason).toBe('Tableau gelé')
    send(prof, [put(stroke('p1', pid(prof)))])
    expect(prof.last('ack')).toBeDefined()
  })

  it('le prof peut déplacer un élément élève (auteur conservé)', () => {
    core.handle(prof, { t: 'grant', pid: pid(eleve), on: true })
    send(eleve, [put(stroke('e1', pid(eleve)))])
    send(prof, [put({ ...stroke('e1', pid(eleve)), x: 99 })])
    expect(core.elements()[0]).toMatchObject({ x: 99, authorId: pid(eleve) })
  })

  it('page inconnue refusée', () => {
    send(prof, [put(stroke('p1', pid(prof), 'nope'))])
    expect(prof.last('nack')?.reason).toBe('Page inconnue')
  })

  it('actions admin refusées aux élèves', () => {
    core.handle(eleve, { t: 'grant', pid: pid(eleve), on: true })
    expect(eleve.last('error')?.code).toBe('forbidden')
    core.handle(eleve, { t: 'page', action: { a: 'add', id: 'p2', name: 'X', ord: 2 } })
    expect(core.pages()).toHaveLength(1)
  })

  it('limitation de débit sur les lots', () => {
    for (let i = 0; i < 70; i++) send(prof, [put(stroke(`p${i}`, pid(prof)))])
    expect(prof.last('nack')?.reason).toMatch(/ralentissez/)
    clock += 5_000
    send(prof, [put(stroke('late', pid(prof)))])
    expect(prof.last('ack')).toBeDefined()
  })
})

describe('éphémère : tracé en direct et laser', () => {
  it('le direct est relayé sans être stocké, seulement si on peut écrire', () => {
    const prof = connect('Prof', 'sp', { admin: true })
    const eleve = connect('Léa', 's1')
    const live: ClientMessage = { t: 'live', id: 'x', pageId: 'page1', tool: 'pen', color: '#000000', size: 2, pts: [1, 2, 0.5] }
    core.handle(prof, live)
    expect(eleve.last('live')).toMatchObject({ by: pid(prof), id: 'x' })
    core.handle(eleve, { ...live, id: 'y' })
    expect(prof.last('live')).toBeUndefined()
    expect(core.elements()).toHaveLength(0)
  })

  it('laser réservé au prof par défaut', () => {
    const prof = connect('Prof', 'sp', { admin: true })
    const eleve = connect('Léa', 's1')
    core.handle(prof, { t: 'grant', pid: pid(eleve), on: true })
    core.handle(eleve, { t: 'laser', pageId: 'page1', pts: [1, 2] })
    expect(prof.last('laser')).toBeUndefined()
    core.handle(prof, { t: 'settings', laserForStudents: true })
    core.handle(eleve, { t: 'laser', pageId: 'page1', pts: [1, 2] })
    expect(prof.last('laser')).toMatchObject({ by: pid(eleve) })
  })
})

describe('pages', () => {
  it('ajout, renommage, duplication avec éléments, suppression', () => {
    const prof = connect('Prof', 'sp', { admin: true })
    const eleve = connect('Léa', 's1')
    send(prof, [put(stroke('p1', pid(prof)))])
    core.handle(prof, { t: 'page', action: { a: 'add', id: 'page2', name: 'Exercices', ord: 2 } })
    core.handle(prof, { t: 'page', action: { a: 'rename', id: 'page2', name: 'Exos' } })
    core.handle(prof, { t: 'page', action: { a: 'dup', id: 'page1', newId: 'page3', name: 'Page 1 (copie)', ord: 1.5 } })
    expect(core.pages().map((p) => p.name)).toEqual(['Page 1', 'Page 1 (copie)', 'Exos'])
    expect(core.elements().filter((e) => e.pageId === 'page3')).toHaveLength(1)
    expect(eleve.last('pages')?.pages).toHaveLength(3)

    core.handle(prof, { t: 'page', action: { a: 'del', id: 'page1' } })
    expect(core.elements().map((e) => e.pageId)).toEqual(['page3'])
    expect(eleve.last('view')?.pageId).toBe('page3')
  })

  it('impossible de supprimer la dernière page', () => {
    const prof = connect('Prof', 'sp', { admin: true })
    core.handle(prof, { t: 'page', action: { a: 'del', id: 'page1' } })
    expect(core.pages()).toHaveLength(1)
    expect(prof.last('error')?.message).toMatch(/dernière page/)
  })
})
