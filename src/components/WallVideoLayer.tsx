'use client'

import { useEffect, useRef } from 'react'
import { Post } from '@/types'
import LazyVideo from './LazyVideo'
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
 * The layer sits *behind* the wall, and video cards are made transparent so it
 * shows through. That keeps the stacking order intact: a card in front of a
 * video card still covers it, which would be impossible with the clips on top.
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

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      window.clearInterval(ticker)
    }
  }, [posts])

  return (
    <div
      ref={containerRef}
      style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}
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
          <LazyVideo
            src={rotatedVariantUrl(post.file_url)}
            // Clips uploaded before pre-rotation, or missed by the backfill,
            // have no variant; without this the card would just be an empty
            // hole with nothing to explain it.
            fallbackSrc={post.file_url}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </div>
      ))}
    </div>
  )
}
