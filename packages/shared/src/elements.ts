import { z } from 'zod'
import { LIMITS } from './limits'

export const ID_RE = /^[A-Za-z0-9_-]{1,40}$/

export const idSchema = z.string().regex(ID_RE)
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const coord = z.number().finite().min(-1e7).max(1e7)

const base = {
  id: idSchema,
  pageId: idSchema,
  authorId: idSchema,
  z: z.number().finite(),
  x: coord,
  y: coord,
}

export const strokeSchema = z.object({
  ...base,
  type: z.literal('stroke'),
  tool: z.enum(['pen', 'highlighter']),
  color: colorSchema,
  size: z.number().min(0.5).max(80),
  /** Triplets (x, y, pression) relatifs à (x, y). */
  pts: z
    .array(coord)
    .min(3)
    .max(LIMITS.maxStrokeNumbers)
    .refine((a) => a.length % 3 === 0, 'triplets attendus'),
})

export const textRunSchema = z.object({
  s: z.string().max(LIMITS.maxTextChars),
  b: z.boolean().optional(),
  i: z.boolean().optional(),
  c: colorSchema.optional(),
})

export const textBlockSchema = z.object({
  k: z.enum(['p', 'h1', 'h2']),
  runs: z.array(textRunSchema).max(500),
})

export const textSchema = z
  .object({
    ...base,
    type: z.literal('text'),
    w: z.number().min(20).max(5000),
    fs: z.number().min(8).max(200),
    color: colorSchema,
    blocks: z.array(textBlockSchema).max(500),
  })
  .refine(
    (t) => t.blocks.reduce((n, b) => n + b.runs.reduce((m, r) => m + r.s.length, 0), 0) <= LIMITS.maxTextChars,
    'texte trop long',
  )

export const formulaSchema = z.object({
  ...base,
  type: z.literal('formula'),
  /** Source LaTeX, rendue par KaTeX à l'affichage. */
  latex: z.string().max(LIMITS.maxLatexChars),
  fs: z.number().min(8).max(200),
  color: colorSchema,
})

const windowBound = z.number().finite().min(-1e6).max(1e6)

export const curveSchema = z.object({
  id: idSchema,
  /** y = f(x), source LaTeX (même éditeur que les formules). */
  latex: z.string().max(LIMITS.maxCurveLatexChars),
  color: colorSchema,
})

/** Repère orthonormé avec courbes y = f(x). */
export const graphSchema = z
  .object({
    ...base,
    type: z.literal('graph'),
    w: z.number().min(60).max(5000),
    h: z.number().min(60).max(5000),
    xmin: windowBound,
    xmax: windowBound,
    ymin: windowBound,
    ymax: windowBound,
    grid: z.boolean(),
    curves: z.array(curveSchema).max(LIMITS.maxCurves),
  })
  .refine((g) => g.xmin < g.xmax && g.ymin < g.ymax, 'fenêtre invalide')

export const elementSchema = z.union([strokeSchema, textSchema, formulaSchema, graphSchema])

export type StrokeElement = z.infer<typeof strokeSchema>
export type TextRun = z.infer<typeof textRunSchema>
export type TextBlock = z.infer<typeof textBlockSchema>
export type TextElement = z.infer<typeof textSchema>
export type FormulaElement = z.infer<typeof formulaSchema>
export type Curve = z.infer<typeof curveSchema>
export type GraphElement = z.infer<typeof graphSchema>
export type BoardElement = StrokeElement | TextElement | FormulaElement | GraphElement
export type ElementType = BoardElement['type']

export const PAGE_BACKGROUNDS = ['blank', 'seyes', 'grid', 'dots', 'dark'] as const
export type PageBackground = (typeof PAGE_BACKGROUNDS)[number]

export const pageSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(LIMITS.pageNameMaxLength),
  ord: z.number().finite(),
  bg: z.enum(PAGE_BACKGROUNDS),
})

/** Image de fond (page de PDF importée), stockée dans la salle. */
export interface PageImage {
  id: string
  w: number
  h: number
}

export type Page = z.infer<typeof pageSchema> & { image?: PageImage | null }
