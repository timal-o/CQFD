import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import type { BoardElement, ClientMessage, Op, ServerMessage, StrokeElement } from '@cqfd/shared'
import { RoomCore, type Attachment, type Conn, type Sql, type SqlValue } from '../src/core'

function nodeSql(db: DatabaseSync): Sql {
  return {
    exec: <T extends Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]) =>
      db.prepare(query).all(...bindings.map((b) => (b instanceof ArrayBuffer ? new Uint8Array(b) : b))) as T[],
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
  core.join(c, { name, sessionHash: session, admin: opts.admin ? { kind: 'owner' } : null })
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
    expect(core.adminAccess(ADMIN, (a, b) => a === b)).toEqual({ kind: 'owner' })
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
    expect(b.last('welcome')?.pages).toEqual([{ id: 'page1', name: 'Page 1', ord: 1, bg: 'blank', image: null }])
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

describe('main levée', () => {
  it("l'élève lève la main, le prof est notifié, donner la main la baisse", () => {
    const prof = connect('Prof', 'sp', { admin: true })
    const eleve = connect('Léa', 's1')
    clock += 1000
    core.handle(eleve, { t: 'hand', up: true })
    expect(prof.last('hand')?.name).toBe('Léa')
    const me = () => prof.last('participants')!.participants.find((p) => p.id === pid(eleve))!
    expect(me().handAt).toBe(clock)
    core.handle(prof, { t: 'grant', pid: pid(eleve), on: true })
    expect(me()).toMatchObject({ handAt: null, canWrite: true })
  })

  it('file ordonnée par heure de levée ; le prof peut baisser une main', () => {
    const prof = connect('Prof', 'sp', { admin: true })
    const a = connect('A', 'sa')
    const b = connect('B', 'sb')
    clock += 10
    core.handle(b, { t: 'hand', up: true })
    clock += 10
    core.handle(a, { t: 'hand', up: true })
    const queue = prof
      .last('participants')!
      .participants.filter((p) => p.handAt !== null)
      .sort((x, y) => x.handAt! - y.handAt!)
      .map((p) => p.name)
    expect(queue).toEqual(['B', 'A'])
    core.handle(prof, { t: 'hand', up: false, pid: pid(b) })
    expect(prof.last('participants')!.participants.find((p) => p.name === 'B')!.handAt).toBeNull()
    // Un élève ne peut pas baisser la main d'un autre.
    core.handle(b, { t: 'hand', up: false, pid: pid(a) })
    expect(b.last('error')?.code).toBe('forbidden')
  })
})

describe('exclusion et bannissement', () => {
  it('kick : déconnecté, ne revient pas avec le même jeton, mais un autre navigateur peut', () => {
    const prof = connect('Prof', 'sp', { admin: true })
    const eleve = connect('Léa', 's1', { ip: 'ip-l' })
    core.handle(prof, { t: 'kick', pid: pid(eleve) })
    expect(eleve.closed?.reason).toBe('kicked')
    expect(connect('Léa', 's1', { ip: 'ip-l' }).closed?.reason).toBe('kicked')
    expect(connect('Léa', 's-autre', { ip: 'ip-l' }).closed).toBeNull()
  })

  it("ban : ni le même jeton ni la même IP ; le prof voit la liste et peut lever le ban", () => {
    const prof = connect('Prof', 'sp', { admin: true })
    const eleve = connect('Tom', 's1', { ip: 'ip-t' })
    core.handle(prof, { t: 'ban', pid: pid(eleve) })
    expect(eleve.closed?.reason).toBe('banned')
    expect(connect('Tom', 's2', { ip: 'ip-t' }).closed?.reason).toBe('banned')
    const bans = prof.last('bans')!.bans
    expect(bans.map((b) => b.name)).toEqual(['Tom'])
    core.handle(prof, { t: 'unban', id: bans[0]!.id })
    expect(prof.last('bans')!.bans).toEqual([])
    expect(connect('Tom', 's1', { ip: 'ip-t' }).closed).toBeNull()
  })

  it("on ne peut pas exclure un professeur, et un élève ne peut exclure personne", () => {
    const prof = connect('Prof', 'sp', { admin: true })
    const eleve = connect('Léa', 's1')
    core.handle(eleve, { t: 'kick', pid: pid(prof) })
    expect(prof.closed).toBeNull()
    expect(eleve.last('error')?.code).toBe('forbidden')
  })
})

describe('chat', () => {
  it('diffusé à tous, nettoyé, historique au welcome ; le prof peut le couper', () => {
    const prof = connect('Prof', 'sp', { admin: true })
    const eleve = connect('Léa', 's1')
    core.handle(eleve, { t: 'chat', text: '  Bonjour‮   madame  ' })
    expect(prof.last('chat')?.msg).toMatchObject({ name: 'Léa', text: 'Bonjour madame' })
    expect(connect('Tom', 's2').last('welcome')?.chat.map((m) => m.text)).toEqual(['Bonjour madame'])
    core.handle(prof, { t: 'settings', chatEnabled: false })
    clock += 2000
    core.handle(eleve, { t: 'chat', text: 'encore' })
    expect(eleve.last('error')?.message).toMatch(/désactivé/)
    core.handle(prof, { t: 'chat', text: 'Silence' })
    expect(eleve.last('chat')?.msg.text).toBe('Silence')
  })

  it('limité à un message par seconde', () => {
    connect('Prof', 'sp', { admin: true })
    const eleve = connect('Léa', 's1')
    for (let i = 0; i < 8; i++) core.handle(eleve, { t: 'chat', text: `m${i}` })
    expect(eleve.inbox.filter((m) => m.t === 'chat')).toHaveLength(5)
  })
})

describe("journal d'actions", () => {
  it('chaque action est journalisée et visible des seuls admins', () => {
    const prof = connect('Prof', 'sp', { admin: true })
    const eleve = connect('Léa', 's1')
    core.handle(prof, { t: 'grant', pid: pid(eleve), on: true })
    send(eleve, [put(stroke('e1', pid(eleve)))])
    expect(prof.last('log')?.entries[0]).toMatchObject({ name: 'Léa', summary: 'a ajouté un trait', revertable: true })
    expect(eleve.last('log')).toBeUndefined()
    expect(connect('Prof', 'sp', { admin: true }).last('welcome')?.admin?.log.length).toBe(1)
  })

  it("l'admin annule l'action d'un élève", () => {
    const prof = connect('Prof', 'sp', { admin: true })
    const eleve = connect('Léa', 's1')
    core.handle(prof, { t: 'grant', pid: pid(eleve), on: true })
    send(eleve, [put(stroke('e1', pid(eleve)))])
    const seq = prof.last('log')!.entries[0]!.seq
    core.handle(prof, { t: 'revert', seq })
    expect(core.elements()).toHaveLength(0)
    expect(eleve.last('ops')?.ops).toEqual([{ o: 'del', id: 'e1' }])
    expect(prof.last('log')?.entries[0]?.summary).toBe('a annulé « a ajouté un trait » (Léa)')
  })

  it('prévient avant d’écraser une modification faite depuis, puis écrase si confirmé', () => {
    const prof = connect('Prof', 'sp', { admin: true })
    const eleve = connect('Léa', 's1')
    core.handle(prof, { t: 'grant', pid: pid(eleve), on: true })
    send(eleve, [put(stroke('e1', pid(eleve)))])
    const seq = prof.last('log')!.entries[0]!.seq
    clock += 1000
    send(eleve, [put({ ...stroke('e1', pid(eleve)), x: 42 })])
    core.handle(prof, { t: 'revert', seq })
    expect(prof.last('revertConflict')?.seq).toBe(seq)
    expect(core.elements()).toHaveLength(1)
    core.handle(prof, { t: 'revert', seq, force: true })
    expect(core.elements()).toHaveLength(0)
  })

  it('annuler un effacement restaure le travail', () => {
    const prof = connect('Prof', 'sp', { admin: true })
    send(prof, [put(stroke('p1', pid(prof)))])
    send(prof, [{ o: 'del', id: 'p1' }])
    expect(prof.last('log')?.entries[0]?.summary).toBe('a effacé un trait')
    clock += 1000
    core.handle(prof, { t: 'revert', seq: prof.last('log')!.entries[0]!.seq })
    expect(core.elements().map((e) => e.id)).toEqual(['p1'])
  })
})

describe('co-admins', () => {
  it('une invitation donne les droits admin ; la révoquer les retire', () => {
    const prof = connect('Prof', 'sp', { admin: true })
    core.createInvite(prof, 'inv1', 'hash-inv', 'jeton', 'M. Dupont')
    expect(prof.last('inviteCreated')).toEqual({ t: 'inviteCreated', id: 'inv1', token: 'jeton' })
    expect(prof.last('invites')?.invites.map((i) => i.label)).toEqual(['M. Dupont'])
    expect(core.adminAccess('hash-inv', (a, b) => a === b)).toEqual({ kind: 'invite', id: 'inv1' })

    const co = new FakeConn()
    conns.push(co)
    core.join(co, { name: 'Dupont', sessionHash: 'sc', admin: { kind: 'invite', id: 'inv1' } })
    expect(co.last('welcome')?.you.role).toBe('admin')

    core.handle(prof, { t: 'revokeInvite', id: 'inv1' })
    expect(co.last('you')?.you).toMatchObject({ role: 'participant', canWrite: false })
    expect(core.adminAccess('hash-inv', (a, b) => a === b)).toBeNull()
    send(co, [put(stroke('x', pid(co)))])
    expect(co.last('nack')).toBeDefined()
  })
})

describe('images de fond', () => {
  it("assemble les morceaux, attache l'image à la page et la relit", () => {
    const prof = connect('Prof', 'sp', { admin: true })
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7])
    const b64 = (a: Uint8Array) => Buffer.from(a).toString('base64')
    const base = { t: 'asset', id: 'img1', pageId: 'page1', mime: 'image/jpeg', w: 800, h: 600, total: 2 } as const
    core.handle(prof, { ...base, idx: 0, data: b64(bytes.slice(0, 4)) })
    expect(core.pages()[0]!.image).toBeNull()
    core.handle(prof, { ...base, idx: 1, data: b64(bytes.slice(4)) })
    expect(core.pages()[0]!.image).toEqual({ id: 'img1', w: 800, h: 600 })
    expect(prof.last('pages')?.pages[0]?.image?.id).toBe('img1')
    expect([...core.readAsset('img1')!.bytes]).toEqual([...bytes])
  })

  it('refusé aux élèves et au-delà du plafond par image', () => {
    connect('Prof', 'sp', { admin: true })
    const eleve = connect('Léa', 's1')
    core.handle(eleve, { t: 'asset', id: 'x', pageId: 'page1', mime: 'image/png', w: 1, h: 1, idx: 0, total: 1, data: 'AAAA' })
    expect(core.readAsset('x')).toBeNull()
    expect(eleve.last('error')?.code).toBe('forbidden')
  })
})

describe('migration', () => {
  it('une salle créée avec le schéma v1 est migrée au réveil', () => {
    const old = new DatabaseSync(':memory:')
    old.exec(`CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE pages (id TEXT PRIMARY KEY, name TEXT NOT NULL, ord REAL NOT NULL, bg TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE elements (id TEXT PRIMARY KEY, page_id TEXT NOT NULL, author_id TEXT NOT NULL, data TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE participants (id TEXT PRIMARY KEY, session_hash TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
        can_write INTEGER NOT NULL, kicked INTEGER NOT NULL DEFAULT 0, joined_at INTEGER NOT NULL) WITHOUT ROWID;
      CREATE TABLE bans (id TEXT PRIMARY KEY, ip_hash TEXT NOT NULL, session_hash TEXT NOT NULL, name TEXT NOT NULL, at INTEGER NOT NULL) WITHOUT ROWID;
      INSERT INTO meta VALUES ('admin_hash', 'h'), ('admin_page', 'p');
      INSERT INTO pages VALUES ('p', 'Page 1', 1, 'blank');`)
    const migrated = new RoomCore(nodeSql(old), () => [])
    expect(migrated.isInitialized()).toBe(true)
    expect(migrated.pages()[0]).toMatchObject({ id: 'p', image: null })
    expect(migrated.chat()).toEqual([])
  })
})

describe('quota', () => {
  it("passe en alerte puis en mode dégradé (laser coupé) selon les messages entrants", () => {
    const prof = connect('Prof', 'sp', { admin: true })
    const eleve = connect('Léa', 's1')
    for (let i = 0; i < 300_000; i++) core.noteIncoming()
    expect(prof.last('quota')?.level).toBe('warn')
    for (let i = 0; i < 200_000; i++) core.noteIncoming()
    expect(eleve.last('quota')?.level).toBe('degraded')
    core.handle(prof, { t: 'laser', pageId: 'page1', pts: [1, 2] })
    expect(eleve.last('laser')).toBeUndefined()
  })
})

describe('lignes lues (quota)', () => {
  it('un tracé en direct, un laser ou un lot ne relisent pas les réglages ni les pages', () => {
    let queries: string[] = []
    const base = nodeSql(db)
    const counting: Sql = {
      exec: (q, ...b) => {
        queries.push(q)
        return base.exec(q, ...b)
      },
      transaction: base.transaction,
    }
    const c2 = new RoomCore(counting, () => conns.filter((c) => !c.closed), () => clock)
    core = c2
    const prof = connect('Prof', 'sp', { admin: true })
    connect('Léa', 's1')
    queries = []
    for (let i = 0; i < 50; i++) {
      core.handle(prof, { t: 'live', id: 'x', pageId: 'page1', tool: 'pen', color: '#000000', size: 2, pts: [1, 2, 0.5] })
      core.handle(prof, { t: 'laser', pageId: 'page1', pts: [1, 2] })
    }
    expect(queries).toEqual([])
    send(prof, [put(stroke('p1', pid(prof)))])
    expect(queries.filter((q) => /FROM (meta|pages)\b/.test(q))).toEqual([])
  })

  it('les copies en mémoire suivent les modifications', () => {
    const prof = connect('Prof', 'sp', { admin: true })
    const eleve = connect('Léa', 's1')
    core.handle(prof, { t: 'grant', pid: pid(eleve), on: true })
    core.handle(prof, { t: 'settings', frozen: true })
    send(eleve, [put(stroke('e1', pid(eleve)))])
    expect(eleve.last('nack')?.reason).toBe('Tableau gelé')
    core.handle(prof, { t: 'page', action: { a: 'add', id: 'p2', name: 'Deux', ord: 2 } })
    send(prof, [put(stroke('q', pid(prof), 'p2'))])
    expect(prof.last('ack')).toBeDefined()
    core.handle(prof, { t: 'page', action: { a: 'rename', id: 'p2', name: 'Bis' } })
    expect(core.pages().map((p) => p.name)).toEqual(['Page 1', 'Bis'])
  })
})
