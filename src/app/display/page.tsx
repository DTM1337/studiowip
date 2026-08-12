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

  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const vw = window.innerWidth
    const vh = window.innerHeight

    if (rotation === 0) {
      html.style.cssText = ''
      body.style.cssText = ''
      return
    }

    // Rotate via html element — video elements follow when root is transformed
    // Standard kiosk/TV rotation pattern: transform-origin top-left + translate
    const transforms: Record<number, string> = {
      90:  `rotate(90deg) translateX(0) translateY(-${vh}px)`,
      180: `rotate(180deg) translateX(-${vw}px) translateY(-${vh}px)`,
      270: `rotate(270deg) translateX(-${vw}px) translateY(0)`,
    }

    html.style.transformOrigin = '0 0'
    html.style.transform = transforms[rotation] ?? ''
    html.style.width = (rotation === 90 || rotation === 270) ? `${vh}px` : `${vw}px`
    html.style.height = (rotation === 90 || rotation === 270) ? `${vw}px` : `${vh}px`
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'

    return () => {
      html.style.cssText = ''
      body.style.cssText = ''
    }
  }, [rotation])

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#efefef', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'system-ui', fontSize: '14px', color: '#aaa' }}>
      Laddar…
    </div>
  )

  return (
    <>
      <style>{`nextjs-portal { display: none !important; }`}</style>
      {showRulers && (
        <Rulers pan={externalView?.pan ?? { x: 0, y: 0 }} zoom={externalView?.zoom ?? 1} />
      )}
      <CreativeWall initialPosts={posts} uploaderName="Display" displayMode={true}
        externalView={externalView} externalSelectedPostId={externalSelectedPostId} />
    </>
  )
}
