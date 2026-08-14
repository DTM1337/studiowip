'use client'

import { useRef, useState, useEffect } from 'react'
import CreativeWall from '@/components/CreativeWall'
import { Post } from '@/types'
import { supabase } from '@/lib/supabase'
import { CHANNEL } from '@/lib/displayChannel'

export default function GodMode() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
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
  const handleToggleCanvasVideo = () => send({ action: 'toggle-canvas-video' })
  const handleToggleDebug = () => send({ action: 'toggle-debug' })

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
      <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', gap: 10 }}>
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
        <button onClick={handleToggleCanvasVideo} title="Växla canvas-rendering av film (för roterad TV)"
          style={{ background: '#111', color: '#fff', border: '1px solid #444', borderRadius: 12,
                   padding: '10px 16px', fontSize: 18, cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}>
          ▣
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
