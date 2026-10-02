/**
 * Règles de droits, pures et partagées. Le serveur les applique (source de vérité),
 * le client les utilise seulement pour griser l'interface.
 */

export type Role = 'admin' | 'participant'

export interface Actor {
  id: string
  role: Role
  /** Participant à qui l'admin a donné la main. */
  canWrite: boolean
}

export interface RoomFlags {
  frozen: boolean
  laserForStudents: boolean
}

/** Les trois rôles du cahier des charges. */
export type RoleLabel = 'admin' | 'participant' | 'participant-avec-la-main'

export function roleLabel(actor: Actor): RoleLabel {
  if (actor.role === 'admin') return 'admin'
  return actor.canWrite ? 'participant-avec-la-main' : 'participant'
}

export const isAdmin = (actor: Actor) => actor.role === 'admin'

export function canWrite(actor: Actor, flags: RoomFlags): boolean {
  if (actor.role === 'admin') return true
  return actor.canWrite && !flags.frozen
}

export function canUseLaser(actor: Actor, flags: RoomFlags): boolean {
  if (actor.role === 'admin') return true
  return flags.laserForStudents && canWrite(actor, flags)
}

/** Peut-on modifier ou supprimer un élément existant ? */
export function canEditElement(actor: Actor, flags: RoomFlags, authorId: string): boolean {
  if (!canWrite(actor, flags)) return false
  return actor.role === 'admin' || authorId === actor.id
}

export type Check = { ok: true } | { ok: false; reason: string }

const ok: Check = { ok: true }
const deny = (reason: string): Check => ({ ok: false, reason })

export interface ExistingElement {
  authorId: string
  pageId: string
}

export interface PutCandidate {
  authorId: string
  pageId: string
}

/** Vérifie un `put` (création ou modification). */
export function checkPut(
  actor: Actor,
  flags: RoomFlags,
  el: PutCandidate,
  existing: ExistingElement | null,
): Check {
  if (!canWrite(actor, flags)) return deny(flags.frozen ? 'Tableau gelé' : "Vous n'avez pas la main")
  if (existing) {
    if (actor.role !== 'admin') {
      if (existing.authorId !== actor.id) return deny("Cet élément appartient à quelqu'un d'autre")
      if (el.authorId !== actor.id) return deny('Auteur invalide')
    }
    if (existing.pageId !== el.pageId) return deny("Un élément ne change pas de page")
    return ok
  }
  if (actor.role !== 'admin' && el.authorId !== actor.id) return deny('Auteur invalide')
  return ok
}

/** Vérifie une suppression. Supprimer un élément inexistant est accepté (idempotent). */
export function checkDel(actor: Actor, flags: RoomFlags, existing: ExistingElement | null): Check {
  if (!canWrite(actor, flags)) return deny(flags.frozen ? 'Tableau gelé' : "Vous n'avez pas la main")
  if (existing && !canEditElement(actor, flags, existing.authorId)) {
    return deny("Cet élément appartient à quelqu'un d'autre")
  }
  return ok
}
