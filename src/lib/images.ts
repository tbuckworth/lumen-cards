import { z } from 'zod'
import type { CardImageData, StoredImage } from '../types'

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024

export function imageBlob(value: string): Blob {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match) throw new Error('Use an embedded PNG, JPEG or WebP image (data URI), not a URL or HTML.')
  if (match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new Error('Each image must be 10 MB or smaller.')
  let bytes: Uint8Array<ArrayBuffer>
  try {
    const decoded = atob(match[2])
    if (btoa(decoded) !== match[2]) throw new Error('Invalid base64')
    bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0))
  } catch { throw new Error('The image contains invalid base64 data.') }
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Each image must be 10 MB or smaller.')
  const starts = (...signature: number[]) => signature.every((byte, i) => bytes[i] === byte)
  const valid = match[1] === 'png' ? starts(137, 80, 78, 71, 13, 10, 26, 10) && bytes.length >= 33
    : match[1] === 'jpeg' ? starts(255, 216, 255) && bytes.length >= 16
      : starts(82, 73, 70, 70) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP' && bytes.length >= 20
  if (!valid) throw new Error('The image data does not match its PNG, JPEG or WebP type.')
  return new Blob([bytes], { type: `image/${match[1]}` })
}

export const imageSchema = z.string().superRefine((value, ctx) => {
  try { imageBlob(value) } catch (error) {
    ctx.addIssue({ code: 'custom', message: (error as Error).message })
  }
})

export function asBlob(image: CardImageData): Blob {
  return image instanceof Blob ? image : new Blob([image.data], { type: image.type })
}

// WebKit can reject Blob writes in ephemeral/private storage. Raw bytes retain the
// same compact, offline representation without relying on its Blob file backend.
export async function storeImage(image?: CardImageData): Promise<StoredImage | undefined> {
  if (!image) return undefined
  return image instanceof Blob ? { type: image.type, data: await image.arrayBuffer() } : image
}

export async function blobDataUri(image?: CardImageData): Promise<string | undefined> {
  if (!image) return undefined
  const blob = asBlob(image)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)))
  return `data:${blob.type};base64,${btoa(chunks.join(''))}`
}

export async function validateImage(blob: Blob): Promise<void> {
  // Non-rendering environments can still validate the byte signature.
  if (!Image.prototype.decode) return
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Invalid image'))
      image.src = url
    })
    if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('Image too large')
    await image.decode()
  } catch { throw new Error('This image cannot be opened. Save it as a smaller PNG, JPEG or WebP and try again.') }
  finally { URL.revokeObjectURL(url) }
}

export async function contentKey(front: string, frontImage?: CardImageData, backImage?: CardImageData): Promise<string> {
  const hashes: string[] = []
  for (const image of [frontImage, backImage]) {
    if (!image) { hashes.push(''); continue }
    const uri = (await blobDataUri(image))!
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(uri))
    hashes.push(Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join(''))
  }
  return JSON.stringify([front.trim().replace(/\s+/g, ' ').toLowerCase(), ...hashes])
}

export async function readImageFile(file: File): Promise<Blob> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Each image must be 10 MB or smaller.')
  const blob = imageBlob((await blobDataUri(file))!)
  await validateImage(blob)
  return blob
}

export function storageError(error: unknown): string {
  if (error instanceof Error && /quota/i.test(error.name + error.message)) {
    return 'There is not enough storage. Free some device space or use smaller images, then try again.'
  }
  return error instanceof Error ? error.message : 'Could not save. Please try again.'
}
