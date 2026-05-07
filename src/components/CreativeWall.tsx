'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Post } from '@/types'

function seededRand(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 2654435761)
    h ^= h >>> 16
  }
  return ((h >>> 0) / 0xffffffff) * 2 - 1
}

function basePosition(id: string): { x: number; y: number } {
  const a = seededRand(id + 'x')
  const b = seededRand(id + 'y')
  return { x: a * 680, y: b * 480 }
}

function aspectW(type: string): number {
  return type === 'video' ? 320 : 230
}

function debounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number) {
  let timer: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

function findEmptySpot(posts: Post[]): { x: number; y: number } {
  const W = 260
  const H = 340
  const PADDING = 30
  const candidates = [
    { x: 0, y: 0 }, { x: 320, y: 0 }, { x: -320, y: 0 },
    { x: 0, y: 380 }, { x: 0, y: -380 },
    { x: 320, y: 380 }, { x: -320, y: 380 },
    { x: 320, y: -380 }, { x: -320, y: -380 },
    { x: 640, y: 0 }, { x: -640, y: 0 },
  ]
  for (const c of candidates) {
    const overlaps = posts.some((p) => {
      const px = p.pos_x || basePosition(p.id).x
      const py = p.pos_y || basePosition(p.id).y
      return Math.abs(px - c.x) < W + PADDING && Math.abs(py - c.y) < H + PADDING
    })
    if (!overlaps) return c
  }
  return { x: Math.random() * 400 - 200, y: Math.random() * 400 - 200 }
}

const MIN_ZOOM = 0.2
const MAX_ZOOM = 3

interface Props {
  initialPosts: Post[]
  uploaderName: string
  displayMode?: boolean
}

type LivePositions = Record<string, { x: number; y: number }>
type LiveSizes = Record<string, number>

export default function CreativeWall({ initialPosts, uploaderName, displayMode = false }: Props) {
  const [posts, setPosts]                 = useState<Post[]>(initialPosts)
  const [selectedPost, setSelectedPost]   = useState<Post | null>(null)
  const [focusedPost, setFocusedPost]     = useState<Post | null>(null)
  const [isFileDrag, setIsFileDrag]       = useState(false)
  const [uploading, setUploading]         = useState(false)
  const [uploadName, setUploadName]       = useState(uploaderName)
  const [caption, setCaption]             = useState('')
  const [livePositions, setLivePositions] = useState<LivePositions>({})
  const [liveSizes, setLiveSizes]         = useState<LiveSizes>({})
  const fileInputRef                      = useRef<HTMLInputElement>(null)
  const dragCounter                       = useRef(0)
  const broadcastChannel                  = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const [zoom, setZoom] = useState(1)
  const [pan, setPan]   = useState({ x: 0, y: 0 })
  const isPanning       = useRef(false)
  const panMoved        = useRef(false)
  const panStart        = useRef({ x: 0, y: 0 })
  const panOrigin       = useRef({ x: 0, y: 0 })
  const stageRef        = useRef<HTMLDivElement>(null)

  const [zOrders, setZOrders] = useState<Record<string, number>>({})
  const zCounter              = useRef(1)

  const bringToFront = (id: string) => {
    zCounter.current++
    setZOrders((prev) => ({ ...prev, [id]: zCounter.current }))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const savePosition = useCallback(
    debounce((id: string, pos_x: number, pos_y: number) => {
      fetch(`/api/posts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pos_x, pos_y }),
      })
    }, 600),
    []
  )

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saveSize = useCallback(
    debounce((id: string, card_size: number) => {
      fetch(`/api/posts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_size }),
      })
    }, 600),
    []
  )

  useEffect(() => {
    const channel = supabase.channel('wall-room')

    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, (payload) => {
      const p = payload.new as Post
      setPosts((prev) => {
        if (prev.some((x) => x.id === p.id)) return prev
        const spot    = findEmptySpot(prev)
        const newPost = { ...p, pos_x: spot.x, pos_y: spot.y }
        fetch(`/api/posts/${p.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pos_x: spot.x, pos_y: spot.y }),
        })
        zCounter.current++
        setZOrders((z) => ({ ...z, [p.id]: zCounter.current }))
        return [newPost, ...prev]
      })
    })

    channel.on('broadcast', { event: 'move' }, ({ payload }) => {
      const { id, x, y } = payload as { id: string; x: number; y: number }
      setLivePositions((prev) => ({ ...prev, [id]: { x, y } }))
    })

    channel.on('broadcast', { event: 'resize' }, ({ payload }) => {
      const { id, w } = payload as { id: string; w: number }
      setLiveSizes((prev) => ({ ...prev, [id]: w }))
    })

    channel.subscribe()
    broadcastChannel.current = channel

    return () => { supabase.removeChannel(channel) }
  }, [])

  const broadcastMove = useCallback((id: string, x: number, y: number) => {
    broadcastChannel.current?.send({ type: 'broadcast', event: 'move', payload: { id, x, y } })
  }, [])

  const broadcastResize = useCallback((id: string, w: number) => {
    broadcastChannel.current?.send({ type: 'broadcast', event: 'resize', payload: { id, w } })
  }, [])

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (!list.length) return
    setUploading(true)
    for (const file of list) {
      const allowed = ['image/jpeg','image/png','image/gif','image/webp','video/mp4','video/quicktime']
      if (!allowed.includes(file.type)) { alert(`Filtyp stöds ej: ${file.type}`); continue }
      if (file.size > 50 * 1024 * 1024) { alert('Max 50MB per fil'); continue }

      const ext      = file.name.split('.').pop() ?? 'bin'
      const fileName = `${crypto.randomUUID()}.${ext}`
      const fileType = file.type.startsWith('video/') ? 'video' : 'image'

      const { error: storageError } = await supabase.storage
        .from('media')
        .upload(fileName, file, { contentType: file.type, upsert: false })

      if (storageError) { alert(`Storage error: ${storageError.message}`); continue }

      const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(fileName)

      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_url: publicUrl,
          file_type: fileType,
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
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY * -0.001
      setZoom((prev) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + delta * prev)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setFocusedPost(null); setSelectedPost(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onStageMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const isCard = target.closest('.wall-card')
    if (e.button === 1 || (!isCard && e.button === 0)) {
      isPanning.current = true
      panMoved.current  = false
      panStart.current  = { x: e.clientX, y: e.clientY }
      panOrigin.current = { ...pan }
      e.preventDefault()
    }
  }

  const onStageMouseMove = (e: React.MouseEvent) => {
    if (!isPanning.current) return
    const dx = e.clientX - panStart.current.x
    const dy = e.clientY - panStart.current.y
    if (Math.hypot(dx, dy) > 4) panMoved.current = true
    if (!panMoved.current) return
    setPan({ x: panOrigin.current.x + dx / zoom, y: panOrigin.current.y + dy / zoom })
  }

  const onStageMouseUp = () => { isPanning.current = false; panMoved.current = false }

  const handleDelete = async (post: Post) => {
    await fetch(`/api/posts/${post.id}`, { method: 'DELETE' })
    setPosts((prev) => prev.filter((p) => p.id !== post.id))
    setSelectedPost(null)
  }

  const handleMoved = (post: Post, dx: number, dy: number) => {
    const base = basePosition(post.id)
    const newX = (post.pos_x !== null && post.pos_x !== undefined ? post.pos_x : base.x) + dx
    const newY = (post.pos_y !== null && post.pos_y !== undefined ? post.pos_y : base.y) + dy
    setPosts((prev) => prev.map((p) => p.id === post.id ? { ...p, pos_x: newX, pos_y: newY } : p))
    setLivePositions((prev) => { const n = { ...prev }; delete n[post.id]; return n })
    savePosition(post.id, newX, newY)
  }

  const handleResized = (post: Post, newW: number) => {
    setPosts((prev) => prev.map((p) => p.id === post.id ? { ...p, card_size: newW } : p))
    setLiveSizes((prev) => { const n = { ...prev }; delete n[post.id]; return n })
    saveSize(post.id, newW)
  }

  const fitAll = () => {
  if (posts.length === 0) return
  const PADDING = 100
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

  posts.forEach((p) => {
    const base = basePosition(p.id)
    const posX = (p.pos_x !== null && p.pos_x !== undefined) ? p.pos_x : base.x
    const posY = (p.pos_y !== null && p.pos_y !== undefined) ? p.pos_y : base.y
    const w    = p.card_size || aspectW(p.file_type)
    const h    = p.file_type === 'video' ? w * 9 / 16 : w * 5 / 4

    // Canvas är 1400x1200, kort placeras med left:50%(=700), top:50%(=600), marginTop:-100
    const canvasX = 700 + posX
    const canvasY = 500 + posY + h / 2

    minX = Math.min(minX, canvasX - w / 2)
    maxX = Math.max(maxX, canvasX + w / 2)
    minY = Math.min(minY, canvasY - h / 2)
    maxY = Math.max(maxY, canvasY + h / 2)
  })

  const contentW = maxX - minX + PADDING * 2
  const contentH = maxY - minY + PADDING * 2
  const viewW    = window.innerWidth
  const viewH    = window.innerHeight - 53

  const newZoom     = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(viewW / contentW, viewH / contentH)))
  const centerX     = (minX + maxX) / 2
  const centerY     = (minY + maxY) / 2

  // Canvasens mittpunkt är 700, 600
  setZoom(newZoom)
  setPan({ x: -(centerX - 700), y: -(centerY - 600) })
}

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
  }

  const handleCardClick = (post: Post) => {
    if (displayMode) {
      setFocusedPost((prev) => prev?.id === post.id ? null : post)
    } else {
      bringToFront(post.id)
      setSelectedPost(post)
    }
  }

  return (
    <div className="wall-root">

      {!displayMode && (
        <header className="topbar">
          <div className="topbar-left">
            <span className="zoom-hint">Scroll för att zooma · Dra bakgrunden för att panorera</span>
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
            <div className="zoom-controls">
              <button onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.2))}>＋</button>
              <span>{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.2))}>－</button>
              <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}>↺</button>
            </div>
            <button className="upload-btn" onClick={fitAll} title="Visa alla">⊡</button>
            <button className="upload-btn" onClick={toggleFullscreen}>⛶</button>
          </div>
        </header>
      )}

      <div
        ref={stageRef}
        className="wall-stage"
        style={{ marginTop: displayMode ? 0 : 53 }}
        onMouseDown={onStageMouseDown}
        onMouseMove={onStageMouseMove}
        onMouseUp={onStageMouseUp}
        onMouseLeave={onStageMouseUp}
      >
        <div
          className="wall-canvas"
          style={{ transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`, transformOrigin: 'center center' }}
        >
          {posts.map((post) => {
            const base  = basePosition(post.id)
            const live  = livePositions[post.id]
            const initX = live?.x ?? (post.pos_x !== null && post.pos_x !== undefined ? post.pos_x : base.x)
            const initY = live?.y ?? (post.pos_y !== null && post.pos_y !== undefined ? post.pos_y : base.y)
            const w     = liveSizes[post.id] ?? post.card_size ?? aspectW(post.file_type)
            const z     = zOrders[post.id] ?? 1

            return (
              <DraggableCard
                key={post.id}
                post={post}
                initX={initX}
                initY={initY}
                width={w}
                zIndex={z}
                isLive={!!live}
                displayMode={displayMode}
                onDragging={(x, y) => broadcastMove(post.id, x, y)}
                onResizing={(w) => broadcastResize(post.id, w)}
                onMoved={(dx, dy) => { bringToFront(post.id); handleMoved(post, dx, dy) }}
                onResized={(newW) => handleResized(post, newW)}
                onClick={() => handleCardClick(post)}
              />
            )
          })}
        </div>
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

      {selectedPost && !displayMode && (
        <div className="lightbox" onClick={() => setSelectedPost(null)}>
          <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <button className="lb-delete" onClick={() => handleDelete(selectedPost)}>🗑 Ta bort</button>
            <button className="lb-close"  onClick={() => setSelectedPost(null)}>✕ Stäng</button>
            <div className="lb-media">
              {selectedPost.file_type === 'image'
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={selectedPost.file_url} alt={selectedPost.caption ?? ''} />
                : <video src={selectedPost.file_url} controls autoPlay loop playsInline />
              }
            </div>
            <div className="lb-footer">
              <span className="lb-user">{selectedPost.uploader_name}</span>
              {selectedPost.caption && <span className="lb-caption">{selectedPost.caption}</span>}
            </div>
          </div>
        </div>
      )}

      {focusedPost && displayMode && (
        <div className="show-only" onClick={() => setFocusedPost(null)}>
          {focusedPost.file_type === 'image'
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={focusedPost.file_url} alt={focusedPost.caption ?? ''} />
            : <video src={focusedPost.file_url} autoPlay loop playsInline muted />
          }
          <div className="show-only-hint">Klicka för att stänga</div>
        </div>
      )}

      <style>{`
        .wall-root { min-height: 100vh; background: #efefef; overflow: hidden; display: flex; flex-direction: column; }
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
        .zoom-controls {
          display: flex; align-items: center; gap: 4px;
          background: #fff; border: 1px solid rgba(0,0,0,.12);
          border-radius: 8px; padding: 4px 8px;
        }
        .zoom-controls button {
          background: none; border: none; cursor: pointer;
          font-size: 14px; font-weight: 600; color: #555;
          padding: 2px 6px; border-radius: 4px; font-family: inherit; transition: background .1s;
        }
        .zoom-controls button:hover { background: #f0f0f0; }
        .zoom-controls span { font-size: 11px; color: #888; min-width: 36px; text-align: center; }
        .wall-stage {
          flex: 1; overflow: hidden;
          width: 100vw; height: calc(100vh - 53px);
          cursor: grab; display: flex; align-items: center; justify-content: center;
        }
        .wall-stage:active { cursor: grabbing; }
        .wall-canvas { position: relative; width: 1400px; height: 1200px; flex-shrink: 0; }
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
          display: flex; align-items: center; justify-content: center;
          background: rgba(0,0,0,.8); backdrop-filter: blur(10px); padding: 24px;
        }
        .lightbox-inner {
          position: relative; background: #fff; border-radius: 24px; overflow: hidden;
          max-width: 900px; width: 100%; box-shadow: 0 32px 80px rgba(0,0,0,.4);
        }
        .lb-close {
          position: absolute; top: 14px; right: 14px; z-index: 10;
          background: #111; color: #fff; border: none; border-radius: 20px;
          padding: 7px 16px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit;
        }
        .lb-delete {
          position: absolute; top: 14px; left: 14px; z-index: 10;
          background: #e03; color: #fff; border: none; border-radius: 20px;
          padding: 7px 16px; font-size: 12px; font-weight: 600;
          cursor: pointer; font-family: inherit; transition: opacity .15s;
        }
        .lb-delete:hover { opacity: .82; }
        .lb-media { background: #000; }
        .lb-media img, .lb-media video { display: block; width: 100%; max-height: 80vh; object-fit: contain; }
        .lb-footer {
          padding: 16px 20px; display: flex; gap: 10px; align-items: baseline;
          border-top: 1px solid rgba(0,0,0,.08);
        }
        .lb-user    { font-size: 13px; font-weight: 700; color: #111; }
        .lb-caption { font-size: 12px; color: #777; }
        .show-only {
          position: fixed; inset: 0; z-index: 400;
          background: #000;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          animation: fadeIn .3s ease;
        }
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        .show-only img, .show-only video {
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
  initX: number
  initY: number
  width: number
  zIndex: number
  isLive: boolean
  displayMode: boolean
  onDragging: (x: number, y: number) => void
  onResizing: (w: number) => void
  onMoved: (dx: number, dy: number) => void
  onResized: (newW: number) => void
  onClick: () => void
}

function DraggableCard({ post, initX, initY, width, zIndex, isLive, displayMode, onDragging, onResizing, onMoved, onResized, onClick }: CardProps) {
  const resizing    = useRef(false)
  const startX      = useRef(0)
  const startW      = useRef(0)
  const dragging    = useRef(false)
  const dragStartX  = useRef(0)
  const dragStartY  = useRef(0)
  const posX        = useRef(initX)
  const posY        = useRef(initY)
  const cardRef     = useRef<HTMLElement>(null)
  const aspectClass = post.file_type === 'video' ? 'aspect-video' : 'aspect-[4/5]'

  useEffect(() => {
    if (!dragging.current) {
      posX.current = initX
      posY.current = initY
      if (cardRef.current) {
        cardRef.current.style.transform = `translate(${initX}px, ${initY}px)`
      }
    }
  }, [initX, initY])

  useEffect(() => {
    if (!resizing.current && cardRef.current) {
      cardRef.current.style.width = `${width}px`
    }
  }, [width])

  const setCardTransform = (x: number, y: number) => {
    if (cardRef.current) {
      cardRef.current.style.transform = `translate(${x}px, ${y}px)`
    }
  }

  const onCardPointerDown = (e: React.PointerEvent) => {
    if (resizing.current) return
    if ((e.target as HTMLElement).classList.contains('resize-handle')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current   = true
    dragStartX.current = e.clientX - posX.current
    dragStartY.current = e.clientY - posY.current
  }

  const onCardPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || displayMode) return
    posX.current = e.clientX - dragStartX.current
    posY.current = e.clientY - dragStartY.current
    setCardTransform(posX.current, posY.current)
    onDragging(posX.current, posY.current)
  }

  const onCardPointerUp = () => {
    if (!dragging.current) return
    dragging.current = false
    const dx = posX.current - initX
    const dy = posY.current - initY
    if (Math.hypot(dx, dy) < 6) {
      onClick()
    } else if (!displayMode) {
      onMoved(dx, dy)
    }
  }

  const onResizePointerDown = (e: React.PointerEvent) => {
    if (displayMode) return
    e.stopPropagation()
    e.preventDefault()
    resizing.current = true
    startX.current   = e.clientX
    startW.current   = width
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onResizePointerMove = (e: React.PointerEvent) => {
    if (!resizing.current) return
    const newW = Math.max(120, Math.min(600, startW.current + e.clientX - startX.current))
    if (cardRef.current) cardRef.current.style.width = `${newW}px`
    onResized(newW)
    onResizing(newW)
  }

  const onResizePointerUp = () => { resizing.current = false }

  return (
    <article
      ref={cardRef as React.RefObject<HTMLElement>}
      className={`wall-card ${isLive ? 'is-live' : ''} ${displayMode ? 'display-mode' : ''}`}
      style={{
        width,
        position: 'absolute',
        left: '50%',
        top: '50%',
        marginLeft: -width / 2,
        marginTop: -100,
        transform: `translate(${initX}px, ${initY}px)`,
        zIndex,
      }}
      onPointerDown={onCardPointerDown}
      onPointerMove={onCardPointerMove}
      onPointerUp={onCardPointerUp}
    >
      <div className={`card-media ${aspectClass}`}>
        {post.file_type === 'image'
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={post.file_url} alt={post.caption ?? ''} draggable={false} />
          : <video src={post.file_url} muted loop playsInline autoPlay />
        }
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

      {!displayMode && (
        <div
          className="resize-handle"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
        />
      )}

      <style>{`
        .wall-card {
          cursor: grab; border-radius: 22px; overflow: visible;
          background: #fff; border: 1px solid rgba(0,0,0,.08);
          box-shadow: 0 4px 20px rgba(0,0,0,.13), 0 1px 4px rgba(0,0,0,.06);
          user-select: none; touch-action: none;
          transition: box-shadow .2s ease;
        }
        .wall-card:active { cursor: grabbing; }
        .wall-card:hover  { box-shadow: 0 18px 52px rgba(0,0,0,.22), 0 2px 8px rgba(0,0,0,.1); }
        .wall-card.display-mode { cursor: pointer; }
        .wall-card.is-live { outline: 2px solid #4a9eff; outline-offset: 2px; }
        .card-media { position: relative; overflow: hidden; width: 100%; border-radius: 22px; }
        .card-media img, .card-media video {
          width: 100%; height: 100%; object-fit: cover; display: block;
          transition: transform .45s ease; pointer-events: none;
        }
        .wall-card:not(.display-mode):hover .card-media img,
        .wall-card:not(.display-mode):hover .card-media video { transform: scale(1.05); }
        .wall-card.display-mode:hover .card-media img,
        .wall-card.display-mode:hover .card-media video { transform: scale(1.03); }
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
        .resize-handle {
          position: absolute; bottom: -6px; right: -6px;
          width: 18px; height: 18px; background: #fff;
          border: 2px solid rgba(0,0,0,.2); border-radius: 50%;
          cursor: se-resize; opacity: 0; transition: opacity .2s; z-index: 10;
          touch-action: none;
        }
        .wall-card:hover .resize-handle { opacity: 1; }
      `}</style>
    </article>
  )
}