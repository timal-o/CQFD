/**
 * Conversion du LaTeX d'une courbe (produit par MathLive ou tapé à la main) en expression
 * mathjs. Couvre l'usage scolaire : fractions, racines, puissances, valeur absolue,
 * fonctions usuelles, constantes. Renvoie null si l'expression n'est pas reconnue.
 */

const FUNCTIONS: Record<string, string> = {
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  arcsin: 'asin',
  arccos: 'acos',
  arctan: 'atan',
  sinh: 'sinh',
  cosh: 'cosh',
  tanh: 'tanh',
  ln: 'log',
  log: 'log10',
  exp: 'exp',
  sqrt: 'sqrt',
}

/** Lit un groupe `{…}` à partir de `i` (sur l'accolade ouvrante) ; renvoie le contenu et l'index suivant. */
function readGroup(s: string, i: number): [string, number] {
  if (s[i] !== '{') {
    // Argument d'un seul caractère (ex. \frac12, x^2).
    if (s[i] === '\\') {
      const m = s.slice(i).match(/^\\[A-Za-z]+/)
      if (m) return [m[0], i + m[0].length]
    }
    return [s[i] ?? '', i + 1]
  }
  let depth = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++
    else if (s[j] === '}') {
      depth--
      if (depth === 0) return [s.slice(i + 1, j), j + 1]
    }
  }
  throw new Error('accolade non fermée')
}

function convert(src: string): string {
  let out = ''
  let i = 0
  let absOpen = false
  while (i < src.length) {
    const c = src[i]!
    if (c === '\\') {
      const m = src.slice(i).match(/^\\([A-Za-z]+|.)/)!
      const name = m[1]!
      i += m[0].length
      switch (name) {
        case 'frac':
        case 'dfrac':
        case 'tfrac': {
          const [a, j] = readGroup(src, i)
          const [b, k] = readGroup(src, j)
          out += `((${convert(a)})/(${convert(b)}))`
          i = k
          break
        }
        case 'sqrt': {
          if (src[i] === '[') {
            const end = src.indexOf(']', i)
            const n = src.slice(i + 1, end)
            const [a, j] = readGroup(src, end + 1)
            out += `nthRoot(${convert(a)}, ${convert(n)})`
            i = j
          } else {
            const [a, j] = readGroup(src, i)
            out += `sqrt(${convert(a)})`
            i = j
          }
          break
        }
        case 'cdot':
        case 'times':
          out += '*'
          break
        case 'div':
          out += '/'
          break
        case 'pi':
          out += ' pi '
          break
        case 'infty':
          out += ' Infinity '
          break
        case 'left':
        case 'right':
        case 'mathrm':
        case 'operatorname':
          // \left( → (, \mathrm{e} → e, \operatorname{ch} → ch (géré par les fonctions)
          if (src[i] === '|' || (src[i] === '\\' && src[i + 1] === '|')) {
            out += absOpen ? ')' : 'abs('
            absOpen = !absOpen
            i += src[i] === '|' ? 1 : 2
          } else if (src[i] === '.') {
            i++
          } else if (src[i] === '\\' && (src[i + 1] === '{' || src[i + 1] === '}')) {
            out += src[i + 1] === '{' ? '(' : ')'
            i += 2
          } else if (src[i] === '{' && (name === 'mathrm' || name === 'operatorname')) {
            const [a, j] = readGroup(src, i)
            out += ` ${convert(a)} `
            i = j
          }
          break
        case 'lfloor':
          out += 'floor('
          break
        case 'rfloor':
          out += ')'
          break
        case 'lvert':
        case 'rvert':
        case 'vert':
        case '|':
          out += absOpen ? ')' : 'abs('
          absOpen = !absOpen
          break
        case ',':
        case ';':
        case '!':
        case ' ':
        case 'quad':
          out += ' '
          break
        case 'exponentialE':
          out += ' e '
          break
        default:
          if (FUNCTIONS[name]) {
            out += ` ${FUNCTIONS[name]}`
            // \sin x → sin(x) : argument sans parenthèses.
            const rest = src.slice(i)
            const arg = rest.match(/^\s*([0-9.]*[A-Za-z]|[0-9.]+)/)
            if (!/^\s*(\(|\\left|\^)/.test(rest) && arg) {
              out += `(${arg[1]})`
              i += arg[0].length
            }
          } else {
            throw new Error(`commande inconnue \\${name}`)
          }
      }
      continue
    }
    if (c === '^') {
      const [a, j] = readGroup(src, i + 1)
      out += `^(${convert(a)})`
      i = j
      continue
    }
    if (c === '_') {
      // Indices ignorés (ex. log_2 non géré) : on refuse plutôt que de tracer faux.
      throw new Error('indice non géré')
    }
    if (c === '{') {
      const [a, j] = readGroup(src, i)
      out += `(${convert(a)})`
      i = j
      continue
    }
    if (c === '|') {
      out += absOpen ? ')' : 'abs('
      absOpen = !absOpen
      i++
      continue
    }
    out += c
    i++
  }
  if (absOpen) throw new Error('valeur absolue non fermée')
  return out
}

export function latexToMath(latex: string): string | null {
  // On accepte « y = … » ou « f(x) = … ».
  const body = latex
    .replace(/\\placeholder(?:\[[^\]]*\])?\{[^{}]*\}/g, '')
    .replace(/^\s*(y|f\s*\(\s*x\s*\))\s*=\s*/, '')
    .trim()
  if (!body) return null
  try {
    return convert(body).replace(/\s+/g, ' ').trim()
  } catch {
    return null
  }
}
