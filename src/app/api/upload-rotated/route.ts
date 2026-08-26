import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const maxDuration = 60

/**
 * Stores a pre-rotated copy for a video that already exists.
 *
 * Rotation itself has to happen in the browser: Vercel's runtime has no ffmpeg
 * binary, which is why the upload path transcodes client-side too. This only
 * takes the finished file and puts it beside the original.
 */
export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const originalUrl = formData.get('originalUrl') as string | null

  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })
  if (!originalUrl) return NextResponse.json({ error: 'No originalUrl' }, { status: 400 })

  // Derive the storage object name from the public URL, and refuse anything
  // that does not look like a plain name in the media bucket.
  const marker = '/media/'
  const at = originalUrl.indexOf(marker)
  if (at === -1) return NextResponse.json({ error: 'Not a media URL' }, { status: 400 })

  const objectName = decodeURIComponent(originalUrl.slice(at + marker.length).split('?')[0])
  if (!/^[A-Za-z0-9._-]+$/.test(objectName)) {
    return NextResponse.json({ error: 'Unexpected object name' }, { status: 400 })
  }

  const dot = objectName.lastIndexOf('.')
  const base = dot === -1 ? objectName : objectName.slice(0, dot)
  const rotatedName = `${base}-rot90.mp4`

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error } = await supabaseAdmin.storage
    .from('media')
    .upload(rotatedName, buffer, { contentType: 'video/mp4', upsert: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: { publicUrl } } = supabaseAdmin.storage.from('media').getPublicUrl(rotatedName)
  return NextResponse.json({ url: publicUrl })
}
