/**
 * Grabs a still frame from a video file, for use as a card thumbnail.
 *
 * The wall shows these instead of playing every clip. On the TV that matters
 * twice over: a <video> ignores the page rotation there and had to be drawn by
 * a separate unrotated layer, and decoding every clip at once is more than the
 * panel can hold. An <img> has neither problem.
 *
 * Reads from a local File or an object URL, never a cross-origin address —
 * drawing a cross-origin video taints the canvas and toBlob then throws.
 */
export async function extractPoster(file: File, atSeconds = 1): Promise<File> {
  const url = URL.createObjectURL(file)
  try {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = url

    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error('Kunde inte läsa filmen'))
    })

    // A frame in rather than the very first, which is often black.
    await new Promise<void>((resolve) => {
      const target = Math.min(atSeconds, (video.duration || 0) / 2 || 0)
      if (!target) { resolve(); return }
      video.onseeked = () => resolve()
      video.currentTime = target
      // Seeking can silently never complete on a short or odd file.
      setTimeout(resolve, 3000)
    })

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    if (!canvas.width || !canvas.height) throw new Error('Filmen saknar bildmått')

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Ingen canvas-kontext')
    ctx.drawImage(video, 0, 0)

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', 0.82))
    if (!blob) throw new Error('Kunde inte skapa stillbild')

    return new File([blob], 'poster.jpg', { type: 'image/jpeg' })
  } finally {
    URL.revokeObjectURL(url)
  }
}
