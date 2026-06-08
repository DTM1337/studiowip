import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import { writeFile, unlink, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

export const maxDuration = 60

ffmpeg.setFfmpegPath(ffmpegStatic as string)

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)
  const isVideo = file.type.startsWith('video/')

  if (isVideo) {
    const id = randomUUID()
    const inputPath = join(tmpdir(), `${id}-input`)
    const outputPath = join(tmpdir(), `${id}.mp4`)

    await writeFile(inputPath, buffer)

    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions([
            '-crf 23',
            '-preset fast',
            '-pix_fmt yuv420p',
            '-movflags faststart',
            // Bake rotation into pixels (ffmpeg auto-rotates on decode), clear metadata
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
            '-metadata:s:v:0', 'rotate=0',
          ])
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .save(outputPath)
      })
    } catch (err) {
      await unlink(inputPath).catch(() => {})
      return NextResponse.json({ error: `Transcoding failed: ${err}` }, { status: 500 })
    }

    const transcoded = await readFile(outputPath)
    const fileName = `${id}.mp4`

    const { error } = await supabaseAdmin.storage
      .from('media')
      .upload(fileName, transcoded, { contentType: 'video/mp4', upsert: false })

    await unlink(inputPath).catch(() => {})
    await unlink(outputPath).catch(() => {})

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { data: { publicUrl } } = supabaseAdmin.storage.from('media').getPublicUrl(fileName)
    return NextResponse.json({ url: publicUrl, fileType: 'video' })
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
