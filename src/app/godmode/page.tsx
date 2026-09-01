'use client'

import { useRef, useState, useEffect } from 'react'
import CreativeWall from '@/components/CreativeWall'
import { Post } from '@/types'
import { supabase } from '@/lib/supabase'
import { CHANNEL } from '@/lib/displayChannel'

export default function GodMode() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [backfill, setBackfill] = useState<string | null>(null)
  const throttle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastView = useRef({ pan: { x: 0, y: 0 }, zoom: 1 })
  const channel = useRef(supabase.channel(CHANNEL))

  useEffect(() => {
    channel.current.subscribe()
    return () => { supabase.removeChannel(channel.current) }
  }, [])

  useEffect(() => {
    fetch('/api/posts')
      .then(r => r.json())
      .then(data => { setPosts(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const send = (payload: object) => {
    channel.current.send({ type: 'broadcast', event: 'cmd', payload })
  }

  const handleViewChange = (pan: { x: number; y: number }, zoom: number) => {
    lastView.current = { pan, zoom }
    if (throttle.current) return
    throttle.current = setTimeout(() => {
      throttle.current = null
      send({ action: 'view-sync', pan: lastView.current.pan, zoom: lastView.current.zoom })
    }, 50)
  }

  const handleSelectPost = (postId: string | null) => {
    send({ action: 'select-post', postId })
  }

  const handleRotate = () => send({ action: 'rotate' })
  const handleToggleRulers = () => send({ action: 'toggle-rulers' })
  const handleToggleDebug = () => send({ action: 'toggle-debug' })
  const handleToggleCursor = () => send({ action: 'toggle-cursor' })

  // Clips uploaded before pre-rotation existed have no rotated copy. Building
  // them has to happen in a browser (ffmpeg runs client-side here), so it is a
  // deliberate one-off action rather than something the display triggers.
  const handleBackfill = async () => {
    const videos = posts.filter(p => p.file_type === 'video')
    if (!videos.length) { setBackfill('Inga filmer'); return }
    if (!confirm(`Skapa roterade versioner för ${videos.length} filmer? Det tar en stund.`)) return

    const { rotatedVariantUrl } = await import('@/lib/rotatedVariant')
    const { rotateVideo90 } = await import('@/lib/transcodeVideo')
    let done = 0, skipped = 0, failed = 0
    // Kept and shown: a silent catch here once reported three failures with no
    // hint that the cause was a bad ffmpeg URL.
    let reason = ''

    for (const [i, post] of videos.entries()) {
      setBackfill(`${i + 1}/${videos.length}…`)
      try {
        const existing = await fetch(rotatedVariantUrl(post.file_url), { method: 'HEAD' })
        if (existing.ok) { skipped++; continue }

        const original = await fetch(post.file_url)
        if (!original.ok) throw new Error(`hämtning ${original.status}`)
        const blob = await original.blob()
        const rotated = await rotateVideo90(
          new File([blob], 'in.mp4', { type: 'video/mp4' }),
          r => setBackfill(`${i + 1}/${videos.length} — ${Math.round(r * 100)}%`),
        )

        const form = new FormData()
        form.append('file', rotated)
        form.append('originalUrl', post.file_url)
        const res = await fetch('/api/upload-rotated', { method: 'POST', body: form })
        if (!res.ok) throw new Error(`uppladdning ${res.status}`)
        done++
      } catch (e) {
        failed++
        if (!reason) reason = e instanceof Error ? e.message : String(e)
        console.error('Backfill failed for', post.file_url, e)
      }
    }
    setBackfill(
      `Klart: ${done} nya, ${skipped} fanns, ${failed} misslyckades` +
      (reason ? ` — ${reason}` : ''),
    )
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#efefef', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'system-ui', fontSize: '14px', color: '#aaa' }}>
      Laddar…
    </div>
  )

  return (
    <>
      <CreativeWall initialPosts={posts} uploaderName="GodMode" onViewChange={handleViewChange} onSelectPost={handleSelectPost} />
      <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
                    display: 'flex', gap: 10, alignItems: 'center' }}>
        {backfill && (
          <span style={{ background: 'rgba(0,0,0,.8)', color: '#fff', borderRadius: 10,
                         padding: '8px 12px', fontSize: 12, fontFamily: 'system-ui' }}>
            {backfill}
          </span>
        )}
        <button onClick={handleBackfill} title="Skapa roterade versioner av alla filmer (engångsjobb)"
          style={{ background: '#111', color: '#fff', border: '1px solid #444', borderRadius: 12,
                   padding: '10px 16px', fontSize: 18, cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}>
          ⟳▤
        </button>
        <button onClick={handleToggleCursor} title="Visa/dölj muspekaren på display"
          style={{ background: '#111', color: '#fff', border: '1px solid #444', borderRadius: 12,
                   padding: '10px 16px', fontSize: 18, cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}>
          ⌖
        </button>
        <button onClick={handleToggleRulers} title="Visa/dölj linjaler"
          style={{ background: '#111', color: '#fff', border: '1px solid #444', borderRadius: 12,
                   padding: '10px 16px', fontSize: 18, cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}>
          ⊢
        </button>
        <button onClick={handleToggleDebug} title="Visa/dölj diagnostik på display"
          style={{ background: '#111', color: '#fff', border: '1px solid #444', borderRadius: 12,
                   padding: '10px 16px', fontSize: 18, cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}>
          ⓘ
        </button>
        <button onClick={handleRotate} title="Rotera display 90°"
          style={{ background: '#111', color: '#fff', border: '1px solid #444', borderRadius: 12,
                   padding: '10px 16px', fontSize: 20, cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}>
          ↻
        </button>
      </div>
    </>
  )
}
