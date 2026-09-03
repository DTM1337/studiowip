'use client'

import { useEffect, useRef, useState } from 'react'
import { rotatedVariantUrl } from '@/lib/rotatedVariant'

type Props = {
  src: string
  /** Degrees the display is rotated by. */
  rotation: number
  /** When given, the clip plays once and this is called instead of looping. */
  onEnded?: () => void
}

/**
 * Fullscreen video for a rotated display.
 *
 * Rotation is baked into the file rather than applied at playback. Samsung
 * Tizen ignores CSS transforms on a <video> — inherited or on the element —
 * and keeps decoded frames where drawImage cannot read them, so every
 * playback-time approach failed on the panel. A pre-rotated file needs none of
 * them: the element is never transformed, so nothing depends on how the
 * browser composites video.
 *
 * Uploads made before the variant existed have none, so a missing file falls
 * back to the original plus a CSS rotation — correct in a desktop browser,
 * wrong on the TV, but better than not playing.
 */
export default function RotatedVideoOverlay({ src, rotation, onEnded }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // Held in a ref so the effect below does not depend on its identity. A
  // caller passing an inline arrow gave it a new one every render, tearing the
  // listeners down and rebuilding them constantly — which also reset the
  // buffering state and wiped the diagnostics each time.
  const onEndedRef = useRef(onEnded)
  onEndedRef.current = onEnded
  const advances = !!onEnded

  // Only a quarter turn clockwise has a baked variant; anything else has to
  // fall back to transforming the element.
  const canUseVariant = rotation === 90
  const [useVariant, setUseVariant] = useState(canUseVariant)

  useEffect(() => { setUseVariant(canUseVariant) }, [canUseVariant, src])

  const playbackSrc = useVariant ? rotatedVariantUrl(src) : src

  useEffect(() => {
    const video = videoRef.current
    const box = boxRef.current
    if (!video || !box) return

    let stopped = false

    const layout = () => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const quarter = rotation === 90 || rotation === 270

      if (useVariant) {
        // The picture is already turned, so the element is laid out plainly and
        // left untransformed — the whole point of the baked variant.
        box.style.width = `${vw}px`
        box.style.height = `${vh}px`
        box.style.left = '0px'
        box.style.top = '0px'
        box.style.transform = ''
        return
      }

      const w = quarter ? vh : vw
      const h = quarter ? vw : vh
      box.style.width = `${w}px`
      box.style.height = `${h}px`
      box.style.left = `${(vw - w) / 2}px`
      box.style.top = `${(vh - h) / 2}px`
      box.style.transformOrigin = 'center center'
      box.style.transform = `rotate(${rotation}deg)`
    }

    layout()
    window.addEventListener('resize', layout)

    // A missing variant surfaces as a media error; drop to the original rather
    // than leaving a black screen.
    const onError = () => { if (useVariant) setUseVariant(false) }
    video.addEventListener('error', onError)

    // Waiting for a buffer rather than starting at the first playable frame.
    // `canplay` fires with barely two frames ready, so playback began and then
    // stuttered for the first second or two while it caught up. HAVE_ENOUGH_DATA
    // means the browser thinks it can reach the end without stalling.
    let started = false
    const start = () => {
      if (started || stopped) return
      started = true
      video.play().catch(() => {})
    }
    const startWhenBuffered = () => { if (video.readyState >= 4) start() }

    video.addEventListener('canplaythrough', start)
    video.addEventListener('progress', startWhenBuffered)
    video.addEventListener('loadeddata', startWhenBuffered)
    // A slow connection may never reach HAVE_ENOUGH_DATA, and a clip that never
    // plays is worse than one that stutters.
    const impatient = window.setTimeout(start, 4000)

    // Once running, a pause is something to recover from rather than wait out.
    // The pause that comes with reaching the end is not, or a playlist would
    // restart the clip it is trying to advance past.
    const resume = () => { if (started && !video.ended) video.play().catch(() => {}) }
    video.addEventListener('pause', resume)

    const finish = () => onEndedRef.current?.()
    if (advances) video.addEventListener('ended', finish)

    startWhenBuffered()

    const watchdog = window.setInterval(() => {
      if (stopped) return
      if (started && video.paused && !video.ended) video.play().catch(() => {})
      const r = box.getBoundingClientRect()
      document.documentElement.dataset.fsVideo =
        `src=${useVariant ? 'rot90' : 'original'} ready=${video.readyState}` +
        ` paused=${video.paused} t=${video.currentTime.toFixed(1)}` +
        ` nat=${video.videoWidth}x${video.videoHeight}` +
        ` box=${Math.round(r.width)}x${Math.round(r.height)}` +
        ` buffered=${video.buffered.length ? video.buffered.end(video.buffered.length - 1).toFixed(1) : 0}` +
        ` err=${video.error ? video.error.code : '-'}`
    }, 1000)

    return () => {
      stopped = true
      window.clearInterval(watchdog)
      window.clearTimeout(impatient)
      window.removeEventListener('resize', layout)
      video.removeEventListener('error', onError)
      video.removeEventListener('canplaythrough', start)
      video.removeEventListener('progress', startWhenBuffered)
      video.removeEventListener('loadeddata', startWhenBuffered)
      video.removeEventListener('pause', resume)
      video.removeEventListener('ended', finish)
      delete document.documentElement.dataset.fsVideo
    }
  }, [playbackSrc, rotation, useVariant, advances])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: '#000', overflow: 'hidden' }}>
      <div ref={boxRef} style={{ position: 'absolute' }}>
        <video
          key={playbackSrc}
          ref={videoRef}
          src={playbackSrc}
          muted
          loop={!advances}
          playsInline
          preload="auto"
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      </div>
    </div>
  )
}
