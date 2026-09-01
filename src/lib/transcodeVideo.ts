import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

/**
 * Longest edge allowed, in either orientation.
 *
 * A 1440p clip came out at 7.8 Mbps against 1-3 for everything else, and it was
 * the one that stuttered: too much to pull over the office network and decode
 * on a TV. A wall display gains nothing above 1080p.
 *
 * Fitting inside a square box rather than 1920x1080 so portrait clips keep
 * their full height instead of being squeezed to fit a landscape frame.
 */
const MAX_EDGE = 1920
const FIT = `scale=w='min(${MAX_EDGE},iw)':h='min(${MAX_EDGE},ih)':force_original_aspect_ratio=decrease`
// Even dimensions, which yuv420p requires.
const EVEN = 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
// A ceiling on top of CRF, so a high-motion shot cannot spike past what the
// panel can stream.
const RATE_CAP = ['-maxrate', '4M', '-bufsize', '8M']

let ffmpeg: FFmpeg | null = null
let loaded = false

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg && loaded) return ffmpeg
  ffmpeg = new FFmpeg()
  // @ffmpeg/core is the single-threaded build and needs no SharedArrayBuffer,
  // so it works without the COEP headers that broke cross-origin images.
  // (@ffmpeg/core-mt is the one that requires them; @ffmpeg/core-st does not
  // exist at all — pointing at it returned 400 and silently disabled every
  // transcode.) Pinned to the version in package.json.
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd'
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  })
  loaded = true
  return ffmpeg
}

export async function transcodeToH264(
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<File> {
  const ff = await getFFmpeg()

  if (onProgress) {
    ff.on('progress', ({ progress }) => onProgress(progress))
  }

  const inputName = `input.${file.name.split('.').pop() || 'mp4'}`
  const outputName = 'output.mp4'

  await ff.writeFile(inputName, await fetchFile(file))
  await ff.exec([
    '-i', inputName,
    '-vcodec', 'libx264',
    '-acodec', 'aac',
    '-crf', '23',
    '-preset', 'fast',
    '-pix_fmt', 'yuv420p',
    '-movflags', 'faststart',
    '-vf', `${FIT},${EVEN}`,
    ...RATE_CAP,
    '-metadata:s:v:0', 'rotate=0',
    outputName,
  ])

  const data = await ff.readFile(outputName)
  await ff.deleteFile(inputName)
  await ff.deleteFile(outputName)

  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as unknown as ArrayBuffer)
  return new File([bytes.buffer as ArrayBuffer], 'video.mp4', { type: 'video/mp4' })
}

/**
 * Produces a copy whose picture is physically rotated 90° clockwise.
 *
 * Samsung Tizen renders <video> through a hardware path that ignores CSS
 * transforms — inherited or on the element — and refuses to hand frames to
 * drawImage, so a rotated display cannot rotate a clip at playback time. Baking
 * the rotation into the file removes the browser from that decision entirely.
 */
export async function rotateVideo90(
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<File> {
  const ff = await getFFmpeg()

  if (onProgress) {
    ff.on('progress', ({ progress }) => onProgress(progress))
  }

  const inputName = `rot-input.${file.name.split('.').pop() || 'mp4'}`
  const outputName = 'rot-output.mp4'

  await ff.writeFile(inputName, await fetchFile(file))
  await ff.exec([
    '-i', inputName,
    // transpose=1 is 90° clockwise, matching the direction the display rotates.
    '-vf', `transpose=1,${FIT},${EVEN}`,
    '-vcodec', 'libx264',
    '-acodec', 'aac',
    '-crf', '23',
    '-preset', 'fast',
    '-pix_fmt', 'yuv420p',
    '-movflags', 'faststart',
    ...RATE_CAP,
    '-metadata:s:v:0', 'rotate=0',
    outputName,
  ])

  const out = await ff.readFile(outputName)
  await ff.deleteFile(inputName)
  await ff.deleteFile(outputName)

  const rotated = out instanceof Uint8Array ? out : new Uint8Array(out as unknown as ArrayBuffer)
  return new File([rotated.buffer as ArrayBuffer], 'video-rot90.mp4', { type: 'video/mp4' })
}
