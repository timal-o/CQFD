import type { Curve, GraphElement } from '@cqfd/shared'
import { latexToMath } from './latexToMath'
import { sampleFunction, type Polyline } from './sampling'

type Compiled = (x: number) => number

let compileFn: ((expr: string) => { evaluate(scope: Record<string, number>): unknown }) | null = null
let loading: Promise<void> | null = null

/**
 * Liste blanche : une courbe venant d'un autre participant ne peut utiliser que x, des nombres,
 * π, e, les opérations de base et les fonctions usuelles. Sinon, une expression comme
 * `range(1, 1e7)` ou `ones(5000, 5000)` figerait le navigateur de toute la salle.
 */
const ALLOWED_FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh',
  'log', 'log10', 'exp', 'sqrt', 'nthRoot', 'abs', 'floor', 'ceil', 'round', 'sign',
])
const ALLOWED_SYMBOLS = new Set(['x', 'e', 'pi', 'Infinity', ...ALLOWED_FUNCTIONS])
const ALLOWED_OPERATORS = new Set(['add', 'subtract', 'multiply', 'divide', 'pow', 'unaryMinus', 'unaryPlus'])

interface ExprNode {
  type: string
  name?: string
  fn?: string | ExprNode
  value?: unknown
  traverse(cb: (node: ExprNode) => void): void
  compile(): { evaluate(scope: Record<string, number>): unknown }
}

function assertSafe(root: ExprNode): void {
  root.traverse((n) => {
    switch (n.type) {
      case 'ConstantNode':
        if (typeof n.value !== 'number') throw new Error('constante non numérique')
        return
      case 'SymbolNode':
        if (!ALLOWED_SYMBOLS.has(n.name ?? '')) throw new Error(`symbole interdit : ${n.name}`)
        return
      case 'OperatorNode':
        if (!ALLOWED_OPERATORS.has(n.fn as string)) throw new Error(`opérateur interdit : ${String(n.fn)}`)
        return
      case 'ParenthesisNode':
        return
      case 'FunctionNode': {
        const fn = n.fn as ExprNode
        if (fn.type !== 'SymbolNode' || !ALLOWED_FUNCTIONS.has(fn.name ?? '')) throw new Error('fonction interdite')
        return
      }
      default:
        throw new Error(`construction interdite : ${n.type}`)
    }
  })
}

/**
 * Charge mathjs à la demande (premier repère affiché). L'instance est bridée :
 * une expression ne peut ni importer, ni évaluer, ni redéfinir quoi que ce soit,
 * et seules les constructions de la liste blanche sont compilées.
 */
export function loadMath(): Promise<void> {
  loading ??= import('mathjs').then(({ create, all }) => {
    const math = create(all!, { predictable: true })
    const parse = math.parse.bind(math) as unknown as (expr: string) => ExprNode
    const compile = (expr: string) => {
      const node = parse(expr)
      assertSafe(node)
      return node.compile()
    }
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
