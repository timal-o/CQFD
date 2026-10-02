import { describe, expect, it } from 'vitest'
import type { StrokeElement } from '@cqfd/shared'
import { eraseFromStroke, hitStroke, makeStroke, scaleElement, simplify } from '../src/board/geometry'

const base = { id: 's', pageId: 'p', authorId: 'a', z: 1, tool: 'pen' as const, color: '#000000', size: 2 }

function line(x0: number, x1: number, y = 0): StrokeElement {
  const pts: number[] = []
  for (let x = x0; x <= x1; x += 5) pts.push(x, y, 0.5)
  return makeStroke(base, pts)
}

describe('géométrie des traits', () => {
  it('makeStroke rend les points relatifs à la boîte englobante', () => {
    const s = makeStroke(base, [10, 20, 0.5, 30, 40, 0.7])
    expect(s).toMatchObject({ x: 10, y: 20, pts: [0, 0, 0.5, 20, 20, 0.7] })
  })

  it('hitStroke détecte un point proche du segment', () => {
    const s = line(0, 100)
    expect(hitStroke(s, 50, 3, 3)).toBe(true)
    expect(hitStroke(s, 50, 30, 3)).toBe(false)
  })

  it('la gomme pixel coupe un trait en deux morceaux du même auteur', () => {
    const s = line(0, 100)
    const pieces = eraseFromStroke(s, 50, 0, 5)!
    expect(pieces).toHaveLength(2)
    for (const p of pieces) {
      expect(p.authorId).toBe('a')
      expect(p.id).not.toBe('s')
    }
    const [left, right] = pieces
    expect(left!.x + Math.max(...left!.pts.filter((_, i) => i % 3 === 0))).toBeLessThan(46)
    expect(right!.x).toBeGreaterThan(54)
  })

  it('la gomme pixel ne touche pas un trait éloigné', () => {
    expect(eraseFromStroke(line(0, 100), 50, 40, 5)).toBeNull()
  })

  it('gommer une extrémité laisse un seul morceau', () => {
    expect(eraseFromStroke(line(0, 100), 0, 0, 5)).toHaveLength(1)
  })

  it('simplify garde les extrémités', () => {
    const pts = [0, 0, 0.5, 0.1, 0, 0.5, 0.2, 0, 0.5, 10, 0, 0.5]
    expect(simplify(pts, 1)).toEqual([0, 0, 0.5, 10, 0, 0.5])
  })

  it('scaleElement agrandit autour du point fixe', () => {
    const s = makeStroke(base, [10, 10, 0.5, 20, 20, 0.5])
    const big = scaleElement(s, 0, 0, 2) as StrokeElement
    expect(big).toMatchObject({ x: 20, y: 20, size: 4, pts: [0, 0, 0.5, 20, 20, 0.5] })
  })
})
