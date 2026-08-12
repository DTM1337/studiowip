'use client'

import { useState, useEffect, useCallback } from 'react'
import CreativeWall from '@/components/CreativeWall'
import Rulers from '@/components/Rulers'
import { Post } from '@/types'
import { supabase } from '@/lib/supabase'
import { CHANNEL } from '@/lib/displayChannel'

type LockType = 'landscape-primary' | 'landscape-secondary' | 'portrait-primary' | 'portrait-secondary'

const ORIENTATION_MAP: Record<number, LockType> = {
  0:   'landscape-primary',
  90:  'portrait-primary',
  180: 'landscape-secondary',
  270: 'portrait-secondary',
}

function getOrient() {
  return screen.orientation as ScreenOrientation & { lock?: (o: LockType) => Promise<void>; unlock?: () => void }
}

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
    // Samsung Tizen kiosk is always "fullscreen" — treat it as such
    if (window.navigator.userAgent.includes('SMART-TV') || window.navigator.userAgent.includes('Tizen')) {
      setIsFullscreen(true)
    }
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

  // Try screen.orientation.lock (works in fullscreen on Chrome; may work natively on Tizen).
  // Fall back to CSS transform on the html element.
  useEffect(() => {
    const orient = getOrient()
    const html = document.documentElement

    if (orient?.lock) {
      orient.lock(ORIENTATION_MAP[rotation]).then(() => {
        // Lock succeeded — clear any CSS fallback
        html.style.cssText = ''
      }).catch(() => {
        applyCssRotation(rotation)
      })
    } else {
      applyCssRotation(rotation)
    }

    return () => {
      orient?.unlock?.()
      html.style.cssText = ''
    }
  }, [rotation])

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

      {!isFullscreen && rotation !== 0 && (
        <button
          onClick={enterFullscreen}
          style={{
            position: 'fixed', top: 16, right: 16, zIndex: 9999,
            padding: '10px 18px', background: '#000', color: '#fff',
            border: 'none', borderRadius: 8, cursor: 'pointer',
            fontFamily: 'system-ui', fontSize: 13,
          }}
        >
          Klicka för fullskärm (krävs för rotation i Chrome)
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

function applyCssRotation(rotation: number) {
  const html = document.documentElement
  html.style.cssText = ''
  if (rotation === 0) return

  const vw = window.innerWidth
  const vh = window.innerHeight

  html.style.transformOrigin = '0 0'
  html.style.overflow = 'hidden'

  if (rotation === 90) {
    html.style.transform = `translateX(${vh}px) rotate(90deg)`
  } else if (rotation === 270) {
    html.style.transform = `translateY(${vw}px) rotate(270deg)`
  } else if (rotation === 180) {
    html.style.transform = `translateX(${vw}px) translateY(${vh}px) rotate(180deg)`
  }
}
