import type { BoardElement, ElementType } from '@cqfd/shared'

const NOUNS: Record<ElementType, [singular: string, plural: string]> = {
  stroke: ['un trait', 'traits'],
  text: ['un texte', 'textes'],
  formula: ['une formule', 'formules'],
  graph: ['un repère', 'repères'],
  image: ['une image', 'images'],
}

function describe(types: ElementType[]): string {
  const first = types[0]!
  if (types.length === 1) return NOUNS[first][0]
  if (types.every((t) => t === first)) return `${types.length} ${NOUNS[first][1]}`
  return `${types.length} éléments`
}

export interface Change {
  before: BoardElement | null
  after: BoardElement | null
}

/** Résumé lisible d'un lot d'opérations pour le journal : « a ajouté une formule », « a gommé 2 traits »… */
export function summarize(changes: Change[]): string {
  const added: ElementType[] = []
  const modified: ElementType[] = []
  const removed: ElementType[] = []
  for (const { before, after } of changes) {
    if (!before && after) added.push(after.type)
    else if (before && after) modified.push(after.type)
    else if (before && !after) removed.push(before.type)
  }
  // Gomme pixel : des traits supprimés et remplacés par leurs morceaux.
  if (removed.length > 0 && added.length > 0 && modified.length === 0 && [...removed, ...added].every((t) => t === 'stroke')) {
    return `a gommé ${describe(removed)}`
  }
  const parts: string[] = []
  if (added.length) parts.push(`a ajouté ${describe(added)}`)
  if (modified.length) parts.push(`a modifié ${describe(modified)}`)
  if (removed.length) parts.push(`a effacé ${describe(removed)}`)
  return parts.join(', ') || 'a fait une modification'
}
