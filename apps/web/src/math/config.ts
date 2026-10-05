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

type Keycap =
  | string
  | {
      latex?: string
      insert?: string
      label?: string
      width?: number
      class?: string
      tooltip?: string
      command?: string[]
    }

export interface KeyboardLayout {
  label: string
  tooltip: string
  rows: Keycap[][]
}

/**
 * Touche à affichage compact : `display` est rendu sur la touche (lisible, tient dans la case),
 * `insert` est inséré (avec ses champs vides). Sans cette séparation, une matrice 3×3 ou une
 * somme avec bornes déborde de sa touche.
 */
const k = (display: string, insert: string, tooltip?: string, cls?: 'small'): Keycap => ({
  latex: display,
  insert,
  ...(tooltip ? { tooltip } : {}),
  ...(cls ? { class: cls } : {}),
})

/** Fonction usuelle : libellé court, insère « \nom(□) ». */
const fn = (name: string): Keycap => ({ insert: `\\${name}(#0)`, label: name, class: 'small' })

const NAV_ROW: Keycap[] = [
  '[undo]',
  '[redo]',
  '[separator]',
  '[left]',
  '[right]',
  { label: '[backspace]', width: 1.5 },
  // Nouvelle ligne (comme Maj+Entrée) : rangée suivante dans un tableau, sinon formule sur plusieurs lignes.
  { label: '↵ ligne', command: ['performWithFeedback', 'addRowAfter'], width: 1.5, class: 'small', tooltip: 'Nouvelle ligne' },
  { label: '+ colonne', command: ['performWithFeedback', 'addColumnAfter'], width: 1.5, class: 'small', tooltip: 'Ajouter une colonne (matrice)' },
]

const SQ = '\\square'

export const KEYBOARD_LAYOUTS: KeyboardLayout[] = [
  {
    label: 'Analyse',
    tooltip: 'Sommes, intégrales, limites, dérivées',
    rows: [
      [
        k(`\\textstyle\\sum_{${SQ}}^{${SQ}}`, '\\sum_{#0}^{#0}', 'Somme'),
        k(`\\textstyle\\prod_{${SQ}}^{${SQ}}`, '\\prod_{#0}^{#0}', 'Produit'),
        k(`\\textstyle\\int_{${SQ}}^{${SQ}}`, '\\int_{#0}^{#0}', 'Intégrale'),
        k('\\textstyle\\iint', '\\iint_{#0}', 'Intégrale double'),
        k('\\lim', '\\lim_{#0\\to#0}', 'Limite'),
        '\\infty',
        '\\to',
        k(
          'f\\colon E\\to F',
          '\\begin{aligned}#0 : #0 &\\to #0\\\\ #0 &\\mapsto #0\\end{aligned}',
          'Définir une fonction (f : E → F, x ↦ f(x))',
          'small',
        ),
        fn('ln'),
        k(`e^{${SQ}}`, 'e^{#0}', 'Exponentielle'),
      ],
      [
        k(`\\tfrac{${SQ}}{${SQ}}`, '\\frac{#@}{#0}', 'Fraction'),
        k(`${SQ}^{${SQ}}`, '#@^{#0}', 'Puissance'),
        k(`${SQ}_{${SQ}}`, '#@_{#0}', 'Indice'),
        k(`\\sqrt{${SQ}}`, '\\sqrt{#0}', 'Racine carrée'),
        k(`\\sqrt[n]{${SQ}}`, '\\sqrt[#0]{#0}', 'Racine n-ième'),
        k(`|${SQ}|`, '\\left|#0\\right|', 'Valeur absolue'),
        k(`\\|${SQ}\\|`, '\\left\\lVert#0\\right\\rVert', 'Norme'),
        k(`\\lfloor ${SQ}\\rfloor`, '\\lfloor#0\\rfloor', 'Partie entière'),
        k(`(${SQ})`, '(#0)', 'Parenthèses'),
        k(`[${SQ}]`, '\\left[#0\\right]', 'Crochets'),
      ],
      [
        k("f'", "#@'", 'Dérivée'),
        k("f''", "#@''", 'Dérivée seconde'),
        k('\\tfrac{\\mathrm{d}}{\\mathrm{d}x}', '\\frac{\\mathrm{d}#0}{\\mathrm{d}#0}', 'Dérivée (notation de Leibniz)'),
        k('\\tfrac{\\partial}{\\partial x}', '\\frac{\\partial#0}{\\partial#0}', 'Dérivée partielle'),
        k('\\mathrm{d}x', '\\mathrm{d}#0', 'Élément différentiel'),
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
        k('\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}', '\\begin{pmatrix}#0&#0\\\\#0&#0\\end{pmatrix}', 'Matrice 2×2', 'small'),
        k('(\\vdots)_{3\\times3}', '\\begin{pmatrix}#0&#0&#0\\\\#0&#0&#0\\\\#0&#0&#0\\end{pmatrix}', 'Matrice 3×3'),
        k('\\begin{pmatrix}x\\\\y\\end{pmatrix}', '\\begin{pmatrix}#0\\\\#0\\end{pmatrix}', 'Vecteur colonne', 'small'),
        k('\\begin{cases}a\\\\b\\end{cases}', '\\begin{cases}#0\\\\#0\\end{cases}', 'Système à 2 lignes', 'small'),
        k('\\{\\vdots\\}_{3}', '\\begin{cases}#0\\\\#0\\\\#0\\end{cases}', 'Système à 3 lignes'),
        k('\\tbinom{n}{k}', '\\binom{#0}{#0}', 'Coefficient binomial'),
        k('n!', '#0!', 'Factorielle'),
        k('\\overrightarrow{AB}', '\\overrightarrow{#0}', 'Vecteur AB'),
        k('\\vec{u}', '\\vec{#0}', 'Vecteur'),
        k('\\hat{x}', '\\hat{#0}', 'Chapeau'),
      ],
      [
        k('\\bar{x}', '\\bar{#0}', 'Barre'),
        k('\\overline{AB}', '\\overline{#0}', 'Barre longue'),
        k('\\tilde{x}', '\\tilde{#0}', 'Tilde'),
        '\\times',
        '\\cdot',
        '\\pm',
        '\\circ',
        k('{}^{t}\\!A', '{}^{t}#0', 'Transposée'),
        k('A^{-1}', '#@^{-1}', 'Inverse'),
        k('\\det', '\\det(#0)', 'Déterminant'),
      ],
      [
        k('\\mathrm{rg}', '\\operatorname{rg}(#0)', 'Rang'),
        k('\\mathrm{Tr}', '\\operatorname{Tr}(#0)', 'Trace'),
        k('\\ker', '\\ker(#0)', 'Noyau'),
        k('\\mathrm{Im}', '\\operatorname{Im}(#0)', 'Image'),
        k('\\mathcal{M}_n', '\\mathcal{M}_{#0}(\\mathbb{R})', 'Matrices carrées réelles'),
        k('I_n', 'I_{#0}', 'Matrice identité'),
        '\\mathbb{K}',
        '\\equiv',
        '\\mapsto',
        '\\rightarrow',
      ],
      NAV_ROW,
    ],
  },
  {
    label: 'Ensembles',
    tooltip: 'Ensembles et logique',
    rows: [
      [
        '\\mathbb{N}',
        '\\mathbb{N}^{*}',
        '\\mathbb{Z}',
        '\\mathbb{Q}',
        '\\mathbb{R}',
        k('\\mathbb{R}_+^*', '\\mathbb{R}_{+}^{*}', 'Réels strictement positifs'),
        '\\emptyset',
        '\\in',
        '\\notin',
        '\\mid',
      ],
      [
        '\\subset',
        '\\subseteq',
        '\\not\\subset',
        '\\cup',
        '\\cap',
        '\\setminus',
        k(`\\{${SQ}\\}`, '\\left\\{#0\\right\\}', 'Ensemble'),
        k('[a,b]', '\\left[#0,#0\\right]', 'Intervalle fermé'),
        k(']a,b[', '\\left]#0,#0\\right[', 'Intervalle ouvert'),
        k('[\\![a,b]\\!]', '\\llbracket#0,#0\\rrbracket', 'Intervalle d’entiers'),
      ],
      ['\\forall', '\\exists', '\\exists!', '\\Rightarrow', '\\Leftarrow', '\\Leftrightarrow', '\\neg', '\\land', '\\lor', '\\times'],
      NAV_ROW,
    ],
  },
  {
    label: 'Probas/Stats',
    tooltip: 'Probabilités et statistiques',
    rows: [
      [
        k('\\mathbb{P}(A)', '\\mathbb{P}(#0)', 'Probabilité'),
        k('\\mathbb{E}(X)', '\\mathbb{E}(#0)', 'Espérance'),
        k('\\mathbb{V}(X)', '\\mathbb{V}(#0)', 'Variance'),
        k('\\mathrm{Cov}', '\\operatorname{Cov}(#0,#0)', 'Covariance'),
        k('\\mathbb{P}_B(A)', '\\mathbb{P}_{#0}(#0)', 'Probabilité conditionnelle'),
        k('\\mathbb{P}(A|B)', '\\mathbb{P}(#0\\mid#0)', 'Probabilité conditionnelle', 'small'),
        '\\sim',
        '\\bar{X}',
        k('\\overline{A}', '\\overline{#0}', 'Événement contraire'),
        '\\sigma',
      ],
      [
        k('\\mathcal{N}', '\\mathcal{N}(#0,#0)', 'Loi normale'),
        k('\\mathcal{B}', '\\mathcal{B}(#0,#0)', 'Loi binomiale'),
        k('\\mathcal{P}', '\\mathcal{P}(#0)', 'Loi de Poisson'),
        k('\\mathcal{U}', '\\mathcal{U}(#0)', 'Loi uniforme'),
        k('\\mathcal{E}', '\\mathcal{E}(#0)', 'Loi exponentielle'),
        k('\\mathcal{G}', '\\mathcal{G}(#0)', 'Loi géométrique'),
        k('\\tbinom{n}{k}', '\\binom{#0}{#0}', 'Coefficient binomial'),
        k('n!', '#0!', 'Factorielle'),
        '\\Omega',
        '\\omega',
      ],
      [
        'X',
        'Y',
        'Z',
        k('\\bar{X}_n', '\\bar{X}_{n}', 'Moyenne empirique'),
        'S_{n}',
        k('\\overset{\\mathcal{L}}{\\to}', '\\xrightarrow{\\mathcal{L}}', 'Convergence en loi'),
        k('\\overset{\\mathbb{P}}{\\to}', '\\xrightarrow{\\mathbb{P}}', 'Convergence en probabilité'),
        k('\\mathbf{1}_A', '\\mathbf{1}_{#0}', 'Indicatrice'),
        '\\cap',
        '\\cup',
      ],
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
    ['\\begin{aligned}', '\\begin{aligned} | : &\\to \\\\  &\\mapsto \\end{aligned}'],
    ['\\mapsto', '\\mapsto'],
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
