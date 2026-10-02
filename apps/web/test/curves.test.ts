import { beforeAll, describe, expect, it } from 'vitest'
import { curveFunction, loadMath } from '../src/math/curves'

beforeAll(() => loadMath())

describe('sécurité des courbes', () => {
  it.each(['x^2', '\\frac{1}{x}', '\\sin(x)', 'e^{-x}', '\\sqrt[3]{x}', '|x-1|', '2\\pi x', '\\ln(x)', '\\lfloor x\\rfloor'])(
    'accepte %s',
    (latex) => {
      expect(curveFunction(latex)).toBeTypeOf('function')
    },
  )

  it.each([
    'range(1, 10000000)',
    'ones(5000, 5000)',
    'zeros(3)',
    'random()',
    'factorial(x)',
    'g(x) = x',
    'import(x)',
    'y = [1, 2]',
    'x.foo',
    '"chaine"',
  ])('refuse %s', (latex) => {
    expect(curveFunction(latex)).toBeNull()
  })

  it('évalue correctement', () => {
    expect(curveFunction('x^2-2')!(3)).toBe(7)
    expect(curveFunction('\\sqrt{x}')!(-1)).toBeNaN()
  })
})
