'use client'

import { useEffect, useRef } from 'react'

type Props = {
  src: string
  className?: string
}

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

/**
 * Plays a video by painting its frames into a <canvas>.
 *
 * Samsung Tizen hands <video> elements to a hardware overlay plane that is
 * positioned from the pre-transform layout, so a CSS-rotated page rotates the
 * decoded frame but leaves the window it is drawn into unrotated. A canvas is
 * painted in the normal layer tree, so it always follows ancestor transforms.
 *
 * The canvas buffer is sized to the video's natural dimensions and each frame
 * is copied 1:1, giving the canvas the same intrinsic aspect ratio a <video>
 * would have — so surrounding layout and the existing object-fit rules behave
 * identically to the element it replaces.
 *
 * The source <video> stays in the document: Tizen refuses to start playback on
 * a detached element. It is shrunk to a single transparent pixel and clipped by
 * the parent, so even if the overlay plane ignores opacity there is nothing
 * meaningful to see.
 */
export default function CanvasVideo({ src, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current as FrameCallbackVideo | null
    if (!canvas || !video) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let stopped = false
    let rafHandle = 0
    let frameHandle = 0

    const paint = () => {
      const vw = video.videoWidth
      const vh = video.videoHeight
      if (!vw || !vh) return
      if (canvas.width !== vw || canvas.height !== vh) {
        canvas.width = vw
        canvas.height = vh
      }
      ctx.drawImage(video, 0, 0)
    }

    // requestVideoFrameCallback fires once per decoded frame, so we never paint
    // more often than the video actually updates. rAF is the fallback, throttled
    // to ~25fps to keep weak TV CPUs from being pegged.
    if (typeof video.requestVideoFrameCallback === 'function') {
      const onFrame = () => {
        if (stopped) return
        paint()
        frameHandle = video.requestVideoFrameCallback!(onFrame)
      }
      frameHandle = video.requestVideoFrameCallback(onFrame)
    } else {
      let last = 0
      const step = (now: number) => {
        if (stopped) return
        if (now - last >= 40) { last = now; paint() }
        rafHandle = requestAnimationFrame(step)
      }
      rafHandle = requestAnimationFrame(step)
    }

    // Autoplay can be refused before the element is ready, so retry on each
    // readiness milestone rather than relying on the autoplay attribute alone.
    const kick = () => { paint(); video.play().catch(() => {}) }
    video.addEventListener('loadedmetadata', kick)
    video.addEventListener('loadeddata', kick)
    video.addEventListener('canplay', kick)
    video.addEventListener('pause', kick)
    kick()

    // Backstop: a wall can hold more videos than the TV has decoders, so one
    // can end up silently parked even after a successful play(). Cheap poll
    // that nudges anything found paused back into playback.
    const watchdog = window.setInterval(() => {
      if (!stopped && video.paused) video.play().catch(() => {})
    }, 1500)

    return () => {
      stopped = true
      window.clearInterval(watchdog)
      if (rafHandle) cancelAnimationFrame(rafHandle)
      if (frameHandle && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameHandle)
      video.removeEventListener('loadedmetadata', kick)
      video.removeEventListener('loadeddata', kick)
      video.removeEventListener('canplay', kick)
      video.removeEventListener('pause', kick)
    }
  }, [src])

  return (
    <>
      <canvas ref={canvasRef} className={className} />
      <video
        ref={videoRef}
        src={src}
        muted
        loop
        playsInline
        autoPlay
        preload="auto"
        aria-hidden="true"
        tabIndex={-1}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '1px',
          height: '1px',
          minWidth: 0,
          minHeight: 0,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
    </>
  )
}
