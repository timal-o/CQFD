import { randomToken } from '@cqfd/shared'

/**
 * Tout est en sessionStorage (aucun cookie, rien de persistant après fermeture de l'onglet).
 * Chaque accès est protégé : le stockage peut être indisponible (navigation privée stricte).
 */
function get(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function set(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // stockage indisponible : la reconnexion gardera moins bien l'identité
  }
}

const memory = new Map<string, string>()

export const session = {
  token(code: string): string {
    const key = `cqfd:session:${code}`
    let t = get(key) ?? memory.get(key) ?? null
    if (!t) {
      t = randomToken(16)
      set(key, t)
      memory.set(key, t)
    }
    return t
  },
  name(code: string): string | null {
    return get(`cqfd:name:${code}`)
  },
  setName(code: string, name: string): void {
    set(`cqfd:name:${code}`, name)
  },
  adminToken(code: string): string | null {
    return get(`cqfd:admin:${code}`) ?? memory.get(`cqfd:admin:${code}`) ?? null
  },
  setAdminToken(code: string, token: string): void {
    set(`cqfd:admin:${code}`, token)
    memory.set(`cqfd:admin:${code}`, token)
  },
  /** Demande l'ouverture du panneau de partage au prochain affichage (création de salle). */
  markShare(code: string): void {
    set(`cqfd:share:${code}`, '1')
  },
  takeShare(code: string): boolean {
    const v = get(`cqfd:share:${code}`) === '1'
    if (v) {
      try {
        sessionStorage.removeItem(`cqfd:share:${code}`)
      } catch {
        // ignoré
      }
    }
    return v
  },
}

/**
 * Lit le jeton admin dans le fragment (#admin=…), le range en sessionStorage
 * et le retire de l'URL affichée.
 */
export function captureAdminFragment(code: string): void {
  const match = location.hash.match(/(?:^#|&)admin=([A-Za-z0-9_-]{16,64})/)
  if (!match?.[1]) return
  session.setAdminToken(code, match[1])
  history.replaceState(null, '', location.pathname + location.search)
}

export const joinUrl = (code: string) => `${location.origin}/s/${code}`
export const adminUrl = (code: string, token: string) => `${location.origin}/s/${code}#admin=${token}`
