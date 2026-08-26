'use client'

import { useEffect, useRef } from 'react'

type Props = {
  src: string
  /** Degrees the display is rotated by; the frame is rotated to match. */
  rotation: number
  /**
   * false renders the clip with no transform at all. It will look sideways on
   * a turned panel, but it isolates whether the element is positioned and
   * sized correctly, independent of whether rotation is honoured.
   */
  rotateElement: boolean
}

/**
 * Fullscreen video for a rotated display.
 *
 * Canvas is not an option here: Samsung Tizen keeps hardware-decoded frames in
 * a surface that drawImage cannot read, so the canvas paints but stays empty —
 * confirmed on the panel with a test marker that rendered while the video did
 * not.
 *
 * So this uses a real <video>, deliberately placed outside the rotated wrapper
 * so it inherits no ancestor transform, and rotates the element itself. A
 * transform on the video element is a different case from one on an ancestor,
 * and engines that ignore the latter often still honour the former.
 */
export default function RotatedVideoOverlay({ src, rotation, rotateElement }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const video = videoRef.current
    const box = boxRef.current
    if (!video || !box) return

    let stopped = false

    const layout = () => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const quarter = rotation === 90 || rotation === 270

      // Sized in viewer space: for a quarter turn the element is portrait, and
      // once rotated its screen box is exactly the viewport again.
      const w = quarter ? vh : vw
      const h = quarter ? vw : vh

      box.style.width = `${w}px`
      box.style.height = `${h}px`
      box.style.left = `${(vw - w) / 2}px`
      box.style.top = `${(vh - h) / 2}px`
      box.style.transformOrigin = 'center center'
      box.style.transform = rotateElement ? `rotate(${rotation}deg)` : ''
    }

    layout()
    window.addEventListener('resize', layout)

    const kick = () => { video.play().catch(() => {}) }
    video.addEventListener('loadedmetadata', kick)
    video.addEventListener('loadeddata', kick)
    video.addEventListener('canplay', kick)
    video.addEventListener('pause', kick)
    kick()

    const watchdog = window.setInterval(() => {
      if (stopped) return
      if (video.paused) video.play().catch(() => {})
      const r = box.getBoundingClientRect()
      document.documentElement.dataset.fsVideo =
        `mode=${rotateElement ? 'rot' : 'plain'} ready=${video.readyState}` +
        ` paused=${video.paused} t=${video.currentTime.toFixed(1)}` +
        ` nat=${video.videoWidth}x${video.videoHeight}` +
        ` box=${Math.round(r.width)}x${Math.round(r.height)}` +
        ` err=${video.error ? video.error.code : '-'}`
    }, 1000)

    return () => {
      stopped = true
      window.clearInterval(watchdog)
      window.removeEventListener('resize', layout)
      video.removeEventListener('loadedmetadata', kick)
      video.removeEventListener('loadeddata', kick)
      video.removeEventListener('canplay', kick)
      video.removeEventListener('pause', kick)
      delete document.documentElement.dataset.fsVideo
    }
  }, [src, rotation, rotateElement])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: '#000', overflow: 'hidden' }}>
      <div ref={boxRef} style={{ position: 'absolute' }}>
        <video
          ref={videoRef}
          src={src}
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      </div>
    </div>
  )
}
