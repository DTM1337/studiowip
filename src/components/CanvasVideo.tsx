'use client'

import { useEffect, useRef } from 'react'

type Props = {
  src: string
  className?: string
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
    const video = videoRef.current
    if (!canvas || !video) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let stopped = false
    let frames = 0
    let drawErr = '-'

    // Copying frames at full source resolution is more than a TV can sustain,
    // so the buffer is capped on its long side. Scaling both axes by the same
    // factor keeps the canvas's intrinsic aspect ratio identical to the video's,
    // which is what makes surrounding layout and object-fit behave unchanged.
    const MAX_EDGE = 720

    let lastPaint = 0

    const paint = () => {
      const vw = video.videoWidth
      const vh = video.videoHeight
      if (!vw || !vh) return

      // Two independent drivers call this; the guard keeps the combined rate at
      // ~25fps instead of painting the same frame twice.
      const now = Date.now()
      if (now - lastPaint < 38) return
      lastPaint = now

      const k = Math.min(1, MAX_EDGE / Math.max(vw, vh))
      const bw = Math.max(1, Math.round(vw * k))
      const bh = Math.max(1, Math.round(vh * k))

      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw
        canvas.height = bh
      }
      // A throwing drawImage must not be able to kill the painter, and the
      // reason has to be visible: the TV cannot be inspected any other way.
      try {
        ctx.drawImage(video, 0, 0, bw, bh)
        frames++
      } catch (e) {
        drawErr = e instanceof Error ? `${e.name}` : 'throw'
      }

      // Diagnostic marker, drawn independently of the video. It separates the
      // two failure modes that look identical from the outside: a canvas that
      // never reaches the screen, versus one that paints but gets no pixels
      // out of drawImage.
      if (document.documentElement.dataset.canvasDebug === '1') {
        ctx.fillStyle = '#f0f'
        ctx.fillRect(0, 0, Math.round(bw / 3), Math.round(bh / 6))
        ctx.fillStyle = '#fff'
        ctx.font = `${Math.max(12, Math.round(bh / 12))}px monospace`
        ctx.fillText(String(frames), 8, Math.round(bh / 10))
      }
    }

    // Two drivers, because neither is reliable alone. A self-rescheduling chain
    // (rAF, or requestVideoFrameCallback as used before) stops permanently if a
    // single callback is missed or throws — which is exactly what stalled
    // painting on the TV. setInterval ticks independently so it always recovers,
    // but gets throttled when a page is backgrounded. Together they cover both.
    const painter = window.setInterval(paint, 40)
    let rafHandle = 0
    const step = () => {
      if (stopped) return
      paint()
      rafHandle = requestAnimationFrame(step)
    }
    rafHandle = requestAnimationFrame(step)

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
      if (stopped) return
      if (video.paused) video.play().catch(() => {})
      // Surfaced on /display?debug=1 — the only way to see what the TV is
      // actually doing, since it cannot be inspected directly.
      canvas.dataset.frames = String(frames)
      canvas.dataset.ready = String(video.readyState)
      canvas.dataset.paused = String(video.paused)
      canvas.dataset.time = video.currentTime.toFixed(1)
      canvas.dataset.nat = `${video.videoWidth}x${video.videoHeight}`
      canvas.dataset.buf = `${canvas.width}x${canvas.height}`
      canvas.dataset.err = video.error ? String(video.error.code) : '-'
      canvas.dataset.draw = drawErr
    }, 1500)

    return () => {
      stopped = true
      window.clearInterval(painter)
      window.clearInterval(watchdog)
      if (rafHandle) cancelAnimationFrame(rafHandle)
      video.removeEventListener('loadedmetadata', kick)
      video.removeEventListener('loadeddata', kick)
      video.removeEventListener('canplay', kick)
      video.removeEventListener('pause', kick)
    }
  }, [src])

  return (
    <>
      {/* Full size and genuinely rendered, so the engine has no reason to skip
          decoding it, but stacked underneath the canvas that covers it. */}
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
          inset: 0,
          width: '100%',
          height: '100%',
          zIndex: 0,
          pointerEvents: 'none',
        }}
      />
      <canvas
        ref={canvasRef}
        className={className}
        style={{ position: 'relative', zIndex: 1 }}
      />
    </>
  )
}
