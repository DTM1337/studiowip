import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { password } = await req.json()

  if (!process.env.SITE_PASSWORD) {
    return NextResponse.json({ error: 'SITE_PASSWORD not set' }, { status: 500 })
  }

  if (password === process.env.SITE_PASSWORD) {
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ ok: false }, { status: 401 })
}