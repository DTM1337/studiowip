import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { writeFile, unlink, readFile, access } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

export const maxDuration = 60

async function ffmpegAvailable(): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegStatic = require('ffmpeg-static') as string
    await access(ffmpegStatic)
    return ffmpegStatic
  } catch {
    return null
  }
}

async function transcode(inputPath: string, outputPath: string, ffmpegPath: string): Promise<void> {
  const ffmpeg = (await import('fluent-ffmpeg')).default
  ffmpeg.setFfmpegPath(ffmpegPath)
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-crf 23',
        '-preset fast',
        '-pix_fmt yuv420p',
        '-movflags faststart',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-metadata:s:v:0', 'rotate=0',
      ])
      .on('end', () => resolve())
      .on('error', reject)
      .save(outputPath)
  })
}

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)
  const isVideo = file.type.startsWith('video/')

  if (isVideo) {
    const id = randomUUID()
    const ffmpegPath = await ffmpegAvailable()

    if (ffmpegPath) {
      // Transcode to H.264 MP4
      const inputPath = join(tmpdir(), `${id}-input`)
      const outputPath = join(tmpdir(), `${id}.mp4`)
      await writeFile(inputPath, buffer)
      try {
        await transcode(inputPath, outputPath, ffmpegPath)
        const transcoded = await readFile(outputPath)
        const fileName = `${id}.mp4`
        const { error } = await supabaseAdmin.storage
          .from('media')
          .upload(fileName, transcoded, { contentType: 'video/mp4', upsert: false })
        await unlink(inputPath).catch(() => {})
        await unlink(outputPath).catch(() => {})
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        const { data: { publicUrl } } = supabaseAdmin.storage.from('media').getPublicUrl(fileName)
        return NextResponse.json({ url: publicUrl, fileType: 'video', transcoded: true })
      } catch {
        await unlink(inputPath).catch(() => {})
        await unlink(outputPath).catch(() => {})
        // Fall through to direct upload
      }
    }

    // No ffmpeg — upload original directly
    const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
    const fileName = `${id}.${ext}`
    const { error } = await supabaseAdmin.storage
      .from('media')
      .upload(fileName, buffer, { contentType: file.type, upsert: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Optional pre-rotated copy, stored beside the original under the same id
    // so the display can derive its URL without a schema change. Its absence is
    // not an error: the display falls back to the unrotated file.
    const rotated = formData.get('fileRot90') as File | null
    let rotatedUploaded = false
    if (rotated) {
      const rotBuffer = Buffer.from(await rotated.arrayBuffer())
      const { error: rotError } = await supabaseAdmin.storage
        .from('media')
        .upload(`${id}-rot90.mp4`, rotBuffer, { contentType: 'video/mp4', upsert: true })
      rotatedUploaded = !rotError
    }

    const { data: { publicUrl } } = supabaseAdmin.storage.from('media').getPublicUrl(fileName)
    return NextResponse.json({ url: publicUrl, fileType: 'video', transcoded: false, rotatedUploaded })
  } else {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const fileName = `${randomUUID()}.${ext}`
    const { error } = await supabaseAdmin.storage
      .from('media')
      .upload(fileName, buffer, { contentType: file.type, upsert: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const { data: { publicUrl } } = supabaseAdmin.storage.from('media').getPublicUrl(fileName)
    return NextResponse.json({ url: publicUrl, fileType: 'image' })
  }
}
