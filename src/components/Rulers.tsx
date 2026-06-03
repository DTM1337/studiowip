'use client'

import { useEffect, useRef } from 'react'

const SIZE = 24 // ruler thickness in px
const BG = '#1a1a1a'
const TICK = '#555'
const TICK_MAJOR = '#888'
const TEXT_COLOR = '#999'
const FONT = `10px "SF Mono", "Fira Code", monospace`

function drawRuler(
  ctx: CanvasRenderingContext2D,
  length: number,
  thickness: number,
  direction: 'h' | 'v',
  offset: number,
  zoom: number,
) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  // Determine step size based on zoom
  const worldStep = zoom >= 2 ? 25 : zoom >= 1 ? 50 : zoom >= 0.5 ? 100 : 200
  const screenStep = worldStep * zoom

  // Starting world coord at pixel 0 of the ruler
  const startWorld = -offset / zoom
  const startTick = Math.floor(startWorld / worldStep) * worldStep

  ctx.font = FONT
  ctx.fillStyle = TEXT_COLOR
  ctx.strokeStyle = TICK

  for (let w = startTick; w < startWorld + length / zoom; w += worldStep) {
    const screenPos = (w - startWorld) * zoom
    const isMajor = w % (worldStep * 2) === 0
    const tickLen = isMajor ? SIZE * 0.55 : SIZE * 0.3

    ctx.strokeStyle = isMajor ? TICK_MAJOR : TICK
    ctx.lineWidth = 1
    ctx.beginPath()

    if (direction === 'h') {
      ctx.moveTo(screenPos, thickness)
      ctx.lineTo(screenPos, thickness - tickLen)
      if (isMajor) {
        ctx.fillStyle = TEXT_COLOR
        ctx.textAlign = 'center'
        ctx.fillText(String(Math.round(w)), screenPos, thickness - tickLen - 2)
      }
    } else {
      ctx.moveTo(thickness, screenPos)
      ctx.lineTo(thickness - tickLen, screenPos)
      if (isMajor) {
        ctx.save()
        ctx.translate(thickness - tickLen - 2, screenPos)
        ctx.rotate(-Math.PI / 2)
        ctx.fillStyle = TEXT_COLOR
        ctx.textAlign = 'center'
        ctx.fillText(String(Math.round(w)), 0, 0)
        ctx.restore()
      }
    }
    ctx.stroke()
  }

  // Border line
  ctx.strokeStyle = '#333'
  ctx.lineWidth = 1
  ctx.beginPath()
  if (direction === 'h') { ctx.moveTo(0, thickness - 0.5); ctx.lineTo(length, thickness - 0.5) }
  else { ctx.moveTo(thickness - 0.5, 0); ctx.lineTo(thickness - 0.5, length) }
  ctx.stroke()
}

interface Props {
  pan: { x: number; y: number }
  zoom: number
}

export default function Rulers({ pan, zoom }: Props) {
  const hRef = useRef<HTMLCanvasElement>(null)
  const vRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth
      const h = window.innerHeight

      if (hRef.current) {
        hRef.current.width = w
        hRef.current.height = SIZE
        const ctx = hRef.current.getContext('2d')!
        // pan.x shifts canvas right; center is at w/2
        // offset = distance from ruler origin to canvas origin in screen pixels
        const offset = w / 2 + pan.x * zoom
        drawRuler(ctx, w, SIZE, 'h', offset, zoom)
      }

      if (vRef.current) {
        vRef.current.width = SIZE
        vRef.current.height = h
        const ctx = vRef.current.getContext('2d')!
        const offset = h / 2 + pan.y * zoom
        drawRuler(ctx, h, SIZE, 'v', offset, zoom)
      }
    }

    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [pan, zoom])

  return (
    <>
      {/* Horizontal ruler */}
      <canvas
        ref={hRef}
        style={{
          position: 'fixed', top: 0, left: SIZE, zIndex: 10000,
          width: `calc(100vw - ${SIZE}px)`, height: SIZE,
          imageRendering: 'pixelated',
        }}
      />
      {/* Vertical ruler */}
      <canvas
        ref={vRef}
        style={{
          position: 'fixed', top: 0, left: 0, zIndex: 10000,
          width: SIZE, height: '100vh',
          imageRendering: 'pixelated',
        }}
      />
      {/* Corner square */}
      <div style={{
        position: 'fixed', top: 0, left: 0, zIndex: 10001,
        width: SIZE, height: SIZE, background: BG,
        borderRight: '1px solid #333', borderBottom: '1px solid #333',
      }} />
    </>
  )
}
