import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

const OBJECT = 'playlist.json'

/**
 * The playlist, as an ordered list of post ids.
 *
 * Kept as a small object in the media bucket rather than a table: the project
 * has no migration setup, so a table would mean running SQL by hand, and this
 * needs no querying — it is read whole and written whole. It does need to
 * survive a restart, since the TV reloads on its own.
 */
export async function GET() {
  const { data, error } = await supabaseAdmin.storage.from('media').download(OBJECT)
  // Absent simply means nothing has been put in it yet.
  if (error || !data) return NextResponse.json({ ids: [] })

  try {
    const parsed = JSON.parse(await data.text())
    const ids = Array.isArray(parsed?.ids) ? parsed.ids.filter((x: unknown) => typeof x === 'string') : []
    return NextResponse.json({ ids })
  } catch {
    return NextResponse.json({ ids: [] })
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { ids?: unknown } | null
  if (!Array.isArray(body?.ids)) {
    return NextResponse.json({ error: 'ids must be an array' }, { status: 400 })
  }

  const ids = body.ids.filter((x): x is string => typeof x === 'string').slice(0, 500)
  const file = new Blob([JSON.stringify({ ids })], { type: 'application/json' })

  const { error } = await supabaseAdmin.storage
    .from('media')
    .upload(OBJECT, file, { contentType: 'application/json', upsert: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ids })
}
