'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
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

const MIN_ZOOM = 0.2
const MAX_ZOOM = 3

interface Props {
  initialPosts: Post[]
  uploaderName: string
}

export default function CreativeWall({ initialPosts, uploaderName }: Props) {
  const [posts, setPosts]               = useState<Post[]>(initialPosts)
  const [selectedPost, setSelectedPost] = useState<Post | null>(null)
  const [isFileDrag, setIsFileDrag]     = useState(false)
  const [uploading, setUploading]       = useState(false)
  const [uploadName, setUploadName]     = useState(uploaderName)
  const [caption, setCaption]           = useState('')
  const fileInputRef                    = useRef<HTMLInputElement>(null)
  const dragCounter                     = useRef(0)

  const [zoom, setZoom] = useState(1)
  const [pan, setPan]   = useState({ x: 0, y: 0 })
  const isPanning       = useRef(false)
  const panMoved        = useRef(false)
  const panStart        = useRef({ x: 0, y: 0 })
  const panOrigin       = useRef({ x: 0, y: 0 })
  const stageRef        = useRef<HTMLDivElement>(null)

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
    const channel = supabase
      .channel('wall-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, (payload) => {
        const p = payload.new as Post
        setPosts((prev) => prev.some((x) => x.id === p.id) ? prev : [p, ...prev])
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
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
  }, [uploadFiles])

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
    const newX = (post.pos_x || base.x) + dx
    const newY = (post.pos_y || base.y) + dy
    setPosts((prev) => prev.map((p) => p.id === post.id ? { ...p, pos_x: newX, pos_y: newY } : p))
    savePosition(post.id, newX, newY)
  }

  const handleResized = (post: Post, newW: number) => {
    setPosts((prev) => prev.map((p) => p.id === post.id ? { ...p, card_size: newW } : p))
    saveSize(post.id, newW)
  }

  return (
    <div className="wall-root">
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
        </div>
      </header>

      <div
        ref={stageRef}
        className="wall-stage"
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
            const initX = post.pos_x || base.x
            const initY = post.pos_y || base.y
            const w     = post.card_size || aspectW(post.file_type)

            return (
              <DraggableCard
                key={post.id}
                post={post}
                initX={initX}
                initY={initY}
                width={w}
                onMoved={(dx, dy) => handleMoved(post, dx, dy)}
                onResized={(newW) => handleResized(post, newW)}
                onClick={() => setSelectedPost(post)}
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

      {selectedPost && (
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
          flex: 1; margin-top: 53px; overflow: hidden;
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
      `}</style>
    </div>
  )
}

interface CardProps {
  post: Post
  initX: number
  initY: number
  width: number
  onMoved: (dx: number, dy: number) => void
  onResized: (newW: number) => void
  onClick: () => void
}

function DraggableCard({ post, initX, initY, width, onMoved, onResized, onClick }: CardProps) {
  const dragDist    = useRef(0)
  const resizing    = useRef(false)
  const startX      = useRef(0)
  const startW      = useRef(0)
  const aspectClass = post.file_type === 'video' ? 'aspect-video' : 'aspect-[4/5]'

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    resizing.current = true
    startX.current   = e.clientX
    startW.current   = width

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizing.current) return
      const newW = Math.max(120, Math.min(600, startW.current + ev.clientX - startX.current))
      onResized(newW)
    }
    const onMouseUp = () => {
      resizing.current = false
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup',   onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',   onMouseUp)
  }

  return (
    <motion.article
      drag
      dragMomentum={false}
      dragElastic={0.06}
      whileDrag={{ scale: 1.05, zIndex: 100 }}
      initial={{ x: initX, y: initY }}
      onDragStart={() => { dragDist.current = 0 }}
      onDrag={(_, info) => { dragDist.current = Math.hypot(info.offset.x, info.offset.y) }}
      onDragEnd={(_, info) => { onMoved(info.offset.x, info.offset.y) }}
      onClick={() => { if (dragDist.current < 6) onClick() }}
      style={{ width, position: 'absolute', left: '50%', top: '50%', marginLeft: -width / 2, marginTop: -100 }}
      className="wall-card"
    >
      <div className={`card-media ${aspectClass}`}>
        {post.file_type === 'image'
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={post.file_url} alt={post.caption ?? ''} draggable={false} />
          : <video src={post.file_url} muted loop playsInline autoPlay />
        }
        <div className="card-hover-overlay">
          <span className="card-user">{post.uploader_name}</span>
          {post.caption && <span className="card-caption">{post.caption}</span>}
        </div>
      </div>

      <div
        className="resize-handle"
        onMouseDown={onResizeMouseDown}
        onPointerDown={(e) => e.stopPropagation()}
      />

      <style>{`
        .wall-card {
          cursor: grab; border-radius: 22px; overflow: visible;
          background: #fff; border: 1px solid rgba(0,0,0,.08);
          box-shadow: 0 4px 20px rgba(0,0,0,.13), 0 1px 4px rgba(0,0,0,.06);
          user-select: none; z-index: 1;
        }
        .wall-card:active { cursor: grabbing; }
        .wall-card:hover  { box-shadow: 0 18px 52px rgba(0,0,0,.22), 0 2px 8px rgba(0,0,0,.1); z-index: 50; }
        .card-media { position: relative; overflow: hidden; width: 100%; border-radius: 22px; }
        .card-media img, .card-media video {
          width: 100%; height: 100%; object-fit: cover; display: block;
          transition: transform .45s ease; pointer-events: none;
        }
        .wall-card:hover .card-media img,
        .wall-card:hover .card-media video { transform: scale(1.05); }
        .card-hover-overlay {
          position: absolute; inset: 0;
          background: linear-gradient(to top, rgba(0,0,0,.72) 0%, rgba(0,0,0,.1) 50%, transparent 100%);
          display: flex; flex-direction: column; justify-content: flex-end;
          padding: 14px; opacity: 0;
          transition: opacity .25s ease, transform .25s ease;
          transform: translateY(6px); border-radius: 22px;
        }
        .wall-card:hover .card-hover-overlay { opacity: 1; transform: translateY(0); }
        .card-user    { font-size: 12px; font-weight: 700; color: #fff; }
        .card-caption { font-size: 11px; color: rgba(255,255,255,.75); margin-top: 2px; }
        .resize-handle {
          position: absolute; bottom: -6px; right: -6px;
          width: 18px; height: 18px; background: #fff;
          border: 2px solid rgba(0,0,0,.2); border-radius: 50%;
          cursor: se-resize; opacity: 0; transition: opacity .2s; z-index: 10;
        }
        .wall-card:hover .resize-handle { opacity: 1; }
      `}</style>
    </motion.article>
  )
}