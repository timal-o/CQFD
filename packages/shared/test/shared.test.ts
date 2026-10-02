import { describe, expect, it } from 'vitest'
import {
  canUseLaser,
  canWrite,
  checkDel,
  checkPut,
  CODE_ALPHABET,
  dedupeName,
  generateRoomCode,
  isValidCode,
  normalizeCode,
  parseClientMessage,
  randomToken,
  roleLabel,
  sanitizeName,
  type Actor,
} from '../src'

const admin: Actor = { id: 'prof', role: 'admin', canWrite: true }
const reader: Actor = { id: 'eleve1', role: 'participant', canWrite: false }
const writer: Actor = { id: 'eleve2', role: 'participant', canWrite: true }
const open = { frozen: false, laserForStudents: false }
const frozen = { frozen: true, laserForStudents: false }

describe('rôles et droits', () => {
  it('libellés des trois rôles', () => {
    expect(roleLabel(admin)).toBe('admin')
    expect(roleLabel(reader)).toBe('participant')
    expect(roleLabel(writer)).toBe('participant-avec-la-main')
  })

  it('un participant sans la main ne peut rien écrire', () => {
    expect(canWrite(reader, open)).toBe(false)
    expect(checkPut(reader, open, { authorId: 'eleve1', pageId: 'p' }, null).ok).toBe(false)
    expect(checkDel(reader, open, { authorId: 'eleve1', pageId: 'p' }).ok).toBe(false)
  })

  it('avec la main, on crée et modifie ses propres éléments', () => {
    expect(checkPut(writer, open, { authorId: 'eleve2', pageId: 'p' }, null).ok).toBe(true)
    expect(
      checkPut(writer, open, { authorId: 'eleve2', pageId: 'p' }, { authorId: 'eleve2', pageId: 'p' }).ok,
    ).toBe(true)
    expect(checkDel(writer, open, { authorId: 'eleve2', pageId: 'p' }).ok).toBe(true)
  })

  it("avec la main, on ne touche pas au travail du prof ni d'un autre élève", () => {
    expect(
      checkPut(writer, open, { authorId: 'eleve2', pageId: 'p' }, { authorId: 'prof', pageId: 'p' }).ok,
    ).toBe(false)
    expect(checkDel(writer, open, { authorId: 'prof', pageId: 'p' }).ok).toBe(false)
    expect(checkDel(writer, open, { authorId: 'eleve1', pageId: 'p' }).ok).toBe(false)
  })

  it("un élève ne peut pas usurper l'auteur", () => {
    expect(checkPut(writer, open, { authorId: 'prof', pageId: 'p' }, null).ok).toBe(false)
    expect(
      checkPut(writer, open, { authorId: 'prof', pageId: 'p' }, { authorId: 'eleve2', pageId: 'p' }).ok,
    ).toBe(false)
  })

  it("l'admin modifie tout, même gelé", () => {
    expect(checkPut(admin, frozen, { authorId: 'eleve2', pageId: 'p' }, { authorId: 'eleve2', pageId: 'p' }).ok).toBe(true)
    expect(checkDel(admin, frozen, { authorId: 'eleve2', pageId: 'p' }).ok).toBe(true)
  })

  it('le gel bloque les élèves qui ont la main', () => {
    expect(canWrite(writer, frozen)).toBe(false)
    expect(checkPut(writer, frozen, { authorId: 'eleve2', pageId: 'p' }, null)).toEqual({
      ok: false,
      reason: 'Tableau gelé',
    })
  })

  it('un élément ne change pas de page', () => {
    expect(checkPut(admin, open, { authorId: 'prof', pageId: 'b' }, { authorId: 'prof', pageId: 'a' }).ok).toBe(false)
  })

  it('laser réservé au prof sauf option', () => {
    expect(canUseLaser(admin, open)).toBe(true)
    expect(canUseLaser(writer, open)).toBe(false)
    expect(canUseLaser(writer, { frozen: false, laserForStudents: true })).toBe(true)
    expect(canUseLaser(reader, { frozen: false, laserForStudents: true })).toBe(false)
  })
})

describe('noms', () => {
  it('nettoie et borne la longueur', () => {
    expect(sanitizeName('  Zoé ‮  Martin\n')).toBe('Zoé Martin')
    expect(sanitizeName('a'.repeat(100))).toHaveLength(24)
    expect(sanitizeName('<script>alert(1)</script>')).toBe('<script>alert(1)</script')
  })

  it('ajoute un suffixe en cas de doublon', () => {
    expect(dedupeName('Léa', [])).toBe('Léa')
    expect(dedupeName('Léa', ['léa'])).toBe('Léa (2)')
    expect(dedupeName('Léa', ['Léa', 'Léa (2)'])).toBe('Léa (3)')
    expect(dedupeName('x'.repeat(24), ['x'.repeat(24)])).toHaveLength(24)
  })
})

describe('codes', () => {
  it('génère des codes valides sans caractères ambigus', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode()
      expect(isValidCode(code)).toBe(true)
      expect(code).not.toMatch(/[01OI]/)
    }
    expect(CODE_ALPHABET).toHaveLength(32)
  })

  it('normalise la saisie', () => {
    expect(normalizeCode(' abc-def ')).toBe('ABCDEF')
    expect(isValidCode('ABC0EF')).toBe(false)
  })

  it('jeton de 128 bits en base64url', () => {
    const t = randomToken()
    expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })
})

describe('protocole', () => {
  const stroke = {
    id: 's1',
    pageId: 'p1',
    authorId: 'eleve2',
    z: 1,
    x: 0,
    y: 0,
    type: 'stroke',
    tool: 'pen',
    color: '#112233',
    size: 4,
    pts: [0, 0, 0.5, 1, 1, 0.5],
  }

  it('accepte un lot valide', () => {
    const msg = parseClientMessage(JSON.stringify({ t: 'ops', seq: 1, ops: [{ o: 'put', el: stroke }] }))
    expect(msg?.t).toBe('ops')
  })

  it('rejette JSON invalide, type inconnu ou champs hors bornes', () => {
    expect(parseClientMessage('{oops')).toBeNull()
    expect(parseClientMessage(JSON.stringify({ t: 'hack' }))).toBeNull()
    expect(parseClientMessage(JSON.stringify({ t: 'ops', seq: 1, ops: [{ o: 'put', el: { ...stroke, color: 'red' } }] }))).toBeNull()
    expect(parseClientMessage(JSON.stringify({ t: 'ops', seq: 1, ops: [{ o: 'put', el: { ...stroke, pts: [1, 2] } }] }))).toBeNull()
    expect(parseClientMessage(JSON.stringify({ t: 'ops', seq: 1, ops: [{ o: 'put', el: { ...stroke, id: '../x' } }] }))).toBeNull()
  })

  it('valide les textes formatés', () => {
    const text = {
      id: 't1',
      pageId: 'p1',
      authorId: 'prof',
      z: 2,
      x: 10,
      y: 10,
      type: 'text',
      w: 300,
      fs: 20,
      color: '#000000',
      blocks: [{ k: 'h1', runs: [{ s: 'Titre', b: true }] }, { k: 'p', runs: [{ s: 'x', i: true, c: '#ff0000' }] }],
    }
    expect(parseClientMessage(JSON.stringify({ t: 'ops', seq: 2, ops: [{ o: 'put', el: text }] }))).not.toBeNull()
    const huge = { ...text, blocks: [{ k: 'p', runs: [{ s: 'a'.repeat(15000) }, { s: 'b'.repeat(15000) }] }] }
    expect(parseClientMessage(JSON.stringify({ t: 'ops', seq: 2, ops: [{ o: 'put', el: huge }] }))).toBeNull()
  })
})
