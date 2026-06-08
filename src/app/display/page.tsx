'use client'

import { useState, useEffect } from 'react'
import CreativeWall from '@/components/CreativeWall'
import Rulers from '@/components/Rulers'
import { Post } from '@/types'
import { supabase } from '@/lib/supabase'
import { CHANNEL } from '@/lib/displayChannel'

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
    const ch = supabase.channel(CHANNEL)
    ch.on('broadcast', { event: 'cmd' }, ({ payload }) => {
      const cmd = payload as { action: string; [key: string]: unknown }
      if (cmd.action === 'view-sync') {
        setExternalView({ pan: cmd.pan as { x: number; y: number }, zoom: cmd.zoom as number })
      } else if (cmd.action === 'select-post') {
        setExternalSelectedPostId((cmd.postId as string) ?? null)
      } else if (cmd.action === 'rotate') {
        setRotation(r => (r + 90) % 360)
      } else if (cmd.action === 'toggle-rulers') {
        setShowRulers(r => !r)
      }
    }).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  const [dims, setDims] = useState({ vw: 0, vh: 0 })
  useEffect(() => {
    const update = () => setDims({ vw: window.innerWidth, vh: window.innerHeight })
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#efefef', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'system-ui', fontSize: '14px', color: '#aaa' }}>
      Laddar…
    </div>
  )

  const is90or270 = rotation === 90 || rotation === 270
  const { vw, vh } = dims

  // For 90/270°: content box is vh×vw (portrait), rotated to fill vw×vh screen
  const boxW = is90or270 ? vh : vw
  const boxH = is90or270 ? vw : vh
  const offsetTop  = is90or270 ? (vh - vw) / 2 : 0
  const offsetLeft = is90or270 ? (vw - vh) / 2 : 0

  return (
    <>
      <style>{`nextjs-portal { display: none !important; }`}</style>
      {showRulers && (
        <Rulers pan={externalView?.pan ?? { x: 0, y: 0 }} zoom={externalView?.zoom ?? 1} />
      )}
      <div style={{
        position: 'fixed',
        top: offsetTop,
        left: offsetLeft,
        width: boxW || '100vw',
        height: boxH || '100vh',
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        transformOrigin: 'center center',
        overflow: 'hidden',
      }}>
        <CreativeWall initialPosts={posts} uploaderName="Display" displayMode={true}
          externalView={externalView} externalSelectedPostId={externalSelectedPostId} />
      </div>
    </>
  )
}
