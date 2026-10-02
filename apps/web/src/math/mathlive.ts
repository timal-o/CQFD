import { KEYBOARD_LAYOUTS, type KeyboardLayout } from './config'

/** Les touches au contenu long (matrices, lois…) passent en petite taille pour tenir dans la touche. */
function compact(layout: KeyboardLayout) {
  return {
    ...layout,
    rows: layout.rows.map((row) =>
      row.map((key) => (typeof key === 'string' && !key.startsWith('[') && key.length > 14 ? { latex: key, class: 'small' } : key)),
    ),
  }
}

type MathLive = typeof import('mathlive')

let loading: Promise<MathLive> | null = null

/** Charge MathLive à la première édition de formule seulement (lazy-load). */
export function loadMathLive(): Promise<MathLive> {
  loading ??= import('mathlive').then((ml) => {
    // Les polices KaTeX sont déjà chargées par la feuille de style de KaTeX.
    ml.MathfieldElement.fontsDirectory = null
    ml.MathfieldElement.soundsDirectory = null
    const kb = window.mathVirtualKeyboard
    kb.layouts = [...KEYBOARD_LAYOUTS.map((l) => compact(l) as never), 'numeric', 'alphabetic']
    kb.editToolbar = 'none'
    return ml
  })
  return loading
}
