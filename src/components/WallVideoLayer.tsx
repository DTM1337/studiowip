'use client'

import { useEffect, useRef } from 'react'
import { Post } from '@/types'
import { rotatedVariantUrl } from '@/lib/rotatedVariant'

type Props = {
  posts: Post[]
}

/**
 * Draws the wall's card videos in a layer that is never rotated.
 *
 * Samsung Tizen ignores an ancestor transform on a <video>, so a clip left
 * inside the rotated wrapper is drawn at its pre-rotation position — wrong
 * place, not just wrong orientation. Here each clip is positioned from its
 * card's on-screen rectangle instead, and plays the pre-rotated file with no
 * transform of its own, so nothing depends on how the browser composites video.
 *
 * Trade-off: this layer sits above the wall, so a video card cannot be
 * overlapped by a card in front of it while the display is rotated.
 */
export default function WallVideoLayer({ posts }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    let stopped = false

    // Cards move with pan and zoom, which arrive continuously from GodMode, so
    // positions are re-read continuously rather than on an event.
    const position = () => {
      const container = containerRef.current
      if (!container) return
      for (const holder of Array.from(container.children) as HTMLElement[]) {
        const id = holder.dataset.for
        if (!id) continue
        const card = document.querySelector<HTMLElement>(`[data-video-card="${id}"]`)
        if (!card) { holder.style.display = 'none'; continue }

        const r = card.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) { holder.style.display = 'none'; continue }

        holder.style.display = ''
        holder.style.left = `${r.left}px`
        holder.style.top = `${r.top}px`
        holder.style.width = `${r.width}px`
        holder.style.height = `${r.height}px`
      }
    }

    // Driven by both: rAF tracks motion smoothly but stops firing whenever the
    // page is not compositing, and an interval keeps positions correct then.
    const follow = () => {
      if (stopped) return
      position()
      raf = requestAnimationFrame(follow)
    }
    raf = requestAnimationFrame(follow)
    const ticker = window.setInterval(position, 100)
    position()

    const video = () => Array.from(
      containerRef.current?.querySelectorAll('video') ?? [],
    ) as HTMLVideoElement[]

    // Same watchdog as elsewhere: a TV can park a clip even after play()
    // resolved, and there is no event for that.
    const watchdog = window.setInterval(() => {
      if (stopped) return
      for (const v of video()) if (v.paused) v.play().catch(() => {})
    }, 1500)

    for (const v of video()) v.play().catch(() => {})

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      window.clearInterval(ticker)
      window.clearInterval(watchdog)
    }
  }, [posts])

  return (
    <div
      ref={containerRef}
      style={{ position: 'fixed', inset: 0, zIndex: 400, pointerEvents: 'none' }}
    >
      {posts.map(post => (
        <div
          key={post.id}
          data-for={post.id}
          style={{
            position: 'absolute',
            overflow: 'hidden',
            // Matches .card-media so the clip keeps the card's rounded corners.
            borderRadius: 22,
          }}
        >
          <video
            src={rotatedVariantUrl(post.file_url)}
            muted
            loop
            playsInline
            autoPlay
            preload="auto"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </div>
      ))}
    </div>
  )
}
