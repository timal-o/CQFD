import katex from 'katex'
import 'katex/dist/katex.min.css'
import { normalizeLines } from './lines'

const cache = new Map<string, string>()
const MAX_CACHE = 500

/** Les champs vides de MathLive (`\placeholder{}`) deviennent des cases vides pour KaTeX. */
const PLACEHOLDER_RE = /\\placeholder(?:\[[^\]]*\])?\{[^{}]*\}/g

/**
 * Rendu KaTeX (HTML statique) mis en cache. `trust: false` interdit \href, \url,
 * \htmlClass… : le LaTeX venant d'un autre participant ne peut pas injecter de HTML actif.
 */
export function renderLatex(latex: string): string {
  // Lignes vides retirées d'abord (elles ne contiennent que des cases), puis cases restantes → □.
  latex = normalizeLines(latex).replace(PLACEHOLDER_RE, '\\square')
  const hit = cache.get(latex)
  if (hit !== undefined) return hit
  let html: string
  try {
    html = katex.renderToString(latex, {
      displayMode: true,
      throwOnError: false,
      trust: false,
      strict: 'ignore',
      maxSize: 50,
      maxExpand: 500,
      output: 'html',
    })
  } catch {
    html = ''
  }
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!)
  cache.set(latex, html)
  return html
}
