import { supabase } from './supabase'

export const CHANNEL = 'display-control'

export type DisplayCommand =
  | { action: 'view-sync'; pan: { x: number; y: number }; zoom: number }
  | { action: 'select-post'; postId: string | null }
  | { action: 'rotate' }
  | { action: 'toggle-rulers' }
  | { action: 'toggle-canvas-video' }
  | { action: 'toggle-debug' }

export function sendCommand(cmd: DisplayCommand) {
  supabase.channel(CHANNEL).send({
    type: 'broadcast',
    event: 'cmd',
    payload: cmd,
  })
}
