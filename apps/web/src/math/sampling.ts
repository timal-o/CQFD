/**
 * Échantillonnage adaptatif de y = f(x) sur une fenêtre : subdivise là où la courbe
 * s'écarte de la corde, coupe le tracé aux valeurs non définies et aux discontinuités
 * (asymptotes, sauts). Renvoie des polylignes en coordonnées du repère.
 */

export type Polyline = number[] // x0, y0, x1, y1, …

const MAX_DEPTH = 7

export function sampleFunction(
  f: (x: number) => number,
  xmin: number,
  xmax: number,
  ymin: number,
  ymax: number,
  steps = 240,
): Polyline[] {
  const yRange = ymax - ymin
  const tolerance = yRange * 0.0015
  const jump = yRange * 1.5
  const clampY = (y: number) => Math.max(ymin - 5 * yRange, Math.min(ymax + 5 * yRange, y))
  const safe = (x: number) => {
    try {
      const y = f(x)
      return typeof y === 'number' && Number.isFinite(y) ? y : NaN
    } catch {
      return NaN
    }
  }

  const lines: Polyline[] = []
  let current: Polyline = []
  const flush = () => {
    if (current.length >= 4) lines.push(current)
    current = []
  }
  const push = (x: number, y: number) => current.push(x, clampY(y))

  /** Traite l'intervalle ]x0, x1] (x0 déjà émis si défini). */
  const refine = (x0: number, y0: number, x1: number, y1: number, depth: number): void => {
    const d0 = !Number.isNaN(y0)
    const d1 = !Number.isNaN(y1)
    if (depth < MAX_DEPTH) {
      const xm = (x0 + x1) / 2
      const ym = safe(xm)
      const dm = !Number.isNaN(ym)
      const needs =
        d0 !== d1 ||
        d0 !== dm ||
        (d0 && d1 && dm && (Math.abs(ym - (y0 + y1) / 2) > tolerance || Math.abs(y1 - y0) > jump))
      if (needs) {
        refine(x0, y0, xm, ym, depth + 1)
        refine(xm, ym, x1, y1, depth + 1)
        return
      }
    }
    if (!d1) {
      flush()
      return
    }
    // Écart vertical encore net à la résolution maximale : discontinuité, on ne relie pas.
    if (d0 && depth >= MAX_DEPTH && Math.abs(y1 - y0) > yRange * 0.05) flush()
    push(x1, y1)
  }

  const dx = (xmax - xmin) / steps
  let x0 = xmin
  let y0 = safe(x0)
  if (!Number.isNaN(y0)) push(x0, y0)
  for (let i = 1; i <= steps; i++) {
    const x1 = xmin + i * dx
    const y1 = safe(x1)
    refine(x0, y0, x1, y1, 0)
    x0 = x1
    y0 = y1
  }
  flush()
  return lines
}

/** Pas de graduation « agréable » (1, 2, 5 × 10ⁿ) pour environ `target` intervalles. */
export function niceStep(range: number, target: number): number {
  const raw = range / Math.max(1, target)
  const pow = 10 ** Math.floor(Math.log10(raw))
  const n = raw / pow
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * pow
}
