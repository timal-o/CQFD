import { LIMITS, randomId } from '@cqfd/shared'
import type { BoardStore } from '../board/store'
import { encodeCanvas, sendAsset } from './assets'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Largeur de rendu d'une page de PDF (px du monde) : lisible sans être trop lourde. */
const RENDER_WIDTH = 1400
const MAX_PAGES = 30

/**
 * Importe un PDF : chaque page est rendue côté client (pdf.js), compressée en JPEG,
 * puis envoyée dans la salle comme fond d'une nouvelle page du tableau.
 */
export async function importPdf(store: BoardStore, file: File): Promise<void> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const count = Math.min(doc.numPages, MAX_PAGES)
  if (doc.numPages > MAX_PAGES) store.toast(`Seules les ${MAX_PAGES} premières pages sont importées.`)

  const base = file.name.replace(/\.pdf$/i, '').slice(0, 24) || 'PDF'
  let ord = (store.pages[store.pages.length - 1]?.ord ?? 0) + 1
  let first: string | null = null

  for (let n = 1; n <= count; n++) {
    store.toast(`Import du PDF : page ${n} sur ${count}…`)
    const page = await doc.getPage(n)
    const unit = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: RENDER_WIDTH / unit.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    const jpeg = await encodeCanvas(canvas, 'image/jpeg', LIMITS.maxAssetBytes)

    const pageId = randomId()
    first ??= pageId
    store.send({ t: 'page', action: { a: 'add', id: pageId, name: `${base} p.${n}`, ord: ord++ } })
    await sendAsset(store, { ...jpeg, w: canvas.width, h: canvas.height }, { pageId, purpose: 'background' })
    // Respecte la limite de débit des actions du prof (création de page).
    await sleep(250)
  }
  if (first) setTimeout(() => store.setPage(first!), 500)
  store.toast('PDF importé.')
}
