'use client'

import { useEffect, useRef, useState } from 'react'
import CreativeWall from '@/components/CreativeWall'
import { Post } from '@/types'

export default function GodMode() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const throttle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastView = useRef({ pan: { x: 0, y: 0 }, zoom: 1 })

  useEffect(() => {
    fetch('/api/posts')
      .then(r => r.json())
      .then(data => { setPosts(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const handleViewChange = (pan: { x: number; y: number }, zoom: number) => {
    lastView.current = { pan, zoom }
    if (throttle.current) return
    throttle.current = setTimeout(() => {
      throttle.current = null
      fetch('/api/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'view-sync', pan: lastView.current.pan, zoom: lastView.current.zoom }),
      })
    }, 50)
  }

  const handleSelectPost = (postId: string | null) => {
    fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'select-post', postId }),
    })
  }

  const handleRotate = () => {
    fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rotate' }),
    })
  }

  const handleToggleRulers = () => {
    fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle-rulers' }),
    })
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
      <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', gap: 10 }}>
        <button
          onClick={handleToggleRulers}
          title="Visa/dölj linjaler"
          style={{
            background: '#111', color: '#fff', border: '1px solid #444',
            borderRadius: 12, padding: '10px 16px', fontSize: 18,
            cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
          }}
        >
          ⊢
        </button>
        <button
          onClick={handleRotate}
          title="Rotera display 90°"
          style={{
            background: '#111', color: '#fff', border: '1px solid #444',
            borderRadius: 12, padding: '10px 16px', fontSize: 20,
            cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
          }}
        >
          ↻
        </button>
      </div>
    </>
  )
}
