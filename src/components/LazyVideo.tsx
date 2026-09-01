'use client'

import { useEffect, useRef } from 'react'

type Props = {
  src: string
  /** Played instead if `src` fails, e.g. a missing pre-rotated variant. */
  fallbackSrc?: string
  className?: string
  style?: React.CSSProperties
}

// Load a screen ahead of the edge so a clip is ready before it is seen, and
// wait a while before dropping one that left, so panning back and forth does
// not restart it repeatedly.
const LOAD_MARGIN = '75%'
const RELEASE_DELAY_MS = 5000

/**
 * A <video> that only downloads while it is near the viewport.
 *
 * The wall holds every clip at once, so loading them eagerly made page load
 * scale with how many videos exist rather than how many are visible — and left
 * the TV decoding all of them simultaneously, which it does not have the
 * memory for.
 */
export default function LazyVideo({ src, fallbackSrc, className, style }: Props) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = ref.current
    if (!video) return

    let active = false
    let releaseTimer: ReturnType<typeof setTimeout> | undefined
    let usingFallback = false

    const activate = () => {
      clearTimeout(releaseTimer)
      if (active) return
      active = true
      const wanted = usingFallback && fallbackSrc ? fallbackSrc : src
      if (video.getAttribute('src') !== wanted) video.src = wanted
      video.play().catch(() => {})
    }

    const release = () => {
      if (!active) return
      active = false
      video.pause()
      // Dropping the source is what actually frees the buffered data and the
      // decoder; pausing alone keeps both.
      video.removeAttribute('src')
      video.load()
    }

    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) activate()
          else {
            clearTimeout(releaseTimer)
            releaseTimer = setTimeout(release, RELEASE_DELAY_MS)
          }
        }
      },
      { rootMargin: LOAD_MARGIN },
    )
    io.observe(video)

    const onError = () => {
      if (!fallbackSrc || usingFallback || !active) return
      usingFallback = true
      video.src = fallbackSrc
      video.play().catch(() => {})
    }
    video.addEventListener('error', onError)

    // A clip that is on screen must not stay parked: autoplay can be refused
    // before the element is ready, and a TV can silently drop playback.
    const watchdog = window.setInterval(() => {
      if (active && video.paused) video.play().catch(() => {})
    }, 1500)

    return () => {
      io.disconnect()
      clearTimeout(releaseTimer)
      window.clearInterval(watchdog)
      video.removeEventListener('error', onError)
    }
  }, [src, fallbackSrc])

  return (
    <video
      ref={ref}
      muted
      loop
      playsInline
      preload="none"
      className={className}
      style={style}
    />
  )
}
