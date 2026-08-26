/**
 * Naming convention for the pre-rotated copy of a video.
 *
 * The rotated file is stored beside the original under the same id, so its URL
 * is derivable and no database column is needed. Callers are expected to fall
 * back to the original when the variant is missing — older uploads have none.
 */
export function rotatedVariantUrl(url: string): string {
  const q = url.indexOf('?')
  const base = q === -1 ? url : url.slice(0, q)
  const query = q === -1 ? '' : url.slice(q)
  const dot = base.lastIndexOf('.')
  if (dot === -1) return `${base}-rot90.mp4${query}`
  return `${base.slice(0, dot)}-rot90.mp4${query}`
}
