import { randomId } from '@cqfd/shared'
import type { BoardStore } from '../board/store'

const CHUNK_BYTES = 500_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/**
 * Envoie un fichier image dans la salle, par morceaux de 500 Ko sur la WebSocket.
 * Les messages sont traités dans l'ordre : un élément qui référence l'image, envoyé
 * juste après, trouvera le fichier complet. Renvoie l'identifiant du fichier.
 */
export async function sendAsset(
  store: BoardStore,
  file: { bytes: Uint8Array; mime: 'image/jpeg' | 'image/png' | 'image/webp'; w: number; h: number },
  opts: { pageId: string; purpose: 'background' | 'element' },
): Promise<string> {
  const id = randomId()
  const total = Math.ceil(file.bytes.length / CHUNK_BYTES)
  for (let idx = 0; idx < total; idx++) {
    const data = toBase64(file.bytes.subarray(idx * CHUNK_BYTES, (idx + 1) * CHUNK_BYTES))
    store.send({ t: 'asset', purpose: opts.purpose, id, pageId: opts.pageId, mime: file.mime, w: file.w, h: file.h, idx, total, data })
    // Laisse respirer la limite de débit du serveur sur les gros fichiers.
    if (total > 1) await sleep(60)
  }
  return id
}

/** Canvas → octets, en baissant la qualité JPEG jusqu'à tenir sous `maxBytes`. */
export async function encodeCanvas(
  canvas: HTMLCanvasElement,
  mime: 'image/jpeg' | 'image/png',
  maxBytes: number,
): Promise<{ bytes: Uint8Array; mime: 'image/jpeg' | 'image/png' }> {
  if (mime === 'image/png') {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    if (blob && blob.size <= maxBytes) return { bytes: new Uint8Array(await blob.arrayBuffer()), mime }
  }
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality))
    if (blob && blob.size <= maxBytes) return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg' }
  }
  throw new Error('Image trop lourde')
}
