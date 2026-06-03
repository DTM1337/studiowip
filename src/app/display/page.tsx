'use client'

import { useState, useEffect } from 'react'
import CreativeWall from '@/components/CreativeWall'
import Rulers from '@/components/Rulers'
import { Post } from '@/types'

export default function DisplayPage() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [externalView, setExternalView] = useState<{ pan: { x: number; y: number }; zoom: number } | null>(null)
  const [externalSelectedPostId, setExternalSelectedPostId] = useState<string | null>(null)
  const [rotation, setRotation] = useState(0)
  const [showRulers, setShowRulers] = useState(false)

  useEffect(() => {
    fetch('/api/posts')
      .then(r => r.json())
      .then(data => { setPosts(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    const es = new EventSource('/api/control')
    es.onmessage = (e) => {
      try {
        const cmd = JSON.parse(e.data)
        if (cmd.action === 'view-sync') {
          setExternalView({ pan: cmd.pan, zoom: cmd.zoom })
        } else if (cmd.action === 'select-post') {
          setExternalSelectedPostId(cmd.postId ?? null)
        } else if (cmd.action === 'rotate') {
          setRotation(r => (r + 90) % 360)
        } else if (cmd.action === 'toggle-rulers') {
          setShowRulers(r => !r)
        }
      } catch {}
    }
    return () => es.close()
  }, [])

  const is90or270 = rotation === 90 || rotation === 270

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#efefef', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'system-ui', fontSize: '14px', color: '#aaa' }}>
      Laddar…
    </div>
  )

  return (
    <>
      <style>{`
        #__next-build-watcher,
        nextjs-portal { display: none !important; }
      `}</style>
      {showRulers && (
        <Rulers
          pan={externalView?.pan ?? { x: 0, y: 0 }}
          zoom={externalView?.zoom ?? 1}
        />
      )}
      <div style={{
        width: is90or270 ? '100vh' : '100vw',
        height: is90or270 ? '100vw' : '100vh',
        transform: `rotate(${rotation}deg)`,
        transformOrigin: 'center center',
        position: 'fixed',
        top: is90or270 ? `calc((100vh - 100vw) / 2)` : 0,
        left: is90or270 ? `calc((100vw - 100vh) / 2)` : 0,
        overflow: 'hidden',
      }}>
        <CreativeWall initialPosts={posts} uploaderName="Display" displayMode={true} externalView={externalView} externalSelectedPostId={externalSelectedPostId} />
      </div>
    </>
  )
}
