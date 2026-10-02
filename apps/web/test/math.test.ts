import { describe, expect, it } from 'vitest'
import { latexToMath } from '../src/math/latexToMath'
import { niceStep, sampleFunction } from '../src/math/sampling'

describe('LaTeX → mathjs', () => {
  it.each([
    ['x^2', 'x^(2)'],
    ['y=x^{2}-1', 'x^(2)-1'],
    ['f(x)=\\frac{1}{x}', '((1)/(x))'],
    ['\\sqrt{x+1}', 'sqrt(x+1)'],
    ['\\sqrt[3]{x}', 'nthRoot(x, 3)'],
    ['\\left|x\\right|', 'abs(x)'],
    ['|x-1|', 'abs(x-1)'],
    ['\\sin\\left(x\\right)', 'sin(x)'],
    ['\\sin x', 'sin(x)'],
    ['\\ln(x)', 'log(x)'],
    ['e^{-x}', 'e^(-x)'],
    ['2\\cdot\\pi x', '2* pi x'],
    ['\\exponentialE^{x}', 'e ^(x)'],
    ['\\lfloor x\\rfloor', 'floor( x)'],
  ])('%s', (latex, expected) => {
    expect(latexToMath(latex)).toBe(expected)
  })

  it('refuse ce qui ne se trace pas', () => {
    expect(latexToMath('')).toBeNull()
    expect(latexToMath('\\int_0^1 x')).toBeNull()
    expect(latexToMath('\\frac{1}{x')).toBeNull()
    expect(latexToMath('|x')).toBeNull()
  })
})

describe('échantillonnage', () => {
  it('une droite donne une seule polyligne', () => {
    const lines = sampleFunction((x) => 2 * x, -5, 5, -10, 10)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.slice(0, 2)).toEqual([-5, -10])
  })

  it('1/x est coupée en deux à l’asymptote', () => {
    const lines = sampleFunction((x) => 1 / x, -5, 5, -5, 5)
    expect(lines).toHaveLength(2)
    const left = lines[0]!
    expect(left[left.length - 2]).toBeLessThan(0)
    expect(lines[1]![0]).toBeGreaterThan(0)
  })

  it('sqrt(x) n’est tracée que là où elle est définie', () => {
    const lines = sampleFunction(Math.sqrt, -5, 5, -1, 3)
    expect(lines).toHaveLength(1)
    expect(lines[0]![0]).toBeGreaterThanOrEqual(-0.05)
  })

  it('la partie entière est coupée à chaque saut', () => {
    const lines = sampleFunction(Math.floor, 0, 3, -1, 4)
    expect(lines.length).toBeGreaterThanOrEqual(3)
  })

  it('pas de graduation lisible', () => {
    expect(niceStep(10, 10)).toBe(1)
    expect(niceStep(10, 4)).toBe(2)
    expect(niceStep(100, 8)).toBe(10)
    expect(niceStep(0.3, 6)).toBeCloseTo(0.05)
  })
})
