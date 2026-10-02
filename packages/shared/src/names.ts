import { LIMITS } from './limits'

// Caractères de contrôle, de formatage bidi et invisibles.
const STRIP_RE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g

/**
 * Nettoie un prénom saisi. L'échappement HTML est fait par React au rendu
 * (jamais d'innerHTML), on se contente ici de normaliser et de borner.
 */
export function sanitizeName(input: string): string {
  const cleaned = input.normalize('NFC').replace(STRIP_RE, '').replace(/\s+/g, ' ').trim()
  return Array.from(cleaned).slice(0, LIMITS.nameMaxLength).join('').trim()
}

/** Ajoute un suffixe « (2) », « (3) »… si le nom est déjà pris (insensible à la casse). */
export function dedupeName(name: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken, (n) => n.toLocaleLowerCase('fr')))
  if (!used.has(name.toLocaleLowerCase('fr'))) return name
  for (let i = 2; ; i++) {
    const suffix = ` (${i})`
    const candidate = Array.from(name).slice(0, LIMITS.nameMaxLength - suffix.length).join('') + suffix
    if (!used.has(candidate.toLocaleLowerCase('fr'))) return candidate
  }
}
