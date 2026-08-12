'use client'

import { useState, useEffect, useRef } from 'react'
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
  const [dims, setDims] = useState({ vw: 0, vh: 0 })
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const update = () => setDims({ vw: window.innerWidth, vh: window.innerHeight })
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

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

  const { vw, vh } = dims

  // Compute wrapper transform. The wrapper is vw×vh and gets rotated so its
  // content fills the screen. position:fixed children inside a transformed
  // ancestor are fixed relative to that ancestor, so everything rotates together.
  let wrapperStyle: React.CSSProperties = { position: 'fixed', inset: 0, overflow: 'hidden' }
  if (rotation !== 0 && vw > 0) {
    // Verified math (transform-origin: 0 0, landscape vw×vh → portrait vh×vw):
    // rotate(90deg):  (x,y)→(-y,x)  → content at x:-vh→0, y:0→vw → need translateX(vh)
    // rotate(270deg): (x,y)→(y,-x)  → content at x:0→vh,  y:-vw→0 → need translateY(vw)
    // rotate(180deg): (x,y)→(-x,-y) → need translateX(vw)+translateY(vh)
    const transforms: Record<number, string> = {
      90:  `translateX(${vh}px) rotate(90deg)`,
      180: `translateX(${vw}px) translateY(${vh}px) rotate(180deg)`,
      270: `translateY(${vw}px) rotate(270deg)`,
    }
    wrapperStyle = {
      position: 'fixed',
      top: 0,
      left: 0,
      width: `${vw}px`,
      height: `${vh}px`,
      overflow: 'hidden',
      transformOrigin: '0 0',
      transform: transforms[rotation] ?? '',
    }
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
      <style>{`nextjs-portal { display: none !important; }`}</style>
      <div ref={wrapperRef} style={wrapperStyle}>
        {showRulers && (
          <Rulers pan={externalView?.pan ?? { x: 0, y: 0 }} zoom={externalView?.zoom ?? 1} />
        )}
        <CreativeWall initialPosts={posts} uploaderName="Display" displayMode={true}
          externalView={externalView} externalSelectedPostId={externalSelectedPostId} />
      </div>
    </>
  )
}
