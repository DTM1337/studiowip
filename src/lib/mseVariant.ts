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
export const MSE_WIDTH = 1080
export const MSE_HEIGHT = 1920

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
