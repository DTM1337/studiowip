/**
 * Shape of the normalised copy used for gapless playlist playback.
 *
 * Kept apart from the encoder so the display can import these without pulling
 * ffmpeg into its bundle — the panel only ever plays these files, it never
 * makes them.
 *
 * Appending clips into one MediaSource buffer only works if they are
 * interchangeable to the decoder, so every one of these is fixed: change any of
 * them and every stored variant has to be rebuilt.
 */
/**
 * Landscape, matching the panel's browser viewport rather than how the screen
 * is perceived.
 *
 * The panel reports 1920x1080 whichever way it is mounted, and the clip inside
 * is already turned, so a portrait frame here would be fitted into a landscape
 * viewport a second time — squeezing an already-letterboxed picture down again.
 * A clip that ends up portrait to the viewer keeps its bars; it just gets them
 * once.
 */
export const MSE_WIDTH = 1920
export const MSE_HEIGHT = 1080

/** main profile, level 4.0 — must match what the encoder is told to produce. */
export const MSE_CODEC = 'avc1.4d4028'

export const MSE_MIME = `video/mp4; codecs="${MSE_CODEC}"`

/** Normalised copy for gapless playlist playback through MediaSource. */
export function mseVariantUrl(url: string): string {
  const q = url.indexOf('?')
  const base = q === -1 ? url : url.slice(0, q)
  const query = q === -1 ? '' : url.slice(q)
  const dot = base.lastIndexOf('.')
  const stem = dot === -1 ? base : base.slice(0, dot)
  return `${stem}-mse.mp4${query}`
}
