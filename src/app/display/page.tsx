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
    const styleEl = document.createElement('style')
    document.head.appendChild(styleEl)

    const apply = () => {
      const vw = window.innerWidth
      const vh = window.innerHeight

      html.style.cssText = ''
      body.style.cssText = ''
      styleEl.textContent = ''
      if (rotation === 0) return

      const quarter = rotation === 90 || rotation === 270
      // Page box dimensions before rotation: swapped for 90/270.
      const W = quarter ? vh : vw
      const H = quarter ? vw : vh

      // transform-origin 0 0, rotate() maps (x,y):
      //   90°  → (-y, x)  ⇒ bbox x ∈ [-H,0] ⇒ shift right by H (= vw)
      //   270° → ( y,-x)  ⇒ bbox y ∈ [-W,0] ⇒ shift down  by W (= vh)
      //   180° → (-x,-y)  ⇒ shift right by W and down by H
      const transforms: Record<number, string> = {
        90:  `translateX(${H}px) rotate(90deg)`,
        180: `translateX(${W}px) translateY(${H}px) rotate(180deg)`,
        270: `translateY(${W}px) rotate(270deg)`,
      }

      html.style.transformOrigin = '0 0'
      html.style.transform = transforms[rotation]
      html.style.width = `${W}px`
      html.style.height = `${H}px`
      html.style.overflow = 'hidden'
      body.style.overflow = 'hidden'

      // CSS vw/vh units always resolve against the real viewport, not the
      // resized <html> box — so every 100vw/100vh rule has to be overridden
      // with the rotated page dimensions or the layout overflows and clips.
      styleEl.textContent = `
        html, body { width: ${W}px !important; height: ${H}px !important; }
        .wall-root { width: ${W}px !important; height: ${H}px !important; min-height: ${H}px !important; }
        .wall-stage { width: ${W}px !important; height: ${H}px !important; }
      `
    }

    apply()
    window.addEventListener('resize', apply)
    return () => {
      window.removeEventListener('resize', apply)
      styleEl.remove()
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
        externalView={externalView} externalSelectedPostId={externalSelectedPostId}
        canvasVideo={rotation !== 0} />
    </>
  )
}
