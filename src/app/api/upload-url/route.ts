import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { randomUUID } from 'crypto'

/**
 * Hands out signed URLs so the browser can upload straight to storage.
 *
 * Routing file bytes through a Vercel function caps them at 4.5 MB, and the
 * pre-rotated copy travelled in the same request, halving that again. Only the
 * signed URLs pass through here, so file size stops being this app's concern.
 *
 * Signing keeps the bucket closed: each URL is scoped to one object and
 * expires, so no public write access has to be opened.
 */
export async function POST(req: NextRequest) {
  const { ext, rotated, forUrl } = await req.json() as
    { ext?: string; rotated?: boolean; forUrl?: string }

  // Backfill mode: a rotated copy for a clip that already exists, named after
  // the original rather than a fresh id.
  if (forUrl) {
    const marker = '/media/'
    const at = forUrl.indexOf(marker)
    if (at === -1) return NextResponse.json({ error: 'Not a media URL' }, { status: 400 })

    const objectName = decodeURIComponent(forUrl.slice(at + marker.length).split('?')[0])
    if (!/^[A-Za-z0-9._-]+$/.test(objectName)) {
      return NextResponse.json({ error: 'Unexpected object name' }, { status: 400 })
    }
    const dot = objectName.lastIndexOf('.')
    const rotName = `${dot === -1 ? objectName : objectName.slice(0, dot)}-rot90.mp4`

    // upsert so a variant can be regenerated over a bad one.
    const r = await supabaseAdmin.storage.from('media')
      .createSignedUploadUrl(rotName, { upsert: true })
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })

    return NextResponse.json({ upload: { path: r.data.path, token: r.data.token, signedUrl: r.data.signedUrl } })
  }

  const safeExt = (ext ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin'
  const id = randomUUID()
  const name = `${id}.${safeExt}`

  const main = await supabaseAdmin.storage.from('media').createSignedUploadUrl(name)
  if (main.error) return NextResponse.json({ error: main.error.message }, { status: 500 })

  const { data: { publicUrl } } = supabaseAdmin.storage.from('media').getPublicUrl(name)

  let rotatedUpload: { path: string; token: string; signedUrl: string } | null = null
  let rotatedUrl: string | null = null
  if (rotated) {
    const rotName = `${id}-rot90.mp4`
    const r = await supabaseAdmin.storage.from('media').createSignedUploadUrl(rotName)
    // Not fatal: without it the display falls back to the unrotated original.
    if (!r.error) {
      rotatedUpload = { path: r.data.path, token: r.data.token, signedUrl: r.data.signedUrl }
      rotatedUrl = supabaseAdmin.storage.from('media').getPublicUrl(rotName).data.publicUrl
    }
  }

  return NextResponse.json({
    upload: { path: main.data.path, token: main.data.token, signedUrl: main.data.signedUrl },
    url: publicUrl,
    rotatedUpload,
    rotatedUrl,
  })
}
