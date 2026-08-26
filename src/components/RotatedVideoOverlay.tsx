'use client'

import { useEffect, useRef } from 'react'

type Props = {
  src: string
  /** Degrees the display is rotated by; the frame is rotated to match. */
  rotation: number
}

// Keeping the backing store below the panel's native size costs little
// visually on a wall display and a lot less work on a weak TV processor.
const MAX_EDGE = 1280

/**
 * Fullscreen video for a rotated display, drawn into a canvas that is itself
 * never CSS-rotated.
 *
 * The page rotation is applied to a wrapper element; this overlay deliberately
 * sits outside it. Rotation happens in the drawing math instead, so the result
 * does not depend on the browser compositing either a <video> or a transformed
 * canvas correctly — which is exactly what Samsung Tizen gets wrong.
 */
export default function RotatedVideoOverlay({ src, rotation }: Props) {
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
    let lastPaint = 0

    const paint = () => {
      const now = Date.now()
      if (now - lastPaint < 38) return
      lastPaint = now

      const vw = window.innerWidth
      const vh = window.innerHeight
      const k = Math.min(1, MAX_EDGE / Math.max(vw, vh))
      const cw = Math.round(vw * k)
      const chh = Math.round(vh * k)
      if (canvas.width !== cw || canvas.height !== chh) {
        canvas.width = cw
        canvas.height = chh
      }

      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, cw, chh)

      const nw = video.videoWidth
      const nh = video.videoHeight
      if (nw && nh) {
        // The viewer sees the panel turned by `rotation`, so for a quarter turn
        // the box to fit into has its sides swapped relative to the canvas.
        const quarter = rotation === 90 || rotation === 270
        const boxW = quarter ? chh : cw
        const boxH = quarter ? cw : chh

        const scale = Math.min(boxW / nw, boxH / nh)
        const dw = nw * scale
        const dh = nh * scale

        ctx.save()
        // Rotating about the canvas centre keeps the fitted box centred on
        // screen for every angle, so no per-angle offsets are needed.
        ctx.translate(cw / 2, chh / 2)
        ctx.rotate((rotation * Math.PI) / 180)
        try {
          ctx.drawImage(video, -dw / 2, -dh / 2, dw, dh)
          frames++
        } catch (e) {
          drawErr = e instanceof Error ? e.name : 'throw'
        }
        ctx.restore()
      }

      if (document.documentElement.dataset.canvasDebug === '1') {
        ctx.fillStyle = '#f0f'
        ctx.fillRect(0, 0, Math.round(cw / 4), Math.round(chh / 8))
        ctx.fillStyle = '#fff'
        ctx.font = `${Math.max(14, Math.round(chh / 16))}px monospace`
        ctx.fillText(`FS ${frames}`, 8, Math.round(chh / 12))
      }
    }

    // Two independent drivers: an interval always recovers on its next tick,
    // rAF covers the case where timers are throttled. A self-rescheduling
    // chain alone stops for good if one callback is missed or throws.
    const painter = window.setInterval(paint, 40)
    let rafHandle = 0
    const step = () => {
      if (stopped) return
      paint()
      rafHandle = requestAnimationFrame(step)
    }
    rafHandle = requestAnimationFrame(step)

    const kick = () => { paint(); video.play().catch(() => {}) }
    video.addEventListener('loadedmetadata', kick)
    video.addEventListener('loadeddata', kick)
    video.addEventListener('canplay', kick)
    video.addEventListener('pause', kick)
    kick()

    const watchdog = window.setInterval(() => {
      if (stopped) return
      if (video.paused) video.play().catch(() => {})
      canvas.dataset.frames = String(frames)
      canvas.dataset.ready = String(video.readyState)
      canvas.dataset.paused = String(video.paused)
      canvas.dataset.time = video.currentTime.toFixed(1)
      canvas.dataset.nat = `${video.videoWidth}x${video.videoHeight}`
      canvas.dataset.buf = `${canvas.width}x${canvas.height}`
      canvas.dataset.err = video.error ? String(video.error.code) : '-'
      canvas.dataset.draw = drawErr
    }, 1500)

    const onResize = () => paint()
    window.addEventListener('resize', onResize)

    return () => {
      stopped = true
      window.clearInterval(painter)
      window.clearInterval(watchdog)
      window.removeEventListener('resize', onResize)
      if (rafHandle) cancelAnimationFrame(rafHandle)
      video.removeEventListener('loadedmetadata', kick)
      video.removeEventListener('loadeddata', kick)
      video.removeEventListener('canplay', kick)
      video.removeEventListener('pause', kick)
    }
  }, [src, rotation])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: '#000', overflow: 'hidden' }}>
      {/* In the document so the engine decodes it — Tizen will not start
          playback on a detached element — but covered by the opaque canvas. */}
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
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0 }}
      />
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 1 }}
      />
    </div>
  )
}
