'use client'

import { useRef, useState, useEffect } from 'react'
import CreativeWall from '@/components/CreativeWall'
import { Post } from '@/types'
import { supabase } from '@/lib/supabase'
import { CHANNEL } from '@/lib/displayChannel'

export default function GodMode() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [backfill, setBackfill] = useState<string | null>(null)
  const [playlist, setPlaylist] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  const [playing, setPlaying] = useState(false)
  const throttle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastScroll = useRef(0)
  const channel = useRef(supabase.channel(CHANNEL))
  /**
   * Saves the playlist, one request at a time.
   *
   * Picking several cards quickly used to fire overlapping saves, and whichever
   * landed last won regardless of order — the list on screen and the one stored
   * could disagree. Writes are serialised, and only the newest state is sent,
   * so intermediate ones are skipped rather than queued.
   */
  const latestPlaylist = useRef<string[]>([])
  const savingPlaylist = useRef(false)


  useEffect(() => {
    channel.current.subscribe()
    return () => { supabase.removeChannel(channel.current) }
  }, [])

  useEffect(() => {
    fetch('/api/playlist')
      .then(r => r.json())
      .then(d => {
        const ids = Array.isArray(d.ids) ? d.ids : []
        latestPlaylist.current = ids
        setPlaylist(ids)
      })
      .catch(() => {})
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

  const handleScrollChange = (fraction: number) => {
    lastScroll.current = fraction
    if (throttle.current) return
    throttle.current = setTimeout(() => {
      throttle.current = null
      send({ action: 'view-sync', scroll: lastScroll.current })
    }, 50)
  }

  const handleSelectPost = (postId: string | null) => {
    send({ action: 'select-post', postId })
  }

  // See latestPlaylist above for why this serialises.
  const savePlaylist = async (ids: string[]) => {
    latestPlaylist.current = ids
    setPlaylist(ids)
    if (savingPlaylist.current) return

    savingPlaylist.current = true
    try {
      // Re-reads after each write, in case more picks arrived meanwhile.
      let sent: string[] | null = null
      while (sent !== latestPlaylist.current) {
        sent = latestPlaylist.current
        await fetch('/api/playlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: sent }),
        }).catch(() => {})
      }
    } finally {
      savingPlaylist.current = false
    }
    send({ action: 'playlist-changed' })
  }

  // Read from the ref, not the render closure: two clicks in quick succession
  // would otherwise both start from the same list and the second undo the first.
  const handleTogglePlaylist = (postId: string) => {
    const current = latestPlaylist.current
    savePlaylist(current.includes(postId)
      ? current.filter(id => id !== postId)
      : [...current, postId])
  }

  const handlePlayPlaylist = () => {
    if (!playlist.length) return
    setPlaying(p => !p)
    send({ action: 'playlist-toggle' })
  }

  const handleRotate = () => send({ action: 'rotate' })
  const handleToggleRulers = () => send({ action: 'toggle-rulers' })
  const handleToggleDebug = () => send({ action: 'toggle-debug' })
  const handleToggleCursor = () => send({ action: 'toggle-cursor' })

  // Clips uploaded before pre-rotation existed have no rotated copy. Building
  // them has to happen in a browser (ffmpeg runs client-side here), so it is a
  // deliberate one-off action rather than something the display triggers.
  const handleBackfill = async () => {
    const videos = posts.filter(p => p.file_type === 'video')
    if (!videos.length) { setBackfill('Inga filmer'); return }
    if (!confirm(`Skapa roterade versioner för ${videos.length} filmer? Det tar en stund.`)) return

    const { rotatedVariantUrl, posterVariantUrl } = await import('@/lib/rotatedVariant')
    const { mseVariantUrl, MSE_WIDTH, MSE_HEIGHT } = await import('@/lib/mseVariant')
    const { rotateVideo90, makeMseVariant } = await import('@/lib/transcodeVideo')
    const { extractPoster } = await import('@/lib/videoPoster')

    // Uploading a variant for a clip that already exists.
    const putVariant = async (originalUrl: string, variant: string, file: File) => {
      const res = await fetch('/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forUrl: originalUrl, variant }),
      })
      if (!res.ok) throw new Error(`signering ${res.status}`)
      const { upload } = await res.json()
      const put = await supabase.storage.from('media')
        .uploadToSignedUrl(upload.path, upload.token, file)
      if (put.error) throw new Error(`uppladdning ${put.error.message}`)
    }
    let done = 0, skipped = 0, failed = 0
    // Kept and shown: a silent catch here once reported three failures with no
    // hint that the cause was a bad ffmpeg URL.
    let reason = ''

    for (const [i, post] of videos.entries()) {
      setBackfill(`${i + 1}/${videos.length}…`)
      try {
        const rotUrl = rotatedVariantUrl(post.file_url)
        const [rotOk, hasPoster, mseOk] = await Promise.all([
          fetch(rotUrl, { method: 'HEAD' }).then(r => r.ok),
          fetch(posterVariantUrl(post.file_url), { method: 'HEAD' }).then(r => r.ok),
          fetch(mseVariantUrl(post.file_url), { method: 'HEAD' }).then(r => r.ok),
        ])

        // A copy built to a different frame plays at the wrong size, so treat
        // it as missing rather than leaving it in place.
        const mseWrongSize = mseOk && await new Promise<boolean>(res => {
          const probe = document.createElement('video')
          probe.preload = 'metadata'
          probe.onloadedmetadata = () =>
            res(probe.videoWidth !== MSE_WIDTH || probe.videoHeight !== MSE_HEIGHT)
          probe.onerror = () => res(false)
          probe.src = mseVariantUrl(post.file_url)
        })
        const hasMse = mseOk && !mseWrongSize

        // An existing copy still needs redoing if it predates the resolution
        // cap: those clips are the ones that stutter on the panel.
        const oversized = rotOk && await new Promise<boolean>(res => {
          const probe = document.createElement('video')
          probe.preload = 'metadata'
          probe.onloadedmetadata = () => res(Math.max(probe.videoWidth, probe.videoHeight) > 1920)
          probe.onerror = () => res(false)
          probe.src = rotUrl
        })
        const hasRot = rotOk && !oversized

        if (hasRot && hasPoster && hasMse) { skipped++; continue }

        const original = await fetch(post.file_url)
        if (!original.ok) throw new Error(`hämtning ${original.status}`)
        const source = new File([await original.blob()], 'in.mp4', { type: 'video/mp4' })

        // The still frame first: it is quick, and it is what the board shows.
        if (!hasPoster) {
          setBackfill(`${i + 1}/${videos.length} — stillbild`)
          await putVariant(post.file_url, 'poster', await extractPoster(source))
        }

        if (!hasRot) {
          const rotated = await rotateVideo90(
            source,
            r => setBackfill(
              `${i + 1}/${videos.length} — ${oversized ? 'skalar om' : 'roterar'} ${Math.round(r * 100)}%`),
          )
          await putVariant(post.file_url, 'rot90', rotated)
        }

        if (!hasMse) {
          const normalised = await makeMseVariant(
            source,
            r => setBackfill(`${i + 1}/${videos.length} — spellista ${Math.round(r * 100)}%`),
          )
          await putVariant(post.file_url, 'mse', normalised)
        }
        done++
      } catch (e) {
        failed++
        if (!reason) reason = e instanceof Error ? e.message : String(e)
        console.error('Backfill failed for', post.file_url, e)
      }
    }
    setBackfill(
      `Klart: ${done} nya, ${skipped} fanns, ${failed} misslyckades` +
      (reason ? ` — ${reason}` : ''),
    )
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
      <CreativeWall
        initialPosts={posts}
        uploaderName="GodMode"
        onScrollChange={handleScrollChange}
        onSelectPost={handleSelectPost}
        playlistIds={playlist}
        onTogglePlaylist={picking ? handleTogglePlaylist : undefined}
      />
      <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
                    display: 'flex', gap: 10, alignItems: 'center' }}>
        {picking && (
          <span style={{ background: '#111', color: '#fff', borderRadius: 10,
                         padding: '8px 12px', fontSize: 12, fontFamily: 'system-ui' }}>
            Välj filmer · {playlist.length} valda
          </span>
        )}
        {backfill && (
          <span style={{ background: 'rgba(0,0,0,.8)', color: '#fff', borderRadius: 10,
                         padding: '8px 12px', fontSize: 12, fontFamily: 'system-ui' }}>
            {backfill}
          </span>
        )}
        <button onClick={() => setPicking(p => !p)} title="Välj filmer till spellistan"
          style={{ background: picking ? '#fff' : '#111', color: picking ? '#111' : '#fff',
                   border: '1px solid #444', borderRadius: 12,
                   padding: '10px 16px', fontSize: 18, cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}>
          ☰
        </button>
        <button onClick={handlePlayPlaylist}
          title={playlist.length ? 'Spela/stoppa spellistan på display' : 'Spellistan är tom'}
          disabled={!playlist.length}
          style={{ background: '#111', color: '#fff', border: '1px solid #444', borderRadius: 12,
                   padding: '10px 16px', fontSize: 18,
                   cursor: playlist.length ? 'pointer' : 'default',
                   opacity: playlist.length ? 1 : .4,
                   boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}>
          {playing ? '⏹' : '⏵'}
        </button>
        <button onClick={handleBackfill} title="Skapa roterade versioner av alla filmer (engångsjobb)"
          style={{ background: '#111', color: '#fff', border: '1px solid #444', borderRadius: 12,
                   padding: '10px 16px', fontSize: 18, cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}>
          ⟳▤
        </button>
        <button onClick={handleToggleCursor} title="Visa/dölj muspekaren på display"
          style={{ background: '#111', color: '#fff', border: '1px solid #444', borderRadius: 12,
                   padding: '10px 16px', fontSize: 18, cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}>
          ⌖
        </button>
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
        <button onClick={handleRotate} title="Rotera display 90°"
          style={{ background: '#111', color: '#fff', border: '1px solid #444', borderRadius: 12,
                   padding: '10px 16px', fontSize: 20, cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}>
          ↻
        </button>
      </div>
    </>
  )
}
