'use client'

import { useEffect, useRef, useState } from 'react'
import { mseVariantUrl, MSE_MIME } from '@/lib/mseVariant'

type Props = {
  /** Original post URLs, in play order. */
  srcs: string[]
  /** Called if MediaSource cannot be used, so the caller can fall back. */
  onUnsupported: () => void
}

// How far ahead of the playhead to keep the buffer stocked. Two clips' worth is
// plenty and keeps memory on the panel modest.
const BUFFER_AHEAD_SECONDS = 30

/**
 * Plays the playlist as one continuous stream.
 *
 * Changing a <video> element's source restarts the panel's hardware decoder,
 * which costs a few hundred milliseconds and shows as a black frame between
 * clips. Here the source never changes: clips are appended into a single
 * MediaSource buffer, so the decoder sees one unbroken stream and the joins are
 * frame to frame. It is the same mechanism streaming apps use to splice on
 * these TVs.
 *
 * It only works because every clip is encoded identically — same frame size,
 * rate, profile and level, no audio — by makeMseVariant. A buffer will not take
 * segments that disagree.
 *
 * The element is never transformed: the variant is already rotated, for the same
 * reason as everywhere else here.
 */
export default function SeamlessPlaylist({ srcs, onUnsupported }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !srcs.length) return

    if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported(MSE_MIME)) {
      onUnsupported()
      return
    }

    let stopped = false
    let sourceBuffer: SourceBuffer | null = null
    // Which clip is appended next; wraps, so the stream never ends.
    let feedIndex = 0
    let appending = false

    const mediaSource = new MediaSource()
    const objectUrl = URL.createObjectURL(mediaSource)
    video.src = objectUrl

    const fail = (why: unknown) => {
      if (stopped) return
      console.warn('MediaSource playback failed, falling back:', why)
      setFailed(true)
      onUnsupported()
    }

    /** Appends one clip, then keeps going while the buffer is short. */
    const pump = async () => {
      if (stopped || appending || !sourceBuffer) return
      if (mediaSource.readyState !== 'open') return

      // Stop once there is enough ahead of where we are.
      const buffered = sourceBuffer.buffered
      const end = buffered.length ? buffered.end(buffered.length - 1) : 0
      if (end - video.currentTime > BUFFER_AHEAD_SECONDS) return

      appending = true
      try {
        const url = mseVariantUrl(srcs[feedIndex % srcs.length])
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
        const data = await res.arrayBuffer()
        if (stopped || mediaSource.readyState !== 'open') return

        await new Promise<void>((resolve, reject) => {
          const done = () => { sourceBuffer!.removeEventListener('updateend', done); resolve() }
          sourceBuffer!.addEventListener('updateend', done)
          try { sourceBuffer!.appendBuffer(new Uint8Array(data)) } catch (e) { reject(e) }
        })

        feedIndex++
      } catch (e) {
        fail(e)
        return
      } finally {
        appending = false
      }

      // Keep filling until far enough ahead.
      if (!stopped) pump()
    }

    const onOpen = () => {
      try {
        sourceBuffer = mediaSource.addSourceBuffer(MSE_MIME)
        // Segments are laid end to end by the buffer itself, so their own
        // timestamps — each starting at zero — do not have to be rewritten.
        sourceBuffer.mode = 'sequence'
        sourceBuffer.addEventListener('error', fail)
        pump()
        video.play().catch(() => {})
      } catch (e) {
        fail(e)
      }
    }

    mediaSource.addEventListener('sourceopen', onOpen)
    video.addEventListener('error', fail)

    // Top the buffer up as playback advances, and recover if it ever pauses.
    const tick = window.setInterval(() => {
      if (stopped) return
      if (video.paused) video.play().catch(() => {})
      pump()

      document.documentElement.dataset.fsVideo =
        `mse ready=${video.readyState} paused=${video.paused}` +
        ` t=${video.currentTime.toFixed(1)}` +
        ` fed=${feedIndex} of ${srcs.length}` +
        ` buffered=${sourceBuffer?.buffered.length
          ? sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1).toFixed(1) : 0}` +
        ` state=${mediaSource.readyState}`
    }, 1000)

    return () => {
      stopped = true
      window.clearInterval(tick)
      mediaSource.removeEventListener('sourceopen', onOpen)
      video.removeEventListener('error', fail)
      sourceBuffer?.removeEventListener('error', fail)
      URL.revokeObjectURL(objectUrl)
      delete document.documentElement.dataset.fsVideo
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcs.join('|')])

  if (failed) return null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: '#000', overflow: 'hidden' }}>
      <video
        ref={videoRef}
        muted
        playsInline
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      />
    </div>
  )
}
