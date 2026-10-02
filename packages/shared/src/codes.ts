/** Alphabet sans caractères ambigus (ni 0/O, ni 1/I). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 6

const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`)

type RandomFill = (buf: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>

const defaultFill: RandomFill = (buf) => crypto.getRandomValues(buf)

/** Code de salle aléatoire (32 symboles, tirage sans biais car 256 % 32 === 0). */
export function generateRoomCode(fill: RandomFill = defaultFill): string {
  const bytes = fill(new Uint8Array(CODE_LENGTH))
  let out = ''
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return out
}

/** Normalise une saisie : majuscules, sans espaces ni tirets. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '')
}

export function isValidCode(code: string): boolean {
  return CODE_RE.test(code)
}

/** Jeton aléatoire encodé en base64url (128 bits par défaut). */
export function randomToken(bytes = 16, fill: RandomFill = defaultFill): string {
  const buf = fill(new Uint8Array(bytes))
  let bin = ''
  for (const b of buf) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Identifiant court pour les éléments et les pages. */
export function randomId(): string {
  return randomToken(12)
}
