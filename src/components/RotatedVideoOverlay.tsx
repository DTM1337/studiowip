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
 * Fullscreen video for a rotated display, played from two alternating elements.
 *
 * Rotation is baked into the file rather than applied at playback. Samsung
 * Tizen ignores CSS transforms on a <video> — inherited or on the element —
 * and keeps decoded frames where drawImage cannot read them, so every
 * playback-time approach failed on the panel. A pre-rotated file needs none of
 * them: the element is never transformed, so nothing depends on how the browser
 * composites video.
 *
 * Two elements because one is not seamless: remounting per clip meant a fresh
 * download and a wait for the buffer, showing black in between. Here the hidden
 * element already holds the next clip, loaded and ready, so advancing is a
 * swap rather than a start.
 *
 * Uploads made before the variant existed have none, so a missing file falls
 * back to the original plus a CSS rotation — correct in a desktop browser,
 * wrong on the TV, but better than not playing.
 */
export default function RotatedVideoOverlay({ srcs, rotation }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const slotRefs = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)]

  // Which element is on screen, and which clip it holds.
  const [slot, setSlot] = useState(0)
  const [index, setIndex] = useState(0)

  // Only a quarter turn clockwise has a baked variant; anything else has to
  // fall back to transforming the element.
  const canUseVariant = rotation === 90
  const [useVariant, setUseVariant] = useState(canUseVariant)
  useEffect(() => { setUseVariant(canUseVariant) }, [canUseVariant])

  const list = srcs.length ? srcs : ['']
  const advances = list.length > 1
  const resolve = (s: string) => (useVariant && s ? rotatedVariantUrl(s) : s)

  // Assign sources imperatively rather than through props: React would swap the
  // src of whichever element re-renders, and the point of the hidden one is
  // that its buffer survives the change of clip.
  useEffect(() => {
    const visible = slotRefs[slot].current
    const hidden = slotRefs[1 - slot].current
    if (!visible) return

    const wanted = resolve(list[index % list.length])
    if (visible.getAttribute('src') !== wanted) {
      visible.src = wanted
      visible.load()
    }

    if (hidden && advances) {
      const nextWanted = resolve(list[(index + 1) % list.length])
      if (hidden.getAttribute('src') !== nextWanted) {
        hidden.src = nextWanted
        // preload="auto" plus an explicit load so it reaches a full buffer
        // well before it is needed.
        hidden.load()
      }
      hidden.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot, index, useVariant, list.join('|')])

  useEffect(() => {
    const box = boxRef.current
    if (!box) return

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

    const visible = slotRefs[slot].current
    if (!visible) return

    // A missing variant surfaces as a media error; drop to the original rather
    // than leaving a black screen.
    const onError = () => { if (useVariant) setUseVariant(false) }
    visible.addEventListener('error', onError)

    // Waiting for a buffer rather than starting at the first playable frame.
    // `canplay` fires with barely two frames ready, so playback began and then
    // stuttered for the first second or two while it caught up.
    let started = false
    const start = () => {
      if (started || stopped) return
      started = true
      visible.play().catch(() => {})
    }
    const startWhenBuffered = () => { if (visible.readyState >= 4) start() }

    visible.addEventListener('canplaythrough', start)
    visible.addEventListener('progress', startWhenBuffered)
    visible.addEventListener('loadeddata', startWhenBuffered)
    // A slow connection may never reach HAVE_ENOUGH_DATA, and a clip that never
    // plays is worse than one that stutters.
    const impatient = window.setTimeout(start, 4000)

    // Once running, a pause is something to recover from rather than wait out.
    // The pause that comes with reaching the end is not, or the swap would be
    // fighting a restart of the clip it is trying to leave.
    const resume = () => { if (started && !visible.ended) visible.play().catch(() => {}) }
    visible.addEventListener('pause', resume)

    const finish = () => {
      if (!advances) return
      setIndex(i => (i + 1) % list.length)
      setSlot(s => 1 - s)
    }
    visible.addEventListener('ended', finish)

    startWhenBuffered()

    const watchdog = window.setInterval(() => {
      if (stopped) return
      if (started && visible.paused && !visible.ended) visible.play().catch(() => {})
      const r = box.getBoundingClientRect()
      const hidden = slotRefs[1 - slot].current
      document.documentElement.dataset.fsVideo =
        `src=${useVariant ? 'rot90' : 'original'} ready=${visible.readyState}` +
        ` paused=${visible.paused} t=${visible.currentTime.toFixed(1)}` +
        ` nat=${visible.videoWidth}x${visible.videoHeight}` +
        ` box=${Math.round(r.width)}x${Math.round(r.height)}` +
        ` buffered=${visible.buffered.length ? visible.buffered.end(visible.buffered.length - 1).toFixed(1) : 0}` +
        (advances ? ` next=${hidden ? hidden.readyState : '-'}` : '') +
        ` err=${visible.error ? visible.error.code : '-'}`
    }, 1000)

    return () => {
      stopped = true
      window.clearInterval(watchdog)
      window.clearTimeout(impatient)
      window.removeEventListener('resize', layout)
      visible.removeEventListener('error', onError)
      visible.removeEventListener('canplaythrough', start)
      visible.removeEventListener('progress', startWhenBuffered)
      visible.removeEventListener('loadeddata', startWhenBuffered)
      visible.removeEventListener('pause', resume)
      visible.removeEventListener('ended', finish)
      delete document.documentElement.dataset.fsVideo
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot, index, rotation, useVariant, advances, list.length])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: '#000', overflow: 'hidden' }}>
      <div ref={boxRef} style={{ position: 'absolute' }}>
        {[0, 1].map(i => (
          <video
            key={i}
            ref={slotRefs[i]}
            muted
            // A single clip has nothing to advance to, so it repeats itself.
            loop={!advances}
            playsInline
            preload="auto"
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              objectFit: 'contain', display: 'block',
              // Kept mounted and merely hidden: unmounting would throw away the
              // buffer that makes the swap seamless.
              opacity: i === slot ? 1 : 0,
              zIndex: i === slot ? 1 : 0,
            }}
          />
        ))}
      </div>
    </div>
  )
}
