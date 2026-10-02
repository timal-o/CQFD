import { LIMITS, randomId } from '@cqfd/shared'
import type { BoardStore } from '../board/store'

/** Largeur de rendu d'une page de PDF (px du monde) : lisible sans être trop lourde. */
const RENDER_WIDTH = 1400
const MAX_PAGES = 30
const CHUNK_BYTES = 500_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  // On baisse la qualité jusqu'à tenir sous le plafond par image.
  for (const quality of [0.8, 0.65, 0.5, 0.35]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality))
    if (blob && blob.size <= LIMITS.maxAssetBytes) return new Uint8Array(await blob.arrayBuffer())
  }
  throw new Error('Page trop lourde')
}

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
    const jpeg = await canvasToJpeg(canvas)

    const pageId = randomId()
    first ??= pageId
    store.send({ t: 'page', action: { a: 'add', id: pageId, name: `${base} p.${n}`, ord: ord++ } })
    const total = Math.ceil(jpeg.length / CHUNK_BYTES)
    const assetId = randomId()
    for (let idx = 0; idx < total; idx++) {
      const data = toBase64(jpeg.subarray(idx * CHUNK_BYTES, (idx + 1) * CHUNK_BYTES))
      store.send({ t: 'asset', id: assetId, pageId, mime: 'image/jpeg', w: canvas.width, h: canvas.height, idx, total, data })
      await sleep(60)
    }
    // Respecte la limite de débit des actions du prof (création de page).
    await sleep(250)
  }
  if (first) setTimeout(() => store.setPage(first!), 500)
  store.toast('PDF importé.')
}
