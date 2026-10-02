import type { BoardElement, Page } from '@cqfd/shared'
import { elementBox, unionBox } from '../board/geometry'
import { drawBackground, drawGraph, inkColor, paintStroke } from '../board/render'
import { fillEditor } from '../board/richtext'
import type { BoardStore } from '../board/store'
import type { Box } from '../board/types'
import { curveSamples, loadMath } from '../math/curves'
import { renderLatex } from '../math/katex'

const PADDING = 40
const MAX_SIDE = 6000

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const safeName = (s: string) => s.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-') || 'page'

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/** Zone à exporter : tout le contenu de la page (et l'image de fond), avec une marge. */
function contentBox(store: BoardStore, page: Page, elements: BoardElement[]): Box {
  const boxes = elements.map((e) => elementBox(e, store.domSizes))
  if (page.image) boxes.push({ minX: 0, minY: 0, maxX: page.image.w, maxY: page.image.h })
  const box = unionBox(boxes) ?? { minX: 0, minY: 0, maxX: 1200, maxY: 800 }
  return { minX: box.minX - PADDING, minY: box.minY - PADDING, maxX: box.maxX + PADDING, maxY: box.maxY + PADDING }
}

/** Les textes et formules sont du HTML : on les rastérise avec html-to-image puis on les pose sur le canvas. */
async function drawDomElements(
  ctx: CanvasRenderingContext2D,
  elements: BoardElement[],
  box: Box,
  scale: number,
  dark: boolean,
): Promise<void> {
  const dom = elements.filter((e) => e.type === 'text' || e.type === 'formula')
  if (dom.length === 0) return
  const { toCanvas } = await import('html-to-image')
  // Le parent est hors écran ; la racine capturée reste en (0, 0) dans son repère.
  const holder = document.createElement('div')
  holder.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;'
  const root = document.createElement('div')
  root.style.cssText = `position:relative;width:${box.maxX - box.minX}px;height:${box.maxY - box.minY}px;`
  holder.appendChild(root)
  for (const el of dom) {
    const node = document.createElement('div')
    node.style.left = `${el.x - box.minX}px`
    node.style.top = `${el.y - box.minY}px`
    node.style.fontSize = `${el.fs}px`
    node.style.color = inkColor(el.color, dark ? 'dark' : 'blank')
    if (el.type === 'text') {
      node.className = 'text-el'
      node.style.width = `${el.w}px`
      fillEditor(node, el.blocks)
    } else {
      node.className = 'formula-el'
      node.innerHTML = renderLatex(el.latex)
    }
    root.appendChild(node)
  }
  document.body.appendChild(holder)
  try {
    const layer = await toCanvas(root, { pixelRatio: scale, backgroundColor: undefined, cacheBust: false })
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(layer, 0, 0)
    ctx.restore()
  } finally {
    holder.remove()
  }
}

/** Rendu complet d'une page dans un canvas (fond, image, traits, repères, textes, formules). */
export async function renderPage(store: BoardStore, page: Page): Promise<{ canvas: HTMLCanvasElement; scale: number }> {
  const elements = [...store.elements.values()]
    .filter((e) => e.pageId === page.id)
    .sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1))
  const box = contentBox(store, page, elements)
  const w = box.maxX - box.minX
  const h = box.maxY - box.minY
  const scale = Math.min(2, MAX_SIDE / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const ctx = canvas.getContext('2d')!
  const cam = { x: -box.minX * scale, y: -box.minY * scale, z: scale }

  drawBackground(ctx, page.bg, cam, canvas.width, canvas.height)
  ctx.setTransform(scale, 0, 0, scale, cam.x, cam.y)
  if (page.image) {
    const img = await loadImage(`/api/rooms/${store.code}/assets/${page.image.id}`)
    if (img) ctx.drawImage(img, 0, 0, page.image.w, page.image.h)
  }
  if (elements.some((e) => e.type === 'graph')) await loadMath()
  const images = new Map<string, HTMLImageElement | null>()
  for (const el of elements) {
    if (el.type === 'image' && !images.has(el.asset)) {
      images.set(el.asset, await loadImage(`/api/rooms/${store.code}/assets/${el.asset}`))
    }
  }
  for (const el of elements) {
    if (el.type === 'image') {
      const img = images.get(el.asset)
      if (img) ctx.drawImage(img, el.x, el.y, el.w, el.h)
    } else if (el.type === 'stroke') paintStroke(ctx, el, page.bg)
    else if (el.type === 'graph') drawGraph(ctx, el, page.bg, (c) => curveSamples(el, c))
  }
  await drawDomElements(ctx, elements, box, scale, page.bg === 'dark')
  return { canvas, scale }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas vide'))), type, quality))

export async function exportPng(store: BoardStore): Promise<void> {
  const page = store.page
  if (!page) return
  const { canvas } = await renderPage(store, page)
  download(await toBlob(canvas, 'image/png'), `CQFD-${store.code}-${safeName(page.name)}.png`)
}

export async function exportPdf(store: BoardStore): Promise<void> {
  const { PDFDocument } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  pdf.setTitle(`CQFD ${store.code}`)
  pdf.setCreator('CQFD')
  for (const [i, page] of store.pages.entries()) {
    store.toast(`Export PDF : page ${i + 1} sur ${store.pages.length}…`)
    const { canvas, scale } = await renderPage(store, page)
    const png = await pdf.embedPng(await (await toBlob(canvas, 'image/png')).arrayBuffer())
    // 1 px CSS = 0,75 pt : la page PDF épouse le contenu de la page du tableau.
    const wPt = (canvas.width / scale) * 0.75
    const hPt = (canvas.height / scale) * 0.75
    const p = pdf.addPage([wPt, hPt])
    p.drawImage(png, { x: 0, y: 0, width: wPt, height: hPt })
  }
  const bytes = await pdf.save()
  download(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `CQFD-${store.code}.pdf`)
}
