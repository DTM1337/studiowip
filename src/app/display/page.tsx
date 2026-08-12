'use client'

import { useState, useEffect, useCallback } from 'react'
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
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    fetch('/api/posts')
      .then(r => r.json())
      .then(data => { setPosts(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
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

  // Apply screen orientation when rotation or fullscreen changes
  useEffect(() => {
    const orient = screen.orientation as ScreenOrientation & {
      lock?: (o: OrientationLockType) => Promise<void>
      unlock?: () => void
    }
    if (!isFullscreen || !orient?.lock) return

    const orientations: Record<number, OrientationLockType> = {
      0:   'landscape-primary',
      90:  'portrait-primary',
      180: 'landscape-secondary',
      270: 'portrait-secondary',
    }
    orient.lock(orientations[rotation]).catch(() => {})

    return () => { orient?.unlock?.() }
  }, [rotation, isFullscreen])

  const enterFullscreen = useCallback(async () => {
    await document.documentElement.requestFullscreen().catch(() => {})
  }, [])

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

      {!isFullscreen && (
        <button
          onClick={enterFullscreen}
          style={{
            position: 'fixed', top: 16, right: 16, zIndex: 9999,
            padding: '8px 16px', background: '#000', color: '#fff',
            border: 'none', borderRadius: 8, cursor: 'pointer',
            fontFamily: 'system-ui', fontSize: 13,
          }}
        >
          Fullskärm för rotation
        </button>
      )}

      {showRulers && (
        <Rulers pan={externalView?.pan ?? { x: 0, y: 0 }} zoom={externalView?.zoom ?? 1} />
      )}
      <CreativeWall initialPosts={posts} uploaderName="Display" displayMode={true}
        externalView={externalView} externalSelectedPostId={externalSelectedPostId} />
    </>
  )
}
