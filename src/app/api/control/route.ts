import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const subscribers = new Set<(data: string) => void>()

export async function GET() {
  const encoder = new TextEncoder()
  let send: (data: string) => void

  const stream = new ReadableStream({
    start(controller) {
      send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))
        } catch {}
      }
      subscribers.add(send)

      const interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          clearInterval(interval)
        }
      }, 15000)

      // store interval ref for cancel
      ;(send as unknown as { _interval: ReturnType<typeof setInterval> })._interval = interval
    },
    cancel() {
      if (send) {
        subscribers.delete(send)
        const s = send as unknown as { _interval: ReturnType<typeof setInterval> }
        if (s._interval) clearInterval(s._interval)
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const data = JSON.stringify(body)
    subscribers.forEach(fn => fn(data))
    return NextResponse.json({ ok: true, sent: subscribers.size })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
