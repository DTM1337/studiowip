'use client'

import { useState, useEffect, useRef } from 'react'
import CreativeWall from '@/components/CreativeWall'
import RotatedVideoOverlay from '@/components/RotatedVideoOverlay'
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
  // Tizen keeps decoded frames where drawImage cannot reach them, so canvas
  // rendering is dead for video and the ▣ button now switches the fullscreen
  // overlay between rotating the element and leaving it untransformed — the
  // one remaining question about how the panel treats a <video>.
  const [plainVideo, setPlainVideo] = useState(false)
  const [debug, setDebug] = useState<string[]>([])
  // Toggled from GodMode so nothing has to be typed on a TV remote; the query
  // param stays as a way to have it on from the first paint.
  const [showDebug, setShowDebug] = useState(false)
  const cmdLog = useRef({ total: 0, rotates: 0, last: '-', at: 0, recent: [] as string[] })

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('debug')) setShowDebug(true)
  }, [])

  // Read inside CanvasVideo's paint loop to draw its test marker, avoiding
  // threading a debug-only prop through CreativeWall.
  useEffect(() => {
    document.documentElement.dataset.canvasDebug = showDebug ? '1' : '0'
  }, [showDebug])

  // Reports what each video is actually doing on the TV, which cannot be
  // inspected any other way.
  useEffect(() => {
    if (!showDebug) { setDebug([]); return }
    const tick = () => {
      const rows = [...document.querySelectorAll('canvas')].map((c, i) => {
        const d = (c as HTMLCanvasElement).dataset
        return `#${i} frames=${d.frames ?? '-'} ready=${d.ready ?? '-'} paused=${d.paused ?? '-'} t=${d.time ?? '-'} nat=${d.nat ?? '-'} buf=${d.buf ?? '-'} err=${d.err ?? '-'} draw=${d.draw ?? '-'}`
      })
      const vids = document.querySelectorAll('video').length
      const c = cmdLog.current
      const ago = c.at ? `${Math.round((Date.now() - c.at) / 1000)}s` : '-'
      const subs = supabase.getChannels().filter(ch => ch.topic.endsWith(CHANNEL)).length
      const fs = document.documentElement.dataset.fsVideo
      setDebug([
        `rot=${rotation} plainMode=${plainVideo} canvas=${rows.length} video=${vids}`,
        ...(fs ? [`FS ${fs}`] : []),
        `cmds=${c.total} rotates=${c.rotates} last=${c.last} ${ago} ago subs=${subs}`,
        ...c.recent.map(r => `  ${r}`),
        ...rows,
      ])
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [rotation, plainVideo, showDebug])

  useEffect(() => {
    fetch('/api/posts')
      .then(r => r.json())
      .then(data => { setPosts(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    // Drop any channel left over from a previous mount before opening a new
    // one. Two live subscriptions to the same topic would run this handler
    // twice per command, turning one rotate press into 180°.
    supabase.getChannels()
      .filter(c => c.topic.endsWith(CHANNEL))
      .forEach(c => { supabase.removeChannel(c) })

    const ch = supabase.channel(CHANNEL)
    ch.on('broadcast', { event: 'cmd' }, ({ payload }) => {
      const cmd = payload as { action: string; [key: string]: unknown }
      // Counted so the diagnostics can distinguish "commands really are
      // arriving" from "one press is being handled more than once".
      if (cmd.action !== 'view-sync') {
        cmdLog.current.total++
        cmdLog.current.last = cmd.action
        cmdLog.current.at = Date.now()
        if (cmd.action === 'rotate') cmdLog.current.rotates++
        // Wall-clock times, so an unexplained rotate can be matched against
        // whether anyone was actually at a GodMode screen at that moment.
        cmdLog.current.recent.unshift(`${new Date().toTimeString().slice(0, 8)} ${cmd.action}`)
        cmdLog.current.recent = cmdLog.current.recent.slice(0, 4)
      }
      if (cmd.action === 'view-sync') {
        setExternalView({ pan: cmd.pan as { x: number; y: number }, zoom: cmd.zoom as number })
      } else if (cmd.action === 'select-post') {
        setExternalSelectedPostId((cmd.postId as string) ?? null)
      } else if (cmd.action === 'rotate') {
        setRotation(r => (r + 90) % 360)
      } else if (cmd.action === 'toggle-rulers') {
        setShowRulers(r => !r)
      } else if (cmd.action === 'toggle-canvas-video') {
        setPlainVideo(v => !v)
      } else if (cmd.action === 'toggle-debug') {
        setShowDebug(d => !d)
      }
    }).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  // Rotation is applied to this wrapper rather than to <html>, so that the
  // fullscreen video overlay can be a sibling and stay outside the transform.
  const stageRef = useRef<HTMLDivElement>(null)
  const debugRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const body = document.body
    const styleEl = document.createElement('style')
    document.head.appendChild(styleEl)

    const apply = () => {
      const vw = window.innerWidth
      const vh = window.innerHeight

      stage.style.cssText = ''
      body.style.overflow = 'hidden'
      styleEl.textContent = ''
      if (debugRef.current) debugRef.current.style.transform = ''

      stage.style.position = 'fixed'
      stage.style.top = '0'
      stage.style.left = '0'
      stage.style.overflow = 'hidden'

      if (rotation === 0) {
        stage.style.width = `${vw}px`
        stage.style.height = `${vh}px`
        return
      }

      const quarter = rotation === 90 || rotation === 270
      // Wrapper box before rotation: sides swapped for a quarter turn.
      const W = quarter ? vh : vw
      const H = quarter ? vw : vh

      // transform-origin 0 0, rotate() maps (x,y):
      //   90°  → (-y, x)  ⇒ bbox x ∈ [-H,0] ⇒ shift right by H
      //   270° → ( y,-x)  ⇒ bbox y ∈ [-W,0] ⇒ shift down  by W
      //   180° → (-x,-y)  ⇒ shift right by W and down by H
      const transforms: Record<number, string> = {
        90:  `translateX(${H}px) rotate(90deg)`,
        180: `translateX(${W}px) translateY(${H}px) rotate(180deg)`,
        270: `translateY(${W}px) rotate(270deg)`,
      }

      stage.style.width = `${W}px`
      stage.style.height = `${H}px`
      stage.style.transformOrigin = '0 0'
      stage.style.transform = transforms[rotation]

      const dbg = debugRef.current
      if (dbg) {
        dbg.style.transformOrigin = '0 0'
        dbg.style.transform = transforms[rotation]
      }

      // CSS vw/vh units always resolve against the real viewport, never the
      // wrapper — so every 100vw/100vh rule has to be overridden with the
      // rotated dimensions or the layout overflows and clips.
      styleEl.textContent = `
        .wall-root { width: ${W}px !important; height: ${H}px !important; min-height: ${H}px !important; }
        .wall-stage { width: ${W}px !important; height: ${H}px !important; }
      `
    }

    apply()
    window.addEventListener('resize', apply)
    return () => {
      window.removeEventListener('resize', apply)
      styleEl.remove()
      stage.style.cssText = ''
      body.style.overflow = ''
    }
  }, [rotation, showDebug])

  const fullscreenPost = externalSelectedPostId
    ? posts.find(p => p.id === externalSelectedPostId) ?? null
    : null
  // Only a rotated display needs the overlay; unrotated, the wall's own
  // fullscreen view is already correct and cheaper.
  const useVideoOverlay = rotation !== 0 && fullscreenPost?.file_type === 'video'

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#efefef', display: 'flex',
                  flexDirection: 'column', gap: '8px',
                  alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'system-ui', fontSize: '14px', color: '#aaa' }}>
      <div>Laddar…</div>
      <div style={{ fontSize: '12px', color: '#c4c4c4' }}>
        version {process.env.NEXT_PUBLIC_BUILD_COMMIT} · {process.env.NEXT_PUBLIC_BUILD_TIME} UTC
      </div>
    </div>
  )

  return (
    <>
      <style>{`nextjs-portal { display: none !important; }`}</style>
      {/* A sibling of the wrapper so it stays above the fullscreen overlay, but
          given the same transform so it reads correctly on the turned panel. */}
      {debug.length > 0 && (
        <div ref={debugRef} style={{
          position: 'fixed', top: 0, left: 0, zIndex: 9999,
          background: 'rgba(0,0,0,.85)', color: '#0f0', padding: '10px 14px',
          font: '13px ui-monospace, Menlo, monospace', lineHeight: 1.5,
          whiteSpace: 'pre', pointerEvents: 'none',
        }}>
          {debug.join('\n')}
        </div>
      )}
      <div ref={stageRef}>
        {showRulers && (
          <Rulers pan={externalView?.pan ?? { x: 0, y: 0 }} zoom={externalView?.zoom ?? 1} />
        )}
        <CreativeWall initialPosts={posts} uploaderName="Display" displayMode={true}
          externalView={externalView} externalSelectedPostId={externalSelectedPostId}
          suppressFullscreenVideo={useVideoOverlay} />
      </div>
      {useVideoOverlay && fullscreenPost && (
        <RotatedVideoOverlay src={fullscreenPost.file_url} rotation={rotation}
          rotateElement={!plainVideo} />
      )}
    </>
  )
}
