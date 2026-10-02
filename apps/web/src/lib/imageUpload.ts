import { randomId, type ImageElement } from '@cqfd/shared'
import { screenToWorld } from '../board/geometry'
import type { BoardStore } from '../board/store'
import { encodeCanvas, sendAsset } from './assets'

/** Plus grand côté conservé : assez net pour un énoncé, assez léger pour la salle. */
const MAX_SIDE = 1600
const MAX_BYTES = 3_500_000

/**
 * Pose une image sur le tableau : redimensionnée et compressée dans le navigateur,
 * envoyée dans la salle, puis ajoutée comme élément (déplaçable, redimensionnable).
 * `at` : point écran où la centrer (sinon le centre de la vue).
 */
export async function insertImage(
  store: BoardStore,
  file: Blob,
  view: { width: number; height: number },
  at?: { x: number; y: number },
): Promise<void> {
  if (!store.canWrite || !store.me || !store.pageId) {
    store.toast('Il faut avoir la main pour ajouter une image.')
    return
  }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    store.toast('Format d’image non pris en charge (utilisez PNG, JPEG, WebP ou GIF).')
    return
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  // PNG garde la transparence (captures, schémas) ; les photos passent en JPEG.
  const keepAlpha = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif'
  let encoded: Awaited<ReturnType<typeof encodeCanvas>>
  try {
    encoded = await encodeCanvas(canvas, keepAlpha ? 'image/png' : 'image/jpeg', MAX_BYTES)
  } catch {
    store.toast('Image trop lourde.')
    return
  }

  const pageId = store.pageId
  store.toast('Envoi de l’image…')
  const asset = await sendAsset(store, { ...encoded, w: canvas.width, h: canvas.height }, { pageId, purpose: 'element' })

  // Taille à l'écran : au plus 60 % de la vue, jamais agrandie au-delà de sa taille réelle.
  const cam = store.camera()
  const fit = Math.min(1, (view.width * 0.6) / canvas.width, (view.height * 0.6) / canvas.height)
  const w = (canvas.width * fit) / cam.z
  const h = (canvas.height * fit) / cam.z
  const center = screenToWorld(cam, at?.x ?? view.width / 2, at?.y ?? view.height / 2)
  const el: ImageElement = {
    id: randomId(),
    pageId,
    authorId: store.me.id,
    z: store.nextZ(),
    type: 'image',
    x: Math.round(center.x - w / 2),
    y: Math.round(center.y - h / 2),
    w: Math.round(w),
    h: Math.round(h),
    asset,
  }
  store.commit([{ o: 'put', el }])
  // L'image arrive sélectionnée, prête à être déplacée ou redimensionnée.
  store.setTools({ tool: 'select' })
  store.selection.clear()
  store.selection.add(el.id)
  store.requestRender('live')
  store.emit()
}

/** Premier fichier image d'un presse-papiers ou d'un glisser-déposer. */
export function firstImage(files: FileList | null | undefined): File | null {
  for (const f of files ?? []) if (f.type.startsWith('image/')) return f
  return null
}
