/**
 * Naming convention for the pre-rotated copy of a video.
 *
 * The rotated file is stored beside the original under the same id, so its URL
 * is derivable and no database column is needed. Callers are expected to fall
 * back to the original when the variant is missing — older uploads have none.
 */
export function rotatedVariantUrl(url: string): string {
  return variantUrl(url, '-rot90.mp4')
}

/** Still frame shown on the board in place of playing the clip. */
export function posterVariantUrl(url: string): string {
  return variantUrl(url, '-poster.jpg')
}

function variantUrl(url: string, suffix: string): string {
  const q = url.indexOf('?')
  const base = q === -1 ? url : url.slice(0, q)
  const query = q === -1 ? '' : url.slice(q)
  const dot = base.lastIndexOf('.')
  const stem = dot === -1 ? base : base.slice(0, dot)
  return `${stem}${suffix}${query}`
}
