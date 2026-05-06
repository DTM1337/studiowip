import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

const MAX_SIZE_MB = 50
const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/quicktime',
]

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const uploaderName = (formData.get('uploaderName') as string) || 'Anonymous'
  const caption = (formData.get('caption') as string) || null

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 400 })
  }

  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    return NextResponse.json({ error: `Max file size is ${MAX_SIZE_MB}MB` }, { status: 400 })
  }

  const ext = file.name.split('.').pop() ?? 'bin'
  const fileName = `${crypto.randomUUID()}.${ext}`
  const fileType = file.type.startsWith('video/') ? 'video' : 'image'

  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: storageError } = await supabaseAdmin.storage
    .from('media')
    .upload(fileName, buffer, { contentType: file.type, upsert: false })

  if (storageError) {
    return NextResponse.json({ error: storageError.message }, { status: 500 })
  }

  const {
    data: { publicUrl },
  } = supabaseAdmin.storage.from('media').getPublicUrl(fileName)

  const { data, error: dbError } = await supabaseAdmin
    .from('posts')
    .insert({ file_url: publicUrl, file_type: fileType, uploader_name: uploaderName, caption })
    .select()
    .single()

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  return NextResponse.json(data)
}