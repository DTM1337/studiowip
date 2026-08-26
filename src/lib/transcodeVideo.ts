import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

let ffmpeg: FFmpeg | null = null
let loaded = false

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg && loaded) return ffmpeg
  ffmpeg = new FFmpeg()
  // Use single-thread core (no SharedArrayBuffer / COEP required)
  const baseURL = 'https://unpkg.com/@ffmpeg/core-st@0.12.6/dist/umd'
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
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
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
    '-vf', 'transpose=1,scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-vcodec', 'libx264',
    '-acodec', 'aac',
    '-crf', '23',
    '-preset', 'fast',
    '-pix_fmt', 'yuv420p',
    '-movflags', 'faststart',
    '-metadata:s:v:0', 'rotate=0',
    outputName,
  ])

  const out = await ff.readFile(outputName)
  await ff.deleteFile(inputName)
  await ff.deleteFile(outputName)

  const rotated = out instanceof Uint8Array ? out : new Uint8Array(out as unknown as ArrayBuffer)
  return new File([rotated.buffer as ArrayBuffer], 'video-rot90.mp4', { type: 'video/mp4' })
}
