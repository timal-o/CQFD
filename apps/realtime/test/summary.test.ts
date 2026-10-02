import { describe, expect, it } from 'vitest'
import type { BoardElement } from '@cqfd/shared'
import { summarize } from '../src/summary'

const el = (type: BoardElement['type'], id = 'x') => ({ id, type }) as BoardElement

describe('résumés du journal', () => {
  it('ajout, modification, effacement', () => {
    expect(summarize([{ before: null, after: el('formula') }])).toBe('a ajouté une formule')
    expect(summarize([{ before: el('text'), after: el('text') }])).toBe('a modifié un texte')
    expect(summarize([{ before: el('stroke'), after: null }, { before: el('stroke'), after: null }])).toBe('a effacé 2 traits')
    expect(summarize([{ before: null, after: el('stroke') }, { before: null, after: el('graph') }])).toBe('a ajouté 2 éléments')
  })

  it('gomme pixel', () => {
    expect(
      summarize([
        { before: el('stroke'), after: null },
        { before: null, after: el('stroke') },
        { before: null, after: el('stroke') },
      ]),
    ).toBe('a gommé un trait')
  })
})
