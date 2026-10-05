/**
 * Formules sur plusieurs lignes. MathLive produit `\displaylines{a \\ b}` et le mode LaTeX brut
 * peut contenir `a \\ b` au niveau principal : KaTeX n'affiche ni l'un ni l'autre sur plusieurs
 * lignes en mode « display ». On les convertit en environnement `gathered`, qui, lui, fonctionne.
 */

/** Index de l'accolade fermante correspondant à l'ouvrante en `open`, ou -1. */
function matchingBrace(s: string, open: number): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '\\') {
      i++
      continue
    }
    if (s[i] === '{') depth++
    else if (s[i] === '}' && --depth === 0) return i
  }
  return -1
}

/** Y a-t-il un `\\` hors de tout groupe `{…}` et de tout environnement `\begin…\end` ? */
function hasTopLevelNewline(s: string): boolean {
  let braces = 0
  let envs = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\') {
      if (s.startsWith('\\begin{', i)) envs++
      else if (s.startsWith('\\end{', i)) envs--
      else if (s[i + 1] === '\\' && braces === 0 && envs === 0) return true
      i++
      continue
    }
    if (c === '{') braces++
    else if (c === '}') braces--
  }
  return false
}

/** Environnements multi-lignes dont on masque les lignes vides (les matrices gardent toutes leurs lignes). */
const ROW_ENVS = ['aligned', 'gathered', 'array', 'cases']

/** Une ligne « vide » : seulement des cases à remplir, des `&`, des espaces et des flèches ou deux-points. */
function isEmptyRow(row: string): boolean {
  const rest = row
    .replace(/\\placeholder(?:\[[^\]]*\])?\{[^{}]*\}/g, '')
    .replace(/\\(?:to|mapsto|longmapsto|rightarrow|longrightarrow|colon|quad|qquad)(?![A-Za-z])/g, '')
    .replace(/\\[,;:! ]/g, '')
    .replace(/[&:=\s]/g, '')
  return rest === ''
}

/** Découpe un corps d'environnement en lignes, sur les `\\` qui ne sont pas dans un groupe ou un sous-environnement. */
function splitRows(body: string): string[] {
  const rows: string[] = []
  let braces = 0
  let envs = 0
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '\\') {
      if (body.startsWith('\\begin{', i)) envs++
      else if (body.startsWith('\\end{', i)) envs--
      else if (body[i + 1] === '\\' && braces === 0 && envs === 0) {
        rows.push(body.slice(start, i))
        start = i + 2
      }
      i++
      continue
    }
    if (c === '{') braces++
    else if (c === '}') braces--
  }
  rows.push(body.slice(start))
  return rows
}

/** Retire les lignes vides des environnements multi-lignes (ex. « x ↦ … » laissé vide). */
function dropEmptyRows(latex: string): string {
  let out = latex
  for (const env of ROW_ENVS) {
    const open = `\\begin{${env}}`
    const close = `\\end{${env}}`
    let from = 0
    for (let at = out.indexOf(open, from); at !== -1; at = out.indexOf(open, from)) {
      let bodyStart = at + open.length
      // array : la spécification des colonnes {rcl} suit immédiatement.
      if (env === 'array' && out[bodyStart] === '{') bodyStart = matchingBrace(out, bodyStart) + 1
      const end = out.indexOf(close, bodyStart)
      if (end === -1 || bodyStart === 0) break
      const rows = splitRows(out.slice(bodyStart, end))
      const kept = rows.filter((r) => !isEmptyRow(r))
      const body = (kept.length ? kept : rows.slice(0, 1)).join('\\\\')
      out = out.slice(0, bodyStart) + body + out.slice(end)
      from = bodyStart + body.length + close.length
    }
  }
  return out
}

const MATRIX_ENVS = ['pmatrix', 'bmatrix', 'vmatrix', 'Vmatrix', 'matrix']

/** Cellules d'une ligne (séparées par les `&` hors groupes et sous-environnements). */
function splitCells(row: string): string[] {
  const cells: string[] = []
  let braces = 0
  let envs = 0
  let start = 0
  for (let i = 0; i < row.length; i++) {
    const c = row[i]
    if (c === '\\') {
      if (row.startsWith('\\begin{', i)) envs++
      else if (row.startsWith('\\end{', i)) envs--
      i++
      continue
    }
    if (c === '{') braces++
    else if (c === '}') braces--
    else if (c === '&' && braces === 0 && envs === 0) {
      cells.push(row.slice(start, i))
      start = i + 1
    }
  }
  cells.push(row.slice(start))
  return cells
}

/** Retire les colonnes de fin vides dans toutes les lignes (ex. après « + colonne » non remplie). */
function dropTrailingColumns(rows: string[]): string[] {
  const grid = rows.map(splitCells)
  const width = () => Math.max(...grid.map((r) => r.length))
  while (width() > 1 && grid.every((r) => r.length < width() || isEmptyRow(r[r.length - 1]!))) {
    const w = width()
    for (const r of grid) if (r.length === w) r.pop()
  }
  return grid.map((r) => r.join('&'))
}

/** Matrices : seules les lignes vides de fin disparaissent, et jamais si tout est vide (le modèle reste visible). */
function dropTrailingMatrixRows(latex: string): string {
  let out = latex
  for (const env of MATRIX_ENVS) {
    const open = `\\begin{${env}}`
    const close = `\\end{${env}}`
    let from = 0
    for (let at = out.indexOf(open, from); at !== -1; at = out.indexOf(open, from)) {
      const bodyStart = at + open.length
      const end = out.indexOf(close, bodyStart)
      if (end === -1) break
      const rows = splitRows(out.slice(bodyStart, end))
      let n = rows.length
      while (n > 1 && isEmptyRow(rows[n - 1]!)) n--
      const body = rows.every(isEmptyRow) ? rows.join('\\\\') : dropTrailingColumns(rows.slice(0, n)).join('\\\\')
      out = out.slice(0, bodyStart) + body + out.slice(end)
      from = bodyStart + body.length + close.length
    }
  }
  return out
}

export function normalizeLines(latex: string): string {
  let out = latex
  for (let at = out.indexOf('\\displaylines{'); at !== -1; at = out.indexOf('\\displaylines{')) {
    const open = at + '\\displaylines'.length
    const close = matchingBrace(out, open)
    if (close === -1) break
    out = `${out.slice(0, at)}\\begin{gathered}${out.slice(open + 1, close)}\\end{gathered}${out.slice(close + 1)}`
  }
  if (hasTopLevelNewline(out)) out = `\\begin{gathered}${out}\\end{gathered}`
  return dropTrailingMatrixRows(dropEmptyRows(out))
}

/** Systèmes et matrices qu'on prolonge avec Tab depuis leur dernière case. */
const GROWING_ENVS = ['cases', 'pmatrix', 'bmatrix', 'vmatrix', 'Vmatrix', 'matrix']

/** Le curseur est-il dans la dernière case d'un système ou d'une matrice (la position suivante en sort) ? */
export function atEnvEnd(before: string): boolean {
  const m = before.match(/\\end\{(\w+)\}\s*$/)
  return !!m && GROWING_ENVS.includes(m[1]!)
}

/**
 * `before` est le LaTeX qui précède immédiatement la sortie d'un environnement (il se termine par
 * `\end{…}`). Renvoie vrai si c'est un système ou une matrice dont la dernière ligne est remplie :
 * Tab doit alors ajouter une ligne au lieu de sortir. Une dernière ligne vide laisse sortir.
 */
export function shouldGrowOnTab(before: string): boolean {
  const m = before.match(/\\end\{(\w+)\}\s*$/)
  if (!m || !GROWING_ENVS.includes(m[1]!)) return false
  const env = m[1]!
  const start = before.lastIndexOf(`\\begin{${env}}`)
  if (start === -1) return false
  const body = before.slice(start + `\\begin{${env}}`.length, before.length - m[0].length)
  const rows = splitRows(body)
  return !isEmptyRow(rows[rows.length - 1] ?? '')
}
