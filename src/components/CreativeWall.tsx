'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { Post } from '@/types'
import CanvasVideo from './CanvasVideo'
import LazyVideo from './LazyVideo'
import { posterVariantUrl } from '@/lib/rotatedVariant'

// Files go straight to storage, so this is a deliberate choice rather than a
// platform ceiling: a wall of long clips is heavy for the TV to play whatever
// the transport allows.
const MAX_UPLOAD_MB = 20
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

const COLUMN_WIDTH = 260
const COLUMN_GAP = 18
const BOARD_PADDING = 18

/**
 * Uploads to a signed storage URL, reporting how much has gone out.
 *
 * XHR rather than the supabase client, which uses fetch internally and so
 * cannot report upload progress at all.
 */
function putSigned(signedUrl: string, file: File, onProgress: (ratio: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', signedUrl)
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total) }
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300
      ? resolve()
      : reject(new Error(`HTTP ${xhr.status}`))
    xhr.onerror = () => reject(new Error('Nätverksfel'))
    xhr.send(file)
  })
}

interface Props {
  initialPosts: Post[]
  uploaderName: string
  displayMode?: boolean
  /** Reports scroll as a 0–1 fraction, plus the raw offset for the rulers. */
  onScrollChange?: (fraction: number, scrollTop: number) => void
  /** Scroll position to follow, as a 0–1 fraction of the scrollable height. */
  externalScroll?: number | null
  onSelectPost?: (postId: string | null) => void
  externalSelectedPostId?: string | null
  /** Paint videos through a <canvas> so they survive a CSS-rotated page. */
  canvasVideo?: boolean
  /** Skip the fullscreen view for videos; something outside is drawing it. */
  suppressFullscreenVideo?: boolean
  /**
   * Reports the live post list. This component keeps the canonical one — it
   * subscribes to inserts — so anything outside that needs to look a post up
   * has to follow it, or it will miss everything uploaded since page load.
   */
  onPostsChange?: (posts: Post[]) => void
}

export default function CreativeWall({
  initialPosts, uploaderName, displayMode = false,
  onScrollChange, externalScroll, onSelectPost, externalSelectedPostId,
  canvasVideo = false, suppressFullscreenVideo = false, onPostsChange,
}: Props) {
  const [posts, setPosts]               = useState<Post[]>(initialPosts)
  const [selectedPost, setSelectedPost] = useState<Post | null>(null)
  const [focusedPost, setFocusedPost]   = useState<Post | null>(null)
  const [isFileDrag, setIsFileDrag]     = useState(false)
  const [uploading, setUploading]       = useState(false)
  const [uploadName, setUploadName]     = useState(uploaderName)
  const [caption, setCaption]           = useState('')
  // What the upload is doing and how far along, so a multi-minute transcode is
  // not represented by a motionless "Laddar upp…".
  const [progress, setProgress]         = useState<{ label: string; pct: number } | null>(null)
  const fileInputRef                    = useRef<HTMLInputElement>(null)
  const dragCounter                     = useRef(0)
  const rootRef                         = useRef<HTMLDivElement>(null)

  useEffect(() => { onPostsChange?.(posts) }, [posts])
  useEffect(() => {
    const id = selectedPost?.id ?? focusedPost?.id ?? null
    onSelectPost?.(id)
  }, [selectedPost, focusedPost])

  /**
   * Natural width/height per post.
   *
   * Needed twice over: a lazily loaded <video> has no intrinsic size until it
   * loads and a card drawn by the external layer has no media element at all,
   * so their boxes would collapse; and the column packing has to know how tall
   * each card will be before placing it.
   */
  const [aspects, setAspects] = useState<Record<string, number>>({})
  useEffect(() => {
    let cancelled = false
    const record = (id: string, w: number, h: number) => {
      if (cancelled || !w || !h) return
      setAspects(prev => prev[id] ? prev : { ...prev, [id]: w / h })
    }
    for (const post of posts) {
      if (aspects[post.id]) continue
      if (post.file_type === 'image') {
        const img = new Image()
        img.onload = () => record(post.id, img.naturalWidth, img.naturalHeight)
        img.src = post.file_url
      } else {
        const probe = document.createElement('video')
        probe.preload = 'metadata'
        probe.onloadedmetadata = () => record(post.id, probe.videoWidth, probe.videoHeight)
        probe.src = post.file_url
      }
    }
    return () => { cancelled = true }
  }, [posts])

  useEffect(() => {
    const channel = supabase.channel('wall-room')
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, (payload) => {
      const p = payload.new as Post
      // Newest first, which is where the board puts it too.
      setPosts((prev) => prev.some((x) => x.id === p.id) ? prev : [p, ...prev])
    })
    channel.subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  // Column width target; the count follows the container so the same rules
  // suit a wide desk screen and the narrow portrait panel.
  const [columnCount, setColumnCount] = useState(1)
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth - BOARD_PADDING * 2
      setColumnCount(Math.max(1, Math.round((w + COLUMN_GAP) / (COLUMN_WIDTH + COLUMN_GAP))))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /**
   * Packs posts into columns, each one going to whichever column is shortest
   * so far.
   *
   * CSS multi-column balances total height but cannot move a card once placed,
   * so the tails came out ragged — one column ending a couple of hundred pixels
   * above its neighbour. Placing them here keeps the bottom edge level.
   *
   * Heights are relative: every column is the same width, so 1/aspect is
   * proportional to how tall a card will be.
   */
  const columns = useMemo(() => {
    const heightOf = (post: Post) =>
      1 / (aspects[post.id] ?? (post.file_type === 'video' ? 16 / 9 : 4 / 5))

    const cols: Post[][] = Array.from({ length: columnCount }, () => [])
    const heights: number[] = new Array(columnCount).fill(0)

    for (const post of posts) {
      let shortest = 0
      for (let i = 1; i < columnCount; i++) {
        if (heights[i] < heights[shortest]) shortest = i
      }
      cols[shortest].push(post)
      heights[shortest] += heightOf(post)
    }

    // Placing each card in the shortest column still leaves the bottom edge
    // ragged by up to a whole card, because the last few have nowhere better to
    // go. This evens it out by moving a card across, or swapping a tall one for
    // a shorter one, whenever that narrows the gap between the longest and
    // shortest column. Only the gap is optimised, so the ordering stays broadly
    // newest-first.
    for (let pass = 0; pass < 60; pass++) {
      let tallest = 0, shortest = 0
      for (let i = 1; i < columnCount; i++) {
        if (heights[i] > heights[tallest]) tallest = i
        if (heights[i] < heights[shortest]) shortest = i
      }
      if (tallest === shortest) break

      const gap = heights[tallest] - heights[shortest]
      let best = { gain: 0, move: -1, swap: -1 }

      for (let a = 0; a < cols[tallest].length; a++) {
        const ha = heightOf(cols[tallest][a])
        // Moving one across: the gap closes by twice its height, and overshoots
        // once it is taller than the gap itself.
        const gain = gap - Math.abs(gap - 2 * ha)
        if (gain > best.gain) best = { gain, move: a, swap: -1 }

        for (let b = 0; b < cols[shortest].length; b++) {
          const diff = ha - heightOf(cols[shortest][b])
          if (diff <= 0) continue
          const swapGain = gap - Math.abs(gap - 2 * diff)
          if (swapGain > best.gain) best = { gain: swapGain, move: a, swap: b }
        }
      }

      // Anything below a hair of a card is not worth reordering for.
      if (best.gain < 0.02) break

      if (best.swap === -1) {
        const [post] = cols[tallest].splice(best.move, 1)
        const h = heightOf(post)
        cols[shortest].push(post)
        heights[tallest] -= h
        heights[shortest] += h
      } else {
        const from = cols[tallest][best.move]
        const to = cols[shortest][best.swap]
        cols[tallest][best.move] = to
        cols[shortest][best.swap] = from
        const diff = heightOf(from) - heightOf(to)
        heights[tallest] -= diff
        heights[shortest] += diff
      }
    }

    return cols
  }, [posts, aspects, columnCount])

  const emitScroll = () => {
    const el = rootRef.current
    if (!el || !onScrollChange) return
    const max = el.scrollHeight - el.clientHeight
    onScrollChange(max > 0 ? el.scrollTop / max : 0, el.scrollTop)
  }

  // Applied against this board's own scrollable height rather than a pixel
  // offset, because the display is a different shape from the controlling
  // screen and its columns are a different length.
  useEffect(() => {
    if (externalScroll == null) return
    const el = rootRef.current
    if (!el) return
    const max = el.scrollHeight - el.clientHeight
    if (max <= 0) return
    const target = externalScroll * max
    if (Math.abs(el.scrollTop - target) > 2) el.scrollTop = target
  }, [externalScroll, posts])

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (!list.length) return
    setUploading(true)
    for (const [index, file] of list.entries()) {
      const many = list.length > 1 ? ` (${index + 1}/${list.length})` : ''
      // Phases are given fixed shares of the bar so it only ever moves forward.
      // Transcoding dominates by far, so it gets most of the range.
      const step = (label: string, from: number, to: number, ratio = 1) =>
        setProgress({ label: label + many, pct: Math.round(from + (to - from) * ratio) })

      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
        alert(`Filtyp stöds ej: ${file.type}`); continue
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        alert(`Max ${MAX_UPLOAD_MB} MB per fil`); continue
      }

      let fileToUpload = file
      let rotatedFile: File | null = null
      let posterFile: File | null = null
      const isVideo = file.type.startsWith('video/')

      if (isVideo) {
        try {
          step('Förbereder film', 0, 0)
          const { transcodeToH264, rotateVideo90 } = await import('@/lib/transcodeVideo')
          fileToUpload = await transcodeToH264(file, r => step('Konverterar film', 2, 50, r))
          // The board shows this instead of playing the clip.
          try {
            const { extractPoster } = await import('@/lib/videoPoster')
            posterFile = await extractPoster(fileToUpload)
          } catch (e) {
            console.warn('Poster failed, board will play the clip instead:', e)
          }
          // A rotated display cannot rotate video at playback time on a TV, so
          // a pre-rotated copy is made here. Failing to build it only costs
          // correct rotation on the display, so it must not fail the upload.
          try {
            rotatedFile = await rotateVideo90(fileToUpload, r => step('Skapar roterad version', 50, 85, r))
          } catch (e) {
            console.warn('Rotated variant failed, display will use the original:', e)
          }
        } catch (e) {
          console.warn('Transcoding failed, uploading original:', e)
        }
      }

      // Straight to storage: routing the bytes through a serverless function
      // would cap them at 4.5 MB, and the rotated copy shared that budget.
      const ext = isVideo ? 'mp4' : (file.name.split('.').pop() || 'jpg')
      const urlRes = await fetch('/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ext, rotated: !!rotatedFile, poster: !!posterFile }),
      })
      if (!urlRes.ok) {
        const { error } = await urlRes.json().catch(() => ({ error: 'Kunde inte starta uppladdning' }))
        alert(`Upload error: ${error}`); continue
      }
      const { upload, url: publicUrl, rotatedUpload, posterUpload } = await urlRes.json()

      const from = isVideo ? 85 : 0
      try {
        await putSigned(upload.signedUrl, fileToUpload, r => step('Laddar upp', from, isVideo ? 94 : 90, r))
      } catch (e) {
        alert(`Upload error: ${e instanceof Error ? e.message : e}`); continue
      }

      if (rotatedFile && rotatedUpload) {
        try {
          await putSigned(rotatedUpload.signedUrl, rotatedFile, r => step('Laddar upp roterad', 94, 99, r))
        } catch (e) {
          // Only costs correct rotation on the display, so it must not fail the post.
          console.warn('Rotated upload failed:', e)
        }
      }

      if (posterFile && posterUpload) {
        try {
          await putSigned(posterUpload.signedUrl, posterFile, () => {})
        } catch (e) {
          console.warn('Poster upload failed:', e)
        }
      }

      step('Sparar', 99, 99)
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_url: publicUrl,
          file_type: isVideo ? 'video' : 'image',
          uploader_name: uploadName.trim() || 'Anonymous',
          caption: caption.trim() || null,
        }),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Unknown error' }))
        alert(`DB error: ${error}`)
      }
    }
    setCaption('')
    setUploading(false)
    setProgress(null)
  }, [uploadName, caption])

  useEffect(() => {
    if (displayMode) return
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      dragCounter.current++
      setIsFileDrag(true)
    }
    const onDragLeave = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      dragCounter.current--
      if (dragCounter.current <= 0) { dragCounter.current = 0; setIsFileDrag(false) }
    }
    const onDragOver = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault() }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      dragCounter.current = 0
      setIsFileDrag(false)
      if (e.dataTransfer?.files.length) uploadFiles(e.dataTransfer.files)
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('dragover',  onDragOver)
    window.addEventListener('drop',      onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragover',  onDragOver)
      window.removeEventListener('drop',      onDrop)
    }
  }, [uploadFiles, displayMode])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setFocusedPost(null); setSelectedPost(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleDelete = async (post: Post) => {
    await fetch(`/api/posts/${post.id}`, { method: 'DELETE' })
    setPosts((prev) => prev.filter((p) => p.id !== post.id))
    setSelectedPost(null)
  }

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen()
    else document.exitFullscreen()
  }

  const handleCardClick = (post: Post) => {
    if (displayMode) setFocusedPost((prev) => prev?.id === post.id ? null : post)
    else setSelectedPost(post)
  }

  return (
    <div className="wall-root" ref={rootRef} onScroll={emitScroll}>

      {!displayMode && (
        <header className="topbar">
          <div className="topbar-left">
            {progress ? (
              <div className="upload-progress" role="status" aria-live="polite">
                <div className="upload-progress-head">
                  <span>{progress.label}</span>
                  <span className="upload-progress-pct">{progress.pct}%</span>
                </div>
                <div className="upload-progress-track">
                  <div className="upload-progress-fill" style={{ width: `${progress.pct}%` }} />
                </div>
              </div>
            ) : (
              <span className="zoom-hint">Nyast först · scrolla för att bläddra</span>
            )}
          </div>
          <div className="topbar-right">
            <input
              className="field nm"
              type="text"
              placeholder="Ditt namn"
              value={uploadName}
              onChange={(e) => { setUploadName(e.target.value); localStorage.setItem('showandtell_name', e.target.value) }}
            />
            <input
              className="field cp"
              type="text"
              placeholder="Beskrivning…"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
            <button
              className={`upload-btn ${uploading ? 'uploading' : ''}`}
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? 'Laddar upp…' : '＋ Lägg till'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/mp4,video/quicktime"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); e.target.value = '' }}
            />
            <button className="upload-btn" onClick={toggleFullscreen}>⛶</button>
          </div>
        </header>
      )}

      <div className="board" style={{ paddingTop: displayMode ? 20 : 73 }}>
        {columns.map((col, i) => (
          <div className="board-col" key={i}>
            {col.map((post) => (
              <BoardCard
                key={post.id}
                post={post}
                displayMode={displayMode}
                canvasVideo={canvasVideo}
                    aspect={aspects[post.id]}
                onClick={() => handleCardClick(post)}
              />
            ))}
          </div>
        ))}
      </div>

      {isFileDrag && (
        <div className="drop-overlay">
          <div className="drop-box">
            <div className="drop-icon">⬆</div>
            <h2>Släpp för att ladda upp</h2>
            <p>JPG · PNG · GIF · MP4 · MOV</p>
          </div>
        </div>
      )}

      {(() => {
        const lbPost = selectedPost ?? (externalSelectedPostId ? posts.find(p => p.id === externalSelectedPostId) ?? null : null)
        const isExternal = !selectedPost && !!externalSelectedPostId
        if (!lbPost) return null
        if (!isExternal && displayMode) return null
        // A rotated display draws fullscreen video in its own overlay; letting
        // this render too would put a second element on the same clip.
        if (suppressFullscreenVideo && lbPost.file_type === 'video') return null
        return (
          <div className="lightbox" onClick={() => !isExternal && setSelectedPost(null)}>
            {!isExternal && <button className="lb-delete" onClick={(e) => { e.stopPropagation(); handleDelete(lbPost) }}>🗑 Ta bort</button>}
            {!isExternal && <button className="lb-close" onClick={(e) => { e.stopPropagation(); setSelectedPost(null) }}>✕ Stäng</button>}
            {lbPost.file_type === 'image'
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={lbPost.file_url} alt={lbPost.caption ?? ''} />
              : canvasVideo
                ? <CanvasVideo src={lbPost.file_url} />
                : <video src={lbPost.file_url} autoPlay loop playsInline muted controls={!isExternal} />
            }
            {!isExternal && (lbPost.uploader_name || lbPost.caption) && (
              <div className="lb-footer">
                <span className="lb-user">{lbPost.uploader_name}</span>
                {lbPost.caption && <span className="lb-caption">{lbPost.caption}</span>}
              </div>
            )}
          </div>
        )
      })()}

      {focusedPost && displayMode && (
        <div className="show-only" onClick={() => setFocusedPost(null)}>
          {focusedPost.file_type === 'image'
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={focusedPost.file_url} alt={focusedPost.caption ?? ''} />
            : canvasVideo
              ? <CanvasVideo src={focusedPost.file_url} />
              : <video src={focusedPost.file_url} autoPlay loop playsInline muted />
          }
          <div className="show-only-hint">Klicka för att stänga</div>
        </div>
      )}

      <style>{`
        .wall-root {
          height: 100vh; overflow-y: auto; overflow-x: hidden;
          background: #efefef;
          scrollbar-width: none;
        }
        .wall-root::-webkit-scrollbar { display: none; }
        /* Columns are packed in JS rather than by CSS multi-column, which
           cannot even out the bottom edge. See the columns memo. */
        .board {
          display: flex;
          align-items: flex-start;
          gap: ${COLUMN_GAP}px;
          padding: 0 ${BOARD_PADDING}px 24px;
        }
        .board-col {
          flex: 1; min-width: 0;
          display: flex; flex-direction: column; gap: ${COLUMN_GAP}px;
        }
        .topbar {
          position: fixed; top: 0; left: 0; right: 0; z-index: 100;
          display: flex; align-items: center; justify-content: space-between;
          padding: 12px 20px;
          background: rgba(239,239,239,.88);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(0,0,0,.07);
        }
        .topbar-left { display: flex; align-items: center; }
        .zoom-hint { font-size: 11px; color: #bbb; }
        .upload-progress { width: 260px; }
        .upload-progress-head {
          display: flex; justify-content: space-between; align-items: baseline;
          font-size: 11px; color: #666; margin-bottom: 5px;
        }
        .upload-progress-pct { font-variant-numeric: tabular-nums; color: #999; }
        .upload-progress-track {
          height: 4px; border-radius: 2px; background: rgba(0,0,0,.1); overflow: hidden;
        }
        .upload-progress-fill {
          height: 100%; background: #111; border-radius: 2px;
          transition: width .2s ease;
        }
        .topbar-right { display: flex; align-items: center; gap: 8px; }
        .field {
          background: #fff; border: 1px solid rgba(0,0,0,.12);
          border-radius: 8px; padding: 8px 12px;
          font-size: 12px; color: #111; outline: none; font-family: inherit;
        }
        .field::placeholder { color: #bbb; }
        .field.nm { width: 120px; }
        .field.cp { width: 190px; }
        .field:focus { border-color: rgba(0,0,0,.3); }
        .upload-btn {
          background: #111; color: #fff; border: none; border-radius: 8px;
          padding: 9px 18px; font-size: 12px; font-weight: 600;
          cursor: pointer; font-family: inherit; white-space: nowrap; transition: opacity .15s;
        }
        .upload-btn:hover:not(.uploading) { opacity: .82; }
        .upload-btn.uploading { opacity: .5; cursor: default; }
        .drop-overlay {
          position: fixed; inset: 0; z-index: 200;
          display: flex; align-items: center; justify-content: center;
          background: rgba(0,0,0,.55); backdrop-filter: blur(8px); pointer-events: none;
        }
        .drop-box {
          background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.2);
          border-radius: 28px; padding: 60px 80px; text-align: center; color: #fff;
        }
        .drop-icon { font-size: 48px; margin-bottom: 16px; }
        .drop-box h2 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
        .drop-box p  { font-size: 14px; opacity: .6; }
        .lightbox {
          position: fixed; inset: 0; z-index: 300;
          background: #000;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          animation: fadeIn .2s ease;
        }
        .lightbox img, .lightbox video, .lightbox canvas {
          display: block; width: 100%; height: 100%;
          object-fit: contain; pointer-events: none;
        }
        .lb-close {
          position: fixed; top: 20px; right: 24px; z-index: 10;
          background: rgba(255,255,255,.15); color: #fff; border: none; border-radius: 20px;
          padding: 7px 16px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit;
          backdrop-filter: blur(8px);
        }
        .lb-delete {
          position: fixed; top: 20px; left: 24px; z-index: 10;
          background: rgba(220,0,51,.8); color: #fff; border: none; border-radius: 20px;
          padding: 7px 16px; font-size: 12px; font-weight: 600;
          cursor: pointer; font-family: inherit; transition: opacity .15s;
          backdrop-filter: blur(8px);
        }
        .lb-delete:hover { opacity: .82; }
        .lb-footer {
          position: fixed; bottom: 0; left: 0; right: 0;
          padding: 20px 28px; display: flex; gap: 10px; align-items: baseline;
          background: linear-gradient(transparent, rgba(0,0,0,.7));
          pointer-events: none;
        }
        .lb-user    { font-size: 14px; font-weight: 700; color: #fff; }
        .lb-caption { font-size: 13px; color: rgba(255,255,255,.7); }
        .show-only {
          position: fixed; inset: 0; z-index: 400;
          background: #000;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          animation: fadeIn .3s ease;
        }
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        .show-only img, .show-only video, .show-only canvas {
          max-width: 100%; max-height: 100%;
          object-fit: contain; display: block;
        }
        .show-only-hint {
          position: absolute; top: 20px; right: 24px;
          font-size: 11px; color: rgba(255,255,255,.3);
          pointer-events: none;
        }
      `}</style>
    </div>
  )
}

interface CardProps {
  post: Post
  displayMode: boolean
  canvasVideo: boolean
  aspect?: number
  onClick: () => void
}

function BoardCard({ post, displayMode, canvasVideo, aspect, onClick }: CardProps) {
  const isVideo = post.file_type === 'video'
  const [posterFailed, setPosterFailed] = useState(false)

  return (
    <article
      className={`wall-card ${displayMode ? 'display-mode' : ''}`}
      onClick={onClick}
    >
      <div
        className="card-media"
        // Reserving the box from the measured ratio keeps the packing honest:
        // if a card grew after placement the column heights would no longer
        // match what they were packed against. The fallbacks apply only until
        // the real ratio is read.
        style={{ aspectRatio: String(aspect ?? (isVideo ? 16 / 9 : 4 / 5)) }}
      >
        {post.file_type === 'image'
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={post.file_url} alt={post.caption ?? ''} draggable={false} />
          : posterFailed
            // No still frame yet — clips uploaded before posters existed, or
            // missed by the backfill. Playing it is the old behaviour and looks
            // right everywhere except a rotated TV.
            ? (canvasVideo
                ? <CanvasVideo src={post.file_url} />
                : <LazyVideo src={post.file_url} />)
            // eslint-disable-next-line @next/next/no-img-element
            : <img
                src={posterVariantUrl(post.file_url)}
                alt={post.caption ?? ''}
                draggable={false}
                onError={() => setPosterFailed(true)}
              />
        }
        {isVideo && <span className="play-badge" aria-hidden="true">▶</span>}
        {!displayMode && (
          <div className="card-hover-overlay">
            <span className="card-user">{post.uploader_name}</span>
            {post.caption && <span className="card-caption">{post.caption}</span>}
          </div>
        )}
        {displayMode && (
          <div className="display-label">
            <span className="card-user">{post.uploader_name}</span>
            {post.caption && <span className="card-caption">{post.caption}</span>}
          </div>
        )}
      </div>

      <style>{`
        .wall-card {
          display: block; width: 100%;
          cursor: pointer; border-radius: 22px;
          background: #fff; border: 1px solid rgba(0,0,0,.08);
          box-shadow: 0 4px 20px rgba(0,0,0,.13), 0 1px 4px rgba(0,0,0,.06);
          transition: box-shadow .2s ease, transform .2s ease;
        }
        .wall-card:hover { box-shadow: 0 18px 52px rgba(0,0,0,.22), 0 2px 8px rgba(0,0,0,.1); }
        .wall-card:not(.display-mode):hover { transform: translateY(-2px); }
        .card-media { position: relative; overflow: hidden; width: 100%; border-radius: 22px; }
        .card-media img, .card-media video, .card-media canvas {
          width: 100%; height: 100%; object-fit: cover; display: block;
          transition: transform .45s ease; pointer-events: none;
        }
        .wall-card:not(.display-mode):hover .card-media img,
        .wall-card:not(.display-mode):hover .card-media video { transform: scale(1.05); }
        .card-hover-overlay {
          position: absolute; inset: 0;
          background: linear-gradient(to top, rgba(0,0,0,.72) 0%, rgba(0,0,0,.1) 50%, transparent 100%);
          display: flex; flex-direction: column; justify-content: flex-end;
          padding: 14px; opacity: 0;
          transition: opacity .25s ease, transform .25s ease;
          transform: translateY(6px); border-radius: 22px;
        }
        .wall-card:hover .card-hover-overlay { opacity: 1; transform: translateY(0); }
        .display-label {
          position: absolute; bottom: 0; left: 0; right: 0;
          background: linear-gradient(to top, rgba(0,0,0,.65) 0%, transparent 100%);
          display: flex; flex-direction: column; justify-content: flex-end;
          padding: 14px; border-radius: 0 0 22px 22px;
        }
        .card-user    { font-size: 12px; font-weight: 700; color: #fff; }
        .card-caption { font-size: 11px; color: rgba(255,255,255,.75); margin-top: 2px; }
        /* The board shows a still, so a clip needs saying so. */
        .play-badge {
          position: absolute; top: 10px; right: 10px;
          width: 26px; height: 26px; border-radius: 50%;
          background: rgba(0,0,0,.55); backdrop-filter: blur(6px);
          color: #fff; font-size: 10px;
          display: flex; align-items: center; justify-content: center;
          padding-left: 2px; pointer-events: none;
        }
      `}</style>
    </article>
  )
}
