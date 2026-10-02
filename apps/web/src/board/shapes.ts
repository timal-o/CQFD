/**
 * Reconnaissance de formes à main levée (geste terminé en restant immobile) :
 * trait, cercle, ellipse, rectangle, triangle, polygone. Logique pure, testée.
 */

export type Pt = [number, number]

export type ShapeKind = 'line' | 'circle' | 'ellipse' | 'rectangle' | 'triangle' | 'polygon'

export interface Shape {
  kind: ShapeKind
  /** Polyligne propre ; une forme fermée répète son premier point à la fin. */
  points: Pt[]
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])

function pathLength(pts: Pt[]): number {
  let n = 0
  for (let i = 1; i < pts.length; i++) n += dist(pts[i - 1]!, pts[i]!)
  return n
}

function pointSegDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = dx * dx + dy * dy
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len))
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1])
}

/** Rééchantillonne uniformément le long du tracé (la vitesse du geste ne compte plus). */
function resample(pts: Pt[], n: number): Pt[] {
  const total = pathLength(pts)
  if (total === 0) return [pts[0]!]
  const step = total / (n - 1)
  const out: Pt[] = [pts[0]!]
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1]!
    const b = pts[i]!
    let d = dist(a, b)
    while (acc + d >= step && out.length < n) {
      const t = (step - acc) / d
      const p: Pt = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
      out.push(p)
      a = p
      d = dist(a, b)
      acc = 0
    }
    acc += d
  }
  while (out.length < n) out.push(pts[pts.length - 1]!)
  return out
}

/** Ramer-Douglas-Peucker sur une polyligne ouverte. */
function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts
  let maxD = 0
  let idx = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointSegDist(pts[i]!, pts[0]!, pts[pts.length - 1]!)
    if (d > maxD) {
      maxD = d
      idx = i
    }
  }
  if (maxD <= eps) return [pts[0]!, pts[pts.length - 1]!]
  const left = rdp(pts.slice(0, idx + 1), eps)
  const right = rdp(pts.slice(idx), eps)
  return [...left.slice(0, -1), ...right]
}

/** Coins d'une forme fermée : on coupe au point le plus éloigné du départ, puis RDP sur chaque moitié. */
function closedCorners(pts: Pt[], eps: number): Pt[] {
  let far = 0
  for (let i = 1; i < pts.length; i++) if (dist(pts[i]!, pts[0]!) > dist(pts[far]!, pts[0]!)) far = i
  const a = rdp(pts.slice(0, far + 1), eps)
  const b = rdp([...pts.slice(far), pts[0]!], eps)
  let corners = [...a.slice(0, -1), ...b.slice(0, -1)]
  // Fusionne les coins quasi alignés (le point de départ n'est pas forcément un coin).
  let changed = true
  while (changed && corners.length > 3) {
    changed = false
    for (let i = 0; i < corners.length; i++) {
      const prev = corners[(i - 1 + corners.length) % corners.length]!
      const next = corners[(i + 1) % corners.length]!
      if (pointSegDist(corners[i]!, prev, next) < eps) {
        corners = corners.filter((_, j) => j !== i)
        changed = true
        break
      }
    }
  }
  return corners
}

function polygonError(pts: Pt[], corners: Pt[]): number {
  let sum = 0
  for (const p of pts) {
    let best = Infinity
    for (let i = 0; i < corners.length; i++) best = Math.min(best, pointSegDist(p, corners[i]!, corners[(i + 1) % corners.length]!))
    sum += best
  }
  return sum / pts.length
}

const DEG = Math.PI / 180

/** Angle ramené sur l'axe le plus proche s'il en est à moins de `tol`. */
function snapAngle(theta: number, step: number, tol: number): number {
  const snapped = Math.round(theta / step) * step
  return Math.abs(theta - snapped) < tol ? snapped : theta
}

/** Fin d'un trait droit (Maj) : alignée sur 0°, 45°, 90°… si on en est proche. */
export function snapLineEnd(start: Pt, end: Pt): Pt {
  const len = dist(start, end)
  const theta = snapAngle(Math.atan2(end[1] - start[1], end[0] - start[0]), 45 * DEG, 5 * DEG)
  return [start[0] + len * Math.cos(theta), start[1] + len * Math.sin(theta)]
}

function ellipsePoints(cx: number, cy: number, a: number, b: number, theta: number, n = 72): Pt[] {
  const out: Pt[] = []
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2
    const x = a * Math.cos(t)
    const y = b * Math.sin(t)
    out.push([cx + x * c - y * s, cy + x * s + y * c])
  }
  return out
}

export function recognizeShape(raw: Pt[]): Shape | null {
  if (raw.length < 4) return null
  const xs = raw.map((p) => p[0])
  const ys = raw.map((p) => p[1])
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  if (diag < 12) return null
  const start = raw[0]!
  const end = raw[raw.length - 1]!

  // Forme ouverte : seul le trait droit est reconnu.
  if (dist(start, end) > 0.25 * diag) {
    const len = dist(start, end)
    const maxDev = Math.max(...raw.map((p) => pointSegDist(p, start, end)))
    return maxDev < 0.035 * len + 3 ? { kind: 'line', points: [start, snapLineEnd(start, end)] } : null
  }

  const pts = resample(raw, 96)

  // Ellipse par analyse en composantes principales : variance le long d'un axe = rayon² / 2.
  const n = pts.length
  const mx = pts.reduce((s, p) => s + p[0], 0) / n
  const my = pts.reduce((s, p) => s + p[1], 0) / n
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2
    syy += (y - my) ** 2
    sxy += (x - mx) * (y - my)
  }
  sxx /= n
  syy /= n
  sxy /= n
  const half = (sxx + syy) / 2
  const root = Math.sqrt(Math.max(0, half * half - (sxx * syy - sxy * sxy)))
  const a = Math.sqrt(2 * (half + root))
  const b = Math.sqrt(2 * Math.max(1e-9, half - root))
  let theta = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  let ellipseErr = 0
  for (const [x, y] of pts) {
    const u = (x - mx) * c + (y - my) * s
    const v = -(x - mx) * s + (y - my) * c
    ellipseErr += Math.abs(Math.hypot(u / a, v / b) - 1)
  }
  ellipseErr = (ellipseErr / n) * Math.sqrt(a * b)

  const corners = closedCorners(pts, 0.08 * diag)
  const polyErr = corners.length >= 3 && corners.length <= 6 ? polygonError(pts, corners) : Infinity

  if (polyErr < ellipseErr && polyErr < 0.045 * diag) {
    if (corners.length === 4) {
      const angles = corners.map((p, i) => {
        const prev = corners[(i + 3) % 4]!
        const next = corners[(i + 1) % 4]!
        const v1 = [prev[0] - p[0], prev[1] - p[1]]
        const v2 = [next[0] - p[0], next[1] - p[1]]
        return Math.acos((v1[0]! * v2[0]! + v1[1]! * v2[1]!) / (Math.hypot(v1[0]!, v1[1]!) * Math.hypot(v2[0]!, v2[1]!)))
      })
      if (angles.every((ang) => Math.abs(ang - Math.PI / 2) < 22 * DEG)) {
        // Rectangle orienté selon le côté le plus long, redressé s'il est presque horizontal.
        let best = 0
        for (let i = 1; i < 4; i++) {
          if (dist(corners[i]!, corners[(i + 1) % 4]!) > dist(corners[best]!, corners[(best + 1) % 4]!)) best = i
        }
        const p0 = corners[best]!
        const p1 = corners[(best + 1) % 4]!
        const phi = snapAngle(Math.atan2(p1[1] - p0[1], p1[0] - p0[0]), 90 * DEG, 10 * DEG)
        const ux: Pt = [Math.cos(phi), Math.sin(phi)]
        const uy: Pt = [-ux[1], ux[0]]
        const proj = (p: Pt, u: Pt) => (p[0] - mx) * u[0] + (p[1] - my) * u[1]
        const pu = corners.map((p) => proj(p, ux))
        const pv = corners.map((p) => proj(p, uy))
        const [u0, u1, v0, v1] = [Math.min(...pu), Math.max(...pu), Math.min(...pv), Math.max(...pv)]
        const at = (u: number, v: number): Pt => [mx + u * ux[0] + v * uy[0], my + u * ux[1] + v * uy[1]]
        const rect = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)]
        return { kind: 'rectangle', points: [...rect, rect[0]!] }
      }
    }
    return { kind: corners.length === 3 ? 'triangle' : 'polygon', points: [...corners, corners[0]!] }
  }

  if (ellipseErr < 0.05 * diag) {
    if (a / b < 1.2) {
      const r = (a + b) / 2
      return { kind: 'circle', points: ellipsePoints(mx, my, r, r, 0) }
    }
    theta = snapAngle(theta, 90 * DEG, 10 * DEG)
    return { kind: 'ellipse', points: ellipsePoints(mx, my, a, b, theta) }
  }
  return null
}
