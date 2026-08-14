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
 * is copied 1:1. That gives the canvas the same intrinsic aspect ratio a
 * <video> would have, so surrounding layout and the existing object-fit rules
 * behave identically to the element it replaces.
 *
 * The <video> is kept detached from the document — it only decodes; the canvas
 * is what gets displayed.
 */
export default function CanvasVideo({ src, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // No crossOrigin: the canvas becomes tainted, which is fine because we
    // never read pixels back. Requesting CORS would break loading outright if
    // the storage bucket ever stopped sending the header.
    const video = document.createElement('video') as FrameCallbackVideo
    video.muted = true
    video.loop = true
    video.autoplay = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = src

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

    // Size the buffer as soon as dimensions are known so layout settles before
    // the first frame arrives, and keep retrying playback if autoplay is denied.
    const onMeta = () => { paint(); video.play().catch(() => {}) }
    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('loadeddata', onMeta)
    video.play().catch(() => {})

    return () => {
      stopped = true
      if (rafHandle) cancelAnimationFrame(rafHandle)
      if (frameHandle && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameHandle)
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('loadeddata', onMeta)
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [src])

  return <canvas ref={canvasRef} className={className} />
}
