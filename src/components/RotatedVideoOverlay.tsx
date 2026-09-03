'use client'

import { useEffect, useRef, useState } from 'react'
import { rotatedVariantUrl } from '@/lib/rotatedVariant'

type Props = {
  /** One clip, or a list to play in sequence. A single one loops. */
  srcs: string[]
  /** Degrees the display is rotated by. */
  rotation: number
}

/**
 * Fullscreen video for a rotated display.
 *
 * Rotation is baked into the file rather than applied at playback. Samsung
 * Tizen ignores CSS transforms on a <video> — inherited or on the element —
 * and keeps decoded frames where drawImage cannot read them, so every
 * playback-time approach failed on the panel. A pre-rotated file needs none of
 * them: the element is never transformed, so nothing depends on how the browser
 * composites video.
 *
 * Exactly one <video> exists at a time. Two alternating elements gave a
 * genuinely seamless swap in a desktop browser and a black screen on the panel,
 * which has a single hardware decoder — the same constraint that shapes
 * everything else here.
 *
 * The next clip is fetched into memory while the current one plays, so
 * switching is a local source change rather than a download. That is as close
 * to seamless as this panel gets: changing source restarts its decoder, which
 * costs a few hundred milliseconds whatever the data is doing, and shows as a
 * brief black frame between clips. Covering that with the clip's still frame
 * was tried and read as a stutter rather than a cut, so the gap is left plain.
 *
 * Uploads made before the variant existed have none, so a missing file falls
 * back to the original plus a CSS rotation — correct in a desktop browser,
 * wrong on the TV, but better than not playing.
 */
export default function RotatedVideoOverlay({ srcs, rotation }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const [index, setIndex] = useState(0)

  // Only a quarter turn clockwise has a baked variant; anything else has to
  // fall back to transforming the element.
  const canUseVariant = rotation === 90
  const [useVariant, setUseVariant] = useState(canUseVariant)
  useEffect(() => { setUseVariant(canUseVariant) }, [canUseVariant])

  const list = srcs.length ? srcs : ['']
  const advances = list.length > 1
  const current = list[index % list.length]
  const playbackSrc = useVariant && current ? rotatedVariantUrl(current) : current

  /**
   * The next clip, held as a blob so the switch is instant.
   *
   * Relying on the HTTP cache would leave it to chance; a blob is certain, and
   * one clip in memory is a few megabytes at the size cap.
   */
  const prefetched = useRef<{ src: string; url: string } | null>(null)
  useEffect(() => {
    if (!advances) return
    let cancelled = false

    const nextSrc = list[(index + 1) % list.length]
    const nextUrl = useVariant && nextSrc ? rotatedVariantUrl(nextSrc) : nextSrc
    if (!nextUrl || prefetched.current?.src === nextUrl) return

    fetch(nextUrl)
      .then(r => r.ok ? r.blob() : null)
      .then(blob => {
        if (cancelled || !blob) return
        if (prefetched.current) URL.revokeObjectURL(prefetched.current.url)
        prefetched.current = { src: nextUrl, url: URL.createObjectURL(blob) }
      })
      .catch(() => {})

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, useVariant, advances, list.join('|')])

  // Released only on unmount: the blob in flight belongs to the next clip and
  // must outlive every render in between.
  useEffect(() => () => {
    if (prefetched.current) URL.revokeObjectURL(prefetched.current.url)
    prefetched.current = null
  }, [])

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

    // Play from the prefetched copy when it is the clip now due.
    const ready = prefetched.current
    if (ready && ready.src === playbackSrc) {
      video.src = ready.url
      prefetched.current = null
      // Revoked once the element has taken it, on the next source change.
      video.dataset.blobUrl = ready.url
    } else {
      video.src = playbackSrc
    }
    video.load()

    // A missing variant surfaces as a media error; drop to the original rather
    // than leaving a black screen.
    const onError = () => { if (useVariant) setUseVariant(false) }
    video.addEventListener('error', onError)

    // Waiting for a buffer rather than starting at the first playable frame.
    // `canplay` fires with barely two frames ready, so playback began and then
    // stuttered for the first second or two while it caught up.
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
    // The pause that comes with reaching the end is not, or the advance would be
    // fighting a restart of the clip it is trying to leave.
    const resume = () => { if (started && !video.ended) video.play().catch(() => {}) }
    video.addEventListener('pause', resume)

    const finish = () => { if (advances) setIndex(i => (i + 1) % list.length) }
    video.addEventListener('ended', finish)

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
        (advances ? ` clip=${(index % list.length) + 1}/${list.length} next=${prefetched.current ? 'klar' : '-'}` : '') +
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
      const spent = video.dataset.blobUrl
      if (spent) { URL.revokeObjectURL(spent); delete video.dataset.blobUrl }
      delete document.documentElement.dataset.fsVideo
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackSrc, rotation, useVariant, advances, list.length])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: '#000', overflow: 'hidden' }}>
      <div ref={boxRef} style={{ position: 'absolute' }}>
        <video
          ref={videoRef}
          muted
          // A single clip has nothing to advance to, so it repeats itself.
          loop={!advances}
          playsInline
          preload="auto"
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      </div>

    </div>
  )
}
