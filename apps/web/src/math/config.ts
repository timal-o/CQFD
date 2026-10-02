/**
 * Configuration de l'éditeur de formules : raccourcis de frappe, onglets du clavier
 * virtuel et commandes proposées en mode LaTeX brut. Tout se règle ici.
 *
 * Dans les insertions MathLive, `#0` et `#?` sont des champs vides (placeholders)
 * parcourus avec Tab ou les flèches, et `#@` reprend ce qui précède le curseur.
 */

/** Raccourcis de frappe (`inlineShortcuts` de MathLive). « / », « ^ » et « _ » sont natifs. */
export const INLINE_SHORTCUTS: Record<string, string> = {
  sum: '\\sum_{#?}^{#?}',
  prod: '\\prod_{#?}^{#?}',
  int: '\\int_{#?}^{#?}',
  iint: '\\iint_{#?}',
  lim: '\\lim_{#?\\to#?}',
  inf: '\\infty',
  sqrt: '\\sqrt{#?}',
  binom: '\\binom{#?}{#?}',
  abs: '\\left|#?\\right|',
  norm: '\\left\\lVert#?\\right\\rVert',
  vec: '\\overrightarrow{#?}',
  forall: '\\forall',
  exists: '\\exists',
  notin: '\\notin',
  '=>': '\\Rightarrow',
  '<=>': '\\Leftrightarrow',
  '<=': '\\leq',
  '>=': '\\geq',
  '!=': '\\neq',
  '->': '\\to',
  NN: '\\mathbb{N}',
  ZZ: '\\mathbb{Z}',
  QQ: '\\mathbb{Q}',
  RR: '\\mathbb{R}',
  CC: '\\mathbb{C}',
  PP: '\\mathbb{P}',
  EE: '\\mathbb{E}',
  VV: '\\mathbb{V}',
  alpha: '\\alpha',
  beta: '\\beta',
  gamma: '\\gamma',
  delta: '\\delta',
  epsilon: '\\varepsilon',
  lambda: '\\lambda',
  mu: '\\mu',
  sigma: '\\sigma',
  theta: '\\theta',
  omega: '\\omega',
  Omega: '\\Omega',
  phi: '\\varphi',
  pi: '\\pi',
}

type Keycap = string | { latex?: string; insert?: string; label?: string; width?: number; class?: string; tooltip?: string }

export interface KeyboardLayout {
  label: string
  tooltip: string
  rows: Keycap[][]
}

/** Fonction usuelle : libellé court, insère « \\nom(□) ». */
const fn = (name: string): Keycap => ({ insert: `\\${name}(#0)`, label: name, class: 'small' })

const NAV_ROW: Keycap[] = ['[undo]', '[redo]', '[separator]', '[left]', '[right]', { label: '[backspace]', width: 1.5 }]

export const KEYBOARD_LAYOUTS: KeyboardLayout[] = [
  {
    label: 'Analyse',
    tooltip: 'Sommes, intégrales, limites, dérivées',
    rows: [
      ['\\sum_{#0}^{#0}', '\\prod_{#0}^{#0}', '\\int_{#0}^{#0}', '\\iint_{#0}', { latex: '\\lim_{#0\\to#0}', class: 'small' }, '\\infty', '\\to', '\\mapsto', fn('ln'), 'e^{#0}'],
      ['\\frac{#@}{#0}', '#@^{#0}', '#@_{#0}', '\\sqrt{#0}', '\\sqrt[#0]{#0}', '\\left|#0\\right|', '\\left\\lVert#0\\right\\rVert', '\\lfloor#0\\rfloor', '(#0)', '\\left[#0\\right]'],
      [
        "#@'",
        "#@''",
        { latex: '\\frac{\\mathrm{d}#0}{\\mathrm{d}#0}', class: 'small' },
        { latex: '\\frac{\\partial#0}{\\partial#0}', class: 'small' },
        '\\mathrm{d}#0',
        fn('cos'),
        fn('sin'),
        fn('tan'),
        '\\pi',
        '\\varepsilon',
      ],
      NAV_ROW,
    ],
  },
  {
    label: 'Algèbre',
    tooltip: 'Matrices, systèmes, vecteurs, binômes',
    rows: [
      [
        { latex: '\\begin{pmatrix}#0&#0\\\\#0&#0\\end{pmatrix}', tooltip: 'Matrice 2×2', class: 'small' },
        { latex: '\\begin{pmatrix}#0&#0&#0\\\\#0&#0&#0\\\\#0&#0&#0\\end{pmatrix}', tooltip: 'Matrice 3×3', class: 'small' },
        { latex: '\\begin{pmatrix}#0\\\\#0\\end{pmatrix}', tooltip: 'Vecteur colonne', class: 'small' },
        { latex: '\\begin{cases}#0\\\\#0\\end{cases}', tooltip: 'Système à 2 lignes', class: 'small' },
        { latex: '\\begin{cases}#0\\\\#0\\\\#0\\end{cases}', tooltip: 'Système à 3 lignes', class: 'small' },
        '\\binom{#0}{#0}',
        '#0!',
        '\\overrightarrow{#0}',
        '\\vec{#0}',
        '\\hat{#0}',
      ],
      ['\\bar{#0}', '\\overline{#0}', '\\tilde{#0}', '\\times', '\\cdot', '\\pm', '\\circ', '{}^{t}#0', '#@^{-1}', '\\det(#0)'],
      ['\\operatorname{rg}(#0)', '\\operatorname{Tr}(#0)', '\\ker(#0)', '\\operatorname{Im}(#0)', '\\mathcal{M}_{#0}(\\mathbb{R})', 'I_{#0}', '\\mathbb{K}', '\\equiv', '\\leftarrow', '\\rightarrow'],
      NAV_ROW,
    ],
  },
  {
    label: 'Ensembles',
    tooltip: 'Ensembles et logique',
    rows: [
      ['\\mathbb{N}', '\\mathbb{Z}', '\\mathbb{Q}', '\\mathbb{R}', '\\mathbb{C}', '\\mathbb{R}_{+}^{*}', '\\emptyset', '\\in', '\\notin', '\\mid'],
      ['\\subset', '\\subseteq', '\\not\\subset', '\\cup', '\\cap', '\\setminus', '\\left\\{#0\\right\\}', '\\left[#0,#0\\right]', '\\left]#0,#0\\right[', '\\llbracket#0,#0\\rrbracket'],
      ['\\forall', '\\exists', '\\exists!', '\\Rightarrow', '\\Leftarrow', '\\Leftrightarrow', '\\neg', '\\land', '\\lor', '\\times'],
      NAV_ROW,
    ],
  },
  {
    label: 'Probas/Stats',
    tooltip: 'Probabilités et statistiques',
    rows: [
      ['\\mathbb{P}(#0)', '\\mathbb{E}(#0)', '\\mathbb{V}(#0)', '\\operatorname{Cov}(#0,#0)', '\\mathbb{P}_{#0}(#0)', '\\mathbb{P}(#0\\mid#0)', '\\sim', '\\bar{X}', '\\overline{#0}', '\\sigma'],
      ['\\mathcal{N}(#0,#0)', '\\mathcal{B}(#0,#0)', '\\mathcal{P}(#0)', '\\mathcal{U}(#0)', '\\mathcal{E}(#0)', '\\mathcal{G}(#0)', '\\binom{#0}{#0}', '#0!', '\\Omega', '\\omega'],
      ['X', 'Y', 'Z', '\\bar{X}_{n}', 'S_{n}', '\\xrightarrow{\\mathcal{L}}', '\\xrightarrow{\\mathbb{P}}', '\\mathbf{1}_{#0}', '\\cap', '\\cup'],
      NAV_ROW,
    ],
  },
  {
    label: 'Grec et relations',
    tooltip: 'Lettres grecques et relations',
    rows: [
      ['\\alpha', '\\beta', '\\gamma', '\\delta', '\\varepsilon', '\\zeta', '\\eta', '\\theta', '\\lambda', '\\mu'],
      ['\\nu', '\\xi', '\\pi', '\\rho', '\\sigma', '\\tau', '\\varphi', '\\chi', '\\psi', '\\omega'],
      ['\\Gamma', '\\Delta', '\\Theta', '\\Lambda', '\\Sigma', '\\Phi', '\\Psi', '\\Omega', '\\leq', '\\geq'],
      ['\\neq', '\\approx', '\\equiv', '\\sim', '\\simeq', '\\propto', '\\ll', '\\gg', '<', '>'],
      NAV_ROW,
    ],
  },
]

/**
 * Commandes proposées par l'autocomplétion du mode LaTeX brut. Dans les modèles,
 * `|` marque la position du curseur après insertion.
 */
export const LATEX_COMMANDS: { cmd: string; template: string }[] = [
  ...[
    ['\\frac', '\\frac{|}{}'],
    ['\\dfrac', '\\dfrac{|}{}'],
    ['\\sqrt', '\\sqrt{|}'],
    ['\\sum', '\\sum_{|}^{}'],
    ['\\prod', '\\prod_{|}^{}'],
    ['\\int', '\\int_{|}^{}'],
    ['\\iint', '\\iint_{|}'],
    ['\\lim', '\\lim_{| \\to }'],
    ['\\binom', '\\binom{|}{}'],
    ['\\left(', '\\left( | \\right)'],
    ['\\left|', '\\left| | \\right|'],
    ['\\left\\lVert', '\\left\\lVert | \\right\\rVert'],
    ['\\overrightarrow', '\\overrightarrow{|}'],
    ['\\overline', '\\overline{|}'],
    ['\\bar', '\\bar{|}'],
    ['\\hat', '\\hat{|}'],
    ['\\vec', '\\vec{|}'],
    ['\\tilde', '\\tilde{|}'],
    ['\\mathbb', '\\mathbb{|}'],
    ['\\mathcal', '\\mathcal{|}'],
    ['\\mathrm', '\\mathrm{|}'],
    ['\\operatorname', '\\operatorname{|}'],
    ['\\text', '\\text{|}'],
    ['\\begin{pmatrix}', '\\begin{pmatrix} | & \\\\  & \\end{pmatrix}'],
    ['\\begin{cases}', '\\begin{cases} | \\\\  \\end{cases}'],
    ['\\xrightarrow', '\\xrightarrow{|}'],
    ['\\ln', '\\ln(|)'],
    ['\\exp', '\\exp(|)'],
    ['\\cos', '\\cos(|)'],
    ['\\sin', '\\sin(|)'],
    ['\\tan', '\\tan(|)'],
  ].map(([cmd, template]) => ({ cmd: cmd!, template: template! })),
  ...[
    'infty', 'to', 'mapsto', 'partial', 'mathrm{d}', 'cdot', 'times', 'div', 'pm', 'circ',
    'leq', 'geq', 'neq', 'approx', 'equiv', 'sim', 'simeq', 'propto', 'll', 'gg',
    'in', 'notin', 'subset', 'subseteq', 'cup', 'cap', 'setminus', 'emptyset', 'forall', 'exists',
    'Rightarrow', 'Leftarrow', 'Leftrightarrow', 'neg', 'land', 'lor', 'mid', 'ldots', 'cdots', 'quad',
    'alpha', 'beta', 'gamma', 'delta', 'varepsilon', 'epsilon', 'zeta', 'eta', 'theta', 'lambda', 'mu',
    'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'varphi', 'phi', 'chi', 'psi', 'omega',
    'Gamma', 'Delta', 'Theta', 'Lambda', 'Sigma', 'Phi', 'Psi', 'Omega', 'det', 'ker',
  ].map((name) => ({ cmd: `\\${name}`, template: `\\${name}` })),
]
