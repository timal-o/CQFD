import { describe, expect, it } from 'vitest'
import { recognizeShape, snapLineEnd, type Pt } from '../src/board/shapes'

/** Petit bruit déterministe, comme une main qui tremble. */
const noise = (i: number, amp: number) => Math.sin(i * 12.9898) * amp

function ellipse(cx: number, cy: number, a: number, b: number, n = 80, amp = 2, turn = 1): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * Math.PI * 2 * turn
    return [cx + a * Math.cos(t) + noise(i, amp), cy + b * Math.sin(t) + noise(i + 7, amp)] as Pt
  })
}

function polyline(corners: Pt[], perEdge = 20, amp = 1.5): Pt[] {
  const out: Pt[] = []
  for (let k = 0; k < corners.length - 1; k++) {
    const [a, b] = [corners[k]!, corners[k + 1]!]
    for (let i = 0; i < perEdge; i++) {
      const t = i / perEdge
      out.push([a[0] + t * (b[0] - a[0]) + noise(out.length, amp), a[1] + t * (b[1] - a[1]) + noise(out.length + 3, amp)])
    }
  }
  out.push(corners[corners.length - 1]!)
  return out
}

describe('reconnaissance de formes', () => {
  it('cercle', () => {
    const s = recognizeShape(ellipse(100, 100, 60, 58))
    expect(s?.kind).toBe('circle')
  })

  it('ellipse', () => {
    expect(recognizeShape(ellipse(0, 0, 120, 50))?.kind).toBe('ellipse')
  })

  it('rectangle (redressé)', () => {
    const s = recognizeShape(polyline([[0, 0], [200, 4], [198, 100], [-3, 98], [2, 3]]))
    expect(s?.kind).toBe('rectangle')
    const ys = s!.points.map((p) => Math.round(p[1]))
    // Côtés horizontaux : deux valeurs de y seulement.
    expect(new Set(ys).size).toBe(2)
  })

  it('triangle', () => {
    expect(recognizeShape(polyline([[0, 100], [60, 0], [120, 100], [2, 98]]))?.kind).toBe('triangle')
  })

  it('trait droit', () => {
    const s = recognizeShape(polyline([[0, 0], [200, 60]], 40, 2))
    expect(s?.kind).toBe('line')
    expect(s?.points).toHaveLength(2)
  })

  it('gribouillis ou arc ouvert : pas de forme', () => {
    const scribble: Pt[] = Array.from({ length: 60 }, (_, i) => [i * 5, Math.sin(i / 2) * 40 + noise(i, 10)])
    expect(recognizeShape(scribble)).toBeNull()
    expect(recognizeShape(ellipse(0, 0, 80, 80, 40, 1, 0.5))).toBeNull()
    // Vague douce : ce n'est pas un trait droit.
    const wave: Pt[] = Array.from({ length: 30 }, (_, i) => [i * 25, Math.sin(i / 3) * 40])
    expect(recognizeShape(wave)).toBeNull()
  })

  it('trop petit : rien', () => {
    expect(recognizeShape([[0, 0], [2, 1], [3, 3], [1, 4], [0, 0]])).toBeNull()
  })
})

describe('trait droit avec Maj', () => {
  it('s’aligne sur l’horizontale, la verticale et 45° à proximité', () => {
    const h = snapLineEnd([0, 0], [100, 4])
    expect(h[1]).toBeCloseTo(0)
    const v = snapLineEnd([0, 0], [3, 100])
    expect(v[0]).toBeCloseTo(0)
    const d = snapLineEnd([0, 0], [100, 96])
    expect(d[0]).toBeCloseTo(d[1])
    const free = snapLineEnd([0, 0], [100, 30])
    expect(free[1]).toBeCloseTo(30)
  })
})
