import type { TextBlock, TextRun } from '@cqfd/shared'

/**
 * Conversion entre le DOM d'un éditeur `contentEditable` et le modèle de texte
 * (blocs + passages formatés). Le modèle est la seule chose envoyée et stockée :
 * aucun HTML ne circule, donc pas de XSS possible au rendu.
 */

type Fmt = { b: boolean; i: boolean; c?: string }

const BLOCK_TAGS = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE'])

function toHex(color: string): string | undefined {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    return '#' + color.slice(1).split('').map((c) => c + c).join('').toLowerCase()
  }
  const m = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!m) return undefined
  return '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')
}

function blockKind(tag: string): TextBlock['k'] {
  if (tag === 'H1') return 'h1'
  if (/^H[2-6]$/.test(tag)) return 'h2'
  return 'p'
}

export function domToBlocks(root: HTMLElement, defaultColor: string): TextBlock[] {
  const blocks: TextBlock[] = []
  let cur: TextBlock | null = null

  const push = (s: string, fmt: Fmt, kind: TextBlock['k']) => {
    if (!cur) {
      cur = { k: kind, runs: [] }
      blocks.push(cur)
    }
    const run: TextRun = { s }
    if (fmt.b) run.b = true
    if (fmt.i) run.i = true
    if (fmt.c && fmt.c !== defaultColor) run.c = fmt.c
    const prev = cur.runs[cur.runs.length - 1]
    if (prev && prev.b === run.b && prev.i === run.i && prev.c === run.c) prev.s += s
    else cur.runs.push(run)
  }

  const walk = (node: Node, fmt: Fmt, kind: TextBlock['k']) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const s = (node.textContent ?? '').replace(/ /g, ' ').replace(/[\r\n]+/g, ' ')
      if (s) push(s, fmt, kind)
      return
    }
    if (!(node instanceof HTMLElement)) return
    const tag = node.tagName
    if (tag === 'BR') {
      // Un <br> final dans un bloc est un artefact du navigateur, pas une ligne.
      if (node.nextSibling === null && node.parentElement !== root) return
      if (!cur) {
        cur = { k: kind, runs: [] }
        blocks.push(cur)
      }
      cur = { k: cur.k, runs: [] }
      blocks.push(cur)
      return
    }
    if (BLOCK_TAGS.has(tag)) {
      const k = tag === 'DIV' || tag === 'P' ? (node.parentElement === root ? 'p' : kind) : blockKind(tag)
      cur = { k, runs: [] }
      blocks.push(cur)
      for (const child of node.childNodes) walk(child, fmt, k)
      cur = null
      return
    }
    const next: Fmt = { ...fmt }
    if (tag === 'B' || tag === 'STRONG') next.b = true
    if (tag === 'I' || tag === 'EM') next.i = true
    const style = node.style
    if (style.fontWeight === 'bold' || Number(style.fontWeight) >= 600) next.b = true
    if (style.fontWeight === 'normal' || style.fontWeight === '400') next.b = false
    if (style.fontStyle === 'italic') next.i = true
    const color = (tag === 'FONT' ? node.getAttribute('color') : null) ?? style.color
    if (color) next.c = toHex(color) ?? next.c
    for (const child of node.childNodes) walk(child, next, kind)
  }

  for (const child of root.childNodes) walk(child, { b: false, i: false }, 'p')

  for (const b of blocks) b.runs = b.runs.filter((r) => r.s.length > 0)
  while (blocks.length > 0 && blocks[blocks.length - 1]!.runs.length === 0) blocks.pop()
  return blocks
}

/** Construit le DOM d'édition à partir du modèle (createElement, jamais innerHTML). */
export function fillEditor(root: HTMLElement, blocks: TextBlock[]): void {
  root.replaceChildren()
  const list = blocks.length > 0 ? blocks : [{ k: 'p' as const, runs: [] }]
  for (const block of list) {
    const el = document.createElement(block.k === 'p' ? 'div' : block.k)
    if (block.runs.length === 0) el.appendChild(document.createElement('br'))
    for (const run of block.runs) {
      let node: Node = document.createTextNode(run.s)
      if (run.c) {
        const span = document.createElement('span')
        span.style.color = run.c
        span.appendChild(node)
        node = span
      }
      if (run.i) {
        const i = document.createElement('i')
        i.appendChild(node)
        node = i
      }
      if (run.b) {
        const b = document.createElement('b')
        b.appendChild(node)
        node = b
      }
      el.appendChild(node)
    }
    root.appendChild(el)
  }
}
