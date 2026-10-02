import type { Curve, GraphElement } from '@cqfd/shared'
import { latexToMath } from './latexToMath'
import { sampleFunction, type Polyline } from './sampling'

type Compiled = (x: number) => number

let compileFn: ((expr: string) => { evaluate(scope: Record<string, number>): unknown }) | null = null
let loading: Promise<void> | null = null

/**
 * Charge mathjs à la demande (premier repère affiché). L'instance est bridée :
 * une expression ne peut ni importer, ni évaluer, ni redéfinir quoi que ce soit.
 */
export function loadMath(): Promise<void> {
  loading ??= import('mathjs').then(({ create, all }) => {
    const math = create(all!, { predictable: true })
    const compile = math.compile.bind(math)
    const forbidden = () => {
      throw new Error('fonction désactivée')
    }
    math.import(
      {
        import: forbidden,
        createUnit: forbidden,
        evaluate: forbidden,
        parse: forbidden,
        compile: forbidden,
        simplify: forbidden,
        derivative: forbidden,
        resolve: forbidden,
        reviver: forbidden,
      },
      { override: true },
    )
    compileFn = compile
  })
  return loading
}

const compiled = new Map<string, Compiled | null>()

/** Fonction compilée d'une courbe (une seule fois par source), null si non reconnue, undefined si mathjs n'est pas chargé. */
export function curveFunction(latex: string): Compiled | null | undefined {
  if (compiled.has(latex)) return compiled.get(latex)
  if (!compileFn) return undefined
  let fn: Compiled | null = null
  const expr = latexToMath(latex)
  if (expr) {
    try {
      const code = compileFn(expr)
      fn = (x: number) => {
        const y = code.evaluate({ x })
        return typeof y === 'number' ? y : NaN
      }
      fn(0.5) // détecte les erreurs de symbole (variable inconnue…)
    } catch {
      fn = null
    }
  }
  compiled.set(latex, fn)
  return fn
}

const samples = new WeakMap<GraphElement, Map<string, Polyline[]>>()

/**
 * Points d'une courbe, recalculés seulement quand l'élément change (expression ou fenêtre) :
 * l'élément est remplacé à chaque modification, donc le cache par objet suffit.
 */
export function curveSamples(el: GraphElement, curve: Curve): Polyline[] | undefined {
  let byCurve = samples.get(el)
  if (!byCurve) {
    byCurve = new Map()
    samples.set(el, byCurve)
  }
  const hit = byCurve.get(curve.id)
  if (hit) return hit
  const fn = curveFunction(curve.latex)
  if (fn === undefined) return undefined
  const lines = fn ? sampleFunction(fn, el.xmin, el.xmax, el.ymin, el.ymax, Math.max(120, Math.min(600, Math.round(el.w / 2)))) : []
  byCurve.set(curve.id, lines)
  return lines
}

/** La courbe est-elle traçable ? (pour l'éditeur) */
export function curveStatus(latex: string): 'ok' | 'invalid' | 'loading' | 'empty' {
  if (!latex.trim()) return 'empty'
  const fn = curveFunction(latex)
  return fn === undefined ? 'loading' : fn ? 'ok' : 'invalid'
}
