import { describe, expect, it } from 'vitest'
import { atEnvEnd, normalizeLines, shouldGrowOnTab } from '../src/math/lines'

describe('formules sur plusieurs lignes', () => {
  it('\\displaylines (MathLive) devient gathered', () => {
    expect(normalizeLines('\\displaylines{a+b\\\\ c}')).toBe('\\begin{gathered}a+b\\\\ c\\end{gathered}')
  })

  it('un \\\\ au niveau principal (LaTeX brut) est enveloppé', () => {
    expect(normalizeLines('a+b \\\\ c')).toBe('\\begin{gathered}a+b \\\\ c\\end{gathered}')
  })

  it('les \\\\ déjà dans un environnement ou un groupe ne changent rien', () => {
    const arr = '\\begin{array}{rcl} f & \\to & g \\\\ x & \\mapsto & x^2 \\end{array}'
    expect(normalizeLines(arr)).toBe(arr)
    const cases = 'u_n=\\begin{cases}1\\\\2\\end{cases}'
    expect(normalizeLines(cases)).toBe(cases)
    expect(normalizeLines('x^2+1')).toBe('x^2+1')
  })

  it('une accolade non fermée ne boucle pas', () => {
    expect(normalizeLines('\\displaylines{a')).toBe('\\displaylines{a')
  })

  it('masque la ligne du bas d’une fonction laissée vide', () => {
    const fn = '\\begin{aligned}f : \\mathbb{R} &\\to \\mathbb{R}_{+}^{*}\\\\ \\placeholder{} &\\mapsto \\placeholder{}\\end{aligned}'
    expect(normalizeLines(fn)).toBe('\\begin{aligned}f : \\mathbb{R} &\\to \\mathbb{R}_{+}^{*}\\end{aligned}')
  })

  it('garde la ligne du bas dès qu’elle est remplie, même partiellement', () => {
    const full = '\\begin{aligned}f : \\mathbb{R} &\\to \\mathbb{R}\\\\ x &\\mapsto x^2\\end{aligned}'
    expect(normalizeLines(full)).toBe(full)
    const partial = '\\begin{aligned}f : E &\\to F\\\\ x &\\mapsto \\placeholder{}\\end{aligned}'
    expect(normalizeLines(partial)).toBe(partial)
  })

  it('système : les lignes vides disparaissent ; si tout est vide, une ligne reste', () => {
    expect(normalizeLines('\\begin{cases}x+y=1\\\\ \\placeholder{}\\\\ x-y=0\\end{cases}')).toBe(
      '\\begin{cases}x+y=1\\\\ x-y=0\\end{cases}',
    )
    expect(normalizeLines('\\begin{cases}\\placeholder{}\\\\\\placeholder{}\\end{cases}')).toBe('\\begin{cases}\\placeholder{}\\end{cases}')
  })

  it('lignes vides ajoutées avec Maj+Entrée : ignorées', () => {
    expect(normalizeLines('\\displaylines{a+b\\\\ }')).toBe('\\begin{gathered}a+b\\end{gathered}')
  })

  it('les matrices gardent toutes leurs lignes', () => {
    const m = '\\begin{pmatrix}\\placeholder{}&\\placeholder{}\\\\\\placeholder{}&\\placeholder{}\\end{pmatrix}'
    expect(normalizeLines(m)).toBe(m)
  })
})

describe('Tab au bout d’un système ou d’une matrice', () => {
  it('ajoute une ligne si la dernière est remplie', () => {
    expect(shouldGrowOnTab('A=\\begin{pmatrix}1 & 2\\\\ 3 & 4\\end{pmatrix}')).toBe(true)
    expect(shouldGrowOnTab('\\begin{cases}x=1\\\\ y=2\\end{cases}')).toBe(true)
  })

  it('laisse sortir si la dernière ligne est vide (on a fini)', () => {
    expect(shouldGrowOnTab('\\begin{pmatrix}1 & 2\\\\ \\placeholder{} & \\placeholder{}\\end{pmatrix}')).toBe(false)
    expect(shouldGrowOnTab('\\begin{cases}x=1\\\\ \\placeholder{}\\end{cases}')).toBe(false)
  })

  it('détecte la dernière case', () => {
    expect(atEnvEnd('A=\\begin{pmatrix}1 & 2\\\\ 3 & 4\\end{pmatrix}')).toBe(true)
    expect(atEnvEnd('A=123')).toBe(false)
    expect(atEnvEnd('\\begin{aligned}a\\end{aligned}')).toBe(false)
  })

  it('ne concerne que les systèmes et matrices', () => {
    expect(shouldGrowOnTab('\\begin{aligned}f &\\to g\\end{aligned}')).toBe(false)
    expect(shouldGrowOnTab('\\frac{1}{2}')).toBe(false)
  })
})

describe('matrices : affichage', () => {
  it('affichage : lignes vides de fin masquées, modèle vide laissé intact', () => {
    expect(normalizeLines('\\begin{pmatrix}1&2\\\\3&4\\\\\\placeholder{}&\\placeholder{}\\end{pmatrix}')).toBe(
      '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}',
    )
    const empty = '\\begin{pmatrix}\\placeholder{}&\\placeholder{}\\\\\\placeholder{}&\\placeholder{}\\end{pmatrix}'
    expect(normalizeLines(empty)).toBe(empty)
  })

  it('affichage : colonne de fin vide (« + colonne » non remplie) masquée', () => {
    expect(normalizeLines('\\begin{pmatrix}1 & 2 & \\\\ 3 & 4 & \\end{pmatrix}')).toBe('\\begin{pmatrix}1 & 2 \\\\ 3 & 4 \\end{pmatrix}')
    const filled = '\\begin{pmatrix}1 & 2 & 7\\\\ 3 & 4 & \\end{pmatrix}'
    expect(normalizeLines(filled)).toBe(filled)
  })
})
